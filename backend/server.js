// server.js - Production-ready multiplayer game server (2-4 players)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
require('dotenv').config();

const socketHandlers = require('./controllers/socketHandlers');
const { httpLimiter, healthLimiter } = require('./middleware/rateLimiter');
const leaderboardRoutes = require('./routes/leaderboard');

const app = express();
const server = http.createServer(app);

// Logging utility with levels
const LOG_LEVEL = process.env.LOG_LEVEL || 'DEBUG';
const log = {
    debug: (...args) => ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(LOG_LEVEL) && console.log('[DEBUG]', new Date().toISOString(), ...args),
    info: (...args) => ['INFO', 'WARN', 'ERROR'].includes(LOG_LEVEL) && console.log('[INFO]', new Date().toISOString(), ...args),
    warn: (...args) => ['WARN', 'ERROR'].includes(LOG_LEVEL) && console.warn('[WARN]', new Date().toISOString(), ...args),
    error: (...args) => ['ERROR'].includes(LOG_LEVEL) && console.error('[ERROR]', new Date().toISOString(), ...args)
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

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock')
.then(() => log.info('MongoDB connected'))
.catch(err => log.error('MongoDB connection error:', err));

// Socket.io Setup
const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
        methods: ["GET", "POST"],
    },
});

// Optional horizontal scaling via Redis adapter
let redisEnabled = false;
async function setupRedisAdapter() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        log.warn('REDIS_URL not set; running in single-instance mode (no horizontal scaling)');
        return;
    }

    try {
        const pubClient = createClient({ url: redisUrl });
        const subClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
        redisEnabled = true;
        log.info('Socket.IO Redis adapter enabled');
    } catch (err) {
        log.error('Failed to enable Redis adapter; continuing in single-instance mode', { error: err.message });
    }
}

setupRedisAdapter();

// Attach socket handlers
const { gameStore, rematchStore, disconnectStore, localTimers } = socketHandlers(io, log);

// Leaderboard API routes
app.use('/api/leaderboard', leaderboardRoutes);

// Health check endpoint
app.get('/health', healthLimiter, async (req, res) => {
    res.json({
        status: 'ok',
        activeGames: await gameStore.gameCount(),
        pendingRematches: await rematchStore.storeCount(),
        pendingDisconnectTimers: localTimers.size,
        connectedSockets: io.engine?.clientsCount || 0,
        redisAdapter: redisEnabled,
        timestamp: new Date().toISOString(),
    });
});

// Metrics endpoint (for monitoring)
app.get('/metrics', healthLimiter, async (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        activeGames: await gameStore.gameCount(),
        pendingRematches: await rematchStore.storeCount(),
        pendingDisconnectTimers: localTimers.size,
        connectedSockets: io.engine?.clientsCount || 0,
        redisAdapter: redisEnabled,
        memory: {
            rssMB: Math.round(memUsage.rss / 1024 / 1024),
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
            externalMB: Math.round(memUsage.external / 1024 / 1024),
        },
        timestamp: new Date().toISOString(),
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
    log.info('Environment:', process.env.NODE_ENV || 'development');
    log.info('Log level:', LOG_LEVEL);
});
