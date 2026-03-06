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
const profileRoutes = require('./routes/profile');
const pushRoutes = require('./routes/push');

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

// Profile API routes
app.use('/api/profile', profileRoutes);

// Push notification API routes
app.use('/api/push', pushRoutes);

// Health check endpoint
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

// Metrics endpoint (Prometheus format)
app.get('/metrics', healthLimiter, async (req, res) => {
    const mem = process.memoryUsage();
    const activeGames = await gameStore.gameCount();
    const connectedSockets = io.engine?.clientsCount || 0;
    const uptimeSeconds = Math.round(process.uptime());

    const lines = [
        '# HELP gridlock_active_games Number of active games',
        '# TYPE gridlock_active_games gauge',
        `gridlock_active_games ${activeGames}`,
        '',
        '# HELP gridlock_connected_sockets Number of connected sockets',
        '# TYPE gridlock_connected_sockets gauge',
        `gridlock_connected_sockets ${connectedSockets}`,
        '',
        '# HELP gridlock_memory_rss_bytes Resident set size in bytes',
        '# TYPE gridlock_memory_rss_bytes gauge',
        `gridlock_memory_rss_bytes ${mem.rss}`,
        '',
        '# HELP gridlock_memory_heap_used_bytes Heap used in bytes',
        '# TYPE gridlock_memory_heap_used_bytes gauge',
        `gridlock_memory_heap_used_bytes ${mem.heapUsed}`,
        '',
        '# HELP gridlock_memory_heap_total_bytes Heap total in bytes',
        '# TYPE gridlock_memory_heap_total_bytes gauge',
        `gridlock_memory_heap_total_bytes ${mem.heapTotal}`,
        '',
        '# HELP gridlock_uptime_seconds Server uptime in seconds',
        '# TYPE gridlock_uptime_seconds gauge',
        `gridlock_uptime_seconds ${uptimeSeconds}`,
        '',
    ];

    res.set('Content-Type', 'text/plain; version=0.0.4').send(lines.join('\n'));
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
    log.info('Environment:', process.env.NODE_ENV || 'development');
    log.info('Log level:', LOG_LEVEL);
});
