// server.js - Production-ready multiplayer game server (2-4 players)

// Sentry must be initialized before other requires so it can patch modules
const sentry = require('./lib/sentry');

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
require('dotenv').config();
const { metricsMiddleware, metricsEndpoint, metrics } = require('./lib/metrics');

const socketHandlers = require('./controllers/socketHandlers');
const { httpLimiter, healthLimiter } = require('./middleware/rateLimiter');
const leaderboardRoutes = require('./routes/leaderboard');
const profileRoutes = require('./routes/profile');
const pushRoutes = require('./routes/push');
const replayRoutes = require('./routes/replay');
const gameHistoryRoutes = require('./routes/gameHistory');
const rankedRoutes = require('./routes/ranked');
const dailyRoutes = require('./routes/daily');
const healthcheckRoutes = require('./routes/healthcheck');

const app = express();
const server = http.createServer(app);

// Logging utility with levels
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LOG_LEVEL = (process.env.LOG_LEVEL || 'DEBUG').toUpperCase();
const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? 0;
const log = {
    debug: (...args) => currentLevel <= 0 && console.log('[DEBUG]', new Date().toISOString(), ...args),
    info: (...args) => currentLevel <= 1 && console.log('[INFO]', new Date().toISOString(), ...args),
    warn: (...args) => currentLevel <= 2 && console.warn('[WARN]', new Date().toISOString(), ...args),
    error: (...args) => currentLevel <= 3 && console.error('[ERROR]', new Date().toISOString(), ...args)
};

// Middleware
app.set('trust proxy', 1);
app.use(helmet({
    // API backend only (frontend served separately). Keep Socket.IO compatible.
    // Disable Helmet's CSP so the custom middleware below can set a restrictive CSP for API responses.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use((req, res, next) => {
    // Explicit CSP for API responses. Frontend CSP is handled at the reverse proxy / frontend host.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    next();
});
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*" }));
app.use(express.json());
app.use(httpLimiter); // Global HTTP rate limiting
app.use(metricsMiddleware); // Prometheus HTTP request tracking

// Database Connection
// In production, MONGO_URI must be explicitly set via PM2 ecosystem config
// to prevent accidental cross-environment data access.
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock';
if (process.env.NODE_ENV === 'production' && !process.env.MONGO_URI) {
  console.error('FATAL: MONGO_URI must be set in production. Set it in ecosystem.config.js.');
  process.exit(1);
}
mongoose.connect(MONGO_URI)
.then(() => log.info('MongoDB connected to', MONGO_URI.replace(/\/\/.*@/, '//<credentials>@')))
.catch(err => log.error('MongoDB connection error:', err));

// Socket.io Setup
const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
        methods: ["GET", "POST"],
    },
});

// Expose io to Express routes (used by push subscribe for socket verification)
app.locals.io = io;

// Optional horizontal scaling via Redis adapter
let redisEnabled = false;
let redisPubClient = null;
let redisSubClient = null;

async function setupRedisAdapter() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        log.warn('REDIS_URL not set; running in single-instance mode (no horizontal scaling)');
        return;
    }

    try {
        redisPubClient = createClient({ url: redisUrl });
        redisSubClient = redisPubClient.duplicate();

        await Promise.all([redisPubClient.connect(), redisSubClient.connect()]);
        io.adapter(createAdapter(redisPubClient, redisSubClient));
        redisEnabled = true;
        log.info('Socket.IO Redis adapter enabled');
    } catch (err) {
        log.error('Failed to enable Redis adapter; continuing in single-instance mode', { error: err.message });
        redisPubClient = null;
        redisSubClient = null;
    }
}

setupRedisAdapter();

// Attach socket handlers
const { gameStore, rematchStore, disconnectStore, localTimers } = socketHandlers(io, log);

// Leaderboard API routes
app.use('/api/leaderboard', leaderboardRoutes);

// Profile API routes
app.use('/api/profile', profileRoutes);

// Push notification API routes
app.use('/api/push', pushRoutes);

// Game history API routes (must be before /api/games to avoid :gameId collision)
app.use('/api/games/history', gameHistoryRoutes);

// Game replay API routes
app.use('/api/games', replayRoutes);

// Ranked mode API routes
app.use('/api/ranked', rankedRoutes);

// Daily challenge API routes
app.use('/api/daily', dailyRoutes);

// Deep health check (post-deploy verification) — mounted before the lightweight
// /health GET and any catch-all routes to ensure /health/deep is always reachable.
app.use('/health', healthcheckRoutes);

// Lightweight health check endpoint (for load balancers / uptime monitors)
app.get('/health', healthLimiter, async (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        activeGames: await gameStore.gameCount(),
        pendingRematches: await rematchStore.storeCount(),
        pendingDisconnectTimers: localTimers.size,
        connectedSockets: io.engine?.clientsCount || 0,
        redisAdapter: redisEnabled,
        memoryUsage: {
            rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
            heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
            heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
        },
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

// ── Cached game count for Prometheus scrapes (avoids DB query on every /metrics hit) ──
let cachedGameCount = 0;
setInterval(async () => {
    try {
        cachedGameCount = await gameStore.gameCount();
    } catch (err) {
        log.error('Failed to refresh cached game count:', err.message);
    }
}, 15_000); // Refresh every 15 seconds
// Initialize on startup
gameStore.gameCount().then(c => { cachedGameCount = c; }).catch(() => {});

// Prometheus metrics endpoint (prom-client format with default + custom metrics)
app.get('/metrics', healthLimiter, async (req, res) => {
    // Update point-in-time gauges before scrape (uses cached game count)
    metrics.activeGames.set(cachedGameCount);
    metrics.connectedSockets.set(io.engine?.clientsCount || 0);
    return metricsEndpoint(req, res);
});

// Sentry error handler — must be after all routes, before any other error middleware
app.use(sentry.errorHandler());

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
    log.info('Environment:', process.env.NODE_ENV || 'development');
    log.info('Log level:', LOG_LEVEL);
});

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
    log.info(`${signal} received — starting graceful shutdown`);

    // Hard timeout — force exit if graceful shutdown hangs
    const SHUTDOWN_TIMEOUT_MS = 10000;
    const forceExit = setTimeout(() => {
        log.error('Graceful shutdown timed out — forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref(); // Don't keep event loop alive just for this timer

    // Stop accepting new connections (wrapped in Promises with timeout)
    const closeWithTimeout = (label, closeFn, timeoutMs = 5000) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          log.warn(`${label} close timed out after ${timeoutMs}ms`);
          resolve();
        }, timeoutMs);
        closeFn(() => {
          clearTimeout(timer);
          log.info(`${label} closed`);
          resolve();
        });
      });

    await closeWithTimeout('HTTP server', (cb) => server.close(cb));
    await closeWithTimeout('Socket.IO server', (cb) => io.close(cb));

    // Close Redis adapter clients (if connected)
    try {
        if (redisPubClient) await redisPubClient.quit();
        if (redisSubClient) await redisSubClient.quit();
        log.info('Redis adapter clients closed');
    } catch (err) {
        log.error('Error closing Redis adapter clients:', err.message);
    }

    // Close MongoDB
    try {
        await mongoose.connection.close();
        log.info('MongoDB connection closed');
    } catch (err) {
        log.error('Error closing MongoDB:', err.message);
    }

    // Flush Sentry events
    if (sentry.initialized) {
        await sentry.Sentry.close(2000);
    }

    log.info('Graceful shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
