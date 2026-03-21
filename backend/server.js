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
const { httpLimiter, healthLimiter, normalizeIp, getSocketCountForIP, trackSocketConnection, untrackSocketConnection, MAX_SOCKETS_PER_IP } = require('./middleware/rateLimiter');
const { startLobbyTimer, clearAllTimers: clearIdleTimers } = require('./middleware/idleTimeout');
const { isInternalRequest } = require('./middleware/internalAccess');
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

function isLocalProxyAddress(ip = '') {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

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
// ── CORS allowlist (#285) ────────────────────────────────────────────────────
const { getAllowedOrigins } = require('./config/corsOrigins');
const ALLOWED_ORIGINS = getAllowedOrigins();

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (server-to-server, curl, mobile apps)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }
        const err = new Error('Not allowed by CORS');
        err.status = 403;
        callback(err);
    }
}));
app.use(express.json());
app.use(metricsMiddleware); // Prometheus HTTP request tracking (before rate limiter so 429s are counted)
app.use(httpLimiter); // Global HTTP rate limiting

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
// Express CORS uses a callback to allow null/undefined origins (server-to-server
// requests, curl, mobile apps send no Origin header). Socket.IO uses the array
// directly because WebSocket upgrades always originate from a browser page — there
// is no server-to-server scenario that needs a null origin exception.
const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ["GET", "POST"],
    },
});

// Expose io to Express routes (used by push subscribe for socket verification)
app.locals.io = io;

// ── Per-IP WebSocket connection limiter (#286) ───────────────────────────────
io.use((socket, next) => {
    if (process.env.NODE_ENV === 'test') return next();

    const socketIp = socket.handshake.address || '';
    const forwardedIp = socket.handshake.headers['x-real-ip'];
    const rawIp = isLocalProxyAddress(socketIp) && forwardedIp ? forwardedIp : socketIp;
    // Normalize IPv4-mapped IPv6 addresses (#302)
    const ip = normalizeIp(rawIp);

    if (getSocketCountForIP(ip) >= MAX_SOCKETS_PER_IP) {
        return next(new Error('Too many connections from this IP'));
    }

    if (!trackSocketConnection(ip, socket.id)) {
        return next(new Error('Too many connections'));
    }
    socket.on('disconnect', () => {
        untrackSocketConnection(ip, socket.id);
        clearIdleTimers(socket.id);
    });

    // Start lobby idle timer — disconnects if no game activity within timeout
    startLobbyTimer(socket);

    next();
});

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

// Start periodic game cleanup / GC (#365 Bug #14)
const { startGameCleanup } = require('./services/gameCleanup');
const GameModel = require('./models/Game');
startGameCleanup(gameStore, log, GameModel);

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
    try {
        const activeGames = await gameStore.gameCount();
        const pendingRematches = await rematchStore.storeCount();
        const mem = process.memoryUsage();
        res.json({
            status: 'ok',
            activeGames,
            pendingRematches,
            pendingDisconnectTimers: localTimers.size,
            connectedSockets: io.engine?.clientsCount || 0,
            redisAdapter: redisEnabled,
            memoryUsage: {
                rss: +(mem.rss / 1024 / 1024).toFixed(1),
                heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(1),
                heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(1),
            },
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        // Service is up but a backing store is unreachable — return degraded status
        // Still 200 so load balancers don't pull the instance, but status indicates the problem
        log.error('Health check degraded:', { error: err.message });
        const mem = process.memoryUsage();
        res.json({
            status: 'degraded',
            error: 'Backing service unreachable',
            connectedSockets: io.engine?.clientsCount || 0,
            memoryUsage: {
                rss: +(mem.rss / 1024 / 1024).toFixed(1),
                heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(1),
                heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(1),
            },
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
        });
    }
});

// ── Cached game count for Prometheus scrapes (avoids DB query on every /metrics hit) ──
let cachedGameCount = 0;
setInterval(async () => {
    try {
        cachedGameCount = await gameStore.gameCount();
    } catch (err) {
        log.error('Failed to refresh cached game count:', err.message);
    }
}, 15_000).unref(); // Refresh every 15 seconds; .unref() allows graceful shutdown
// Initialize on startup
gameStore.gameCount().then(c => { cachedGameCount = c; }).catch(() => {});

// ── Internal IP check for /metrics (#284) — uses shared utility ──────────────

// Prometheus metrics endpoint (prom-client format with default + custom metrics)
app.get('/metrics', healthLimiter, async (req, res) => {
    if (!isInternalRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    // Update point-in-time gauges before scrape (uses cached game count)
    metrics.activeGames.set(cachedGameCount);
    metrics.connectedSockets.set(io.engine?.clientsCount || 0);
    return metricsEndpoint(req, res);
});

// Sentry error handler — must be after all routes, before any other error middleware
app.use(sentry.errorHandler());

// Generic error handler — catch-all for unhandled errors (CORS rejections, etc.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
    if (res.headersSent) {
        return;
    }

    const status = err.status || 500;
    // Only mask 500s in production — client errors (4xx) should always show their real message
    const message = (status >= 500 && process.env.NODE_ENV === 'production')
        ? 'Internal server error'
        : err.message;

    if (status >= 500) {
        log.error('Unhandled error:', { error: err.message, stack: err.stack, path: req.path });
    }

    res.status(status).json({ error: message });
});

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
