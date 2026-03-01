// server.js - Production-ready multiplayer game server (2-4 players)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const socketHandlers = require('./controllers/socketHandlers');
const { httpLimiter, healthLimiter } = require('./middleware/rateLimiter');

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
app.use(cors());
app.use(express.json());
app.use(httpLimiter); // Global HTTP rate limiting

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock')
.then(() => log.info('MongoDB connected'))
.catch(err => log.error('MongoDB connection error:', err));

// Socket.io Setup
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Attach socket handlers and get activeGames for health check
const { activeGames } = socketHandlers(io, log);

// Health check endpoint
app.get('/health', healthLimiter, (req, res) => {
    res.json({ 
        status: 'ok', 
        activeGames: activeGames ? activeGames.size : 0,
        connectedSockets: io.engine?.clientsCount || 0,
        timestamp: new Date().toISOString()
    });
});

// Metrics endpoint (for monitoring)
app.get('/metrics', healthLimiter, (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        activeGames: activeGames ? activeGames.size : 0,
        connectedSockets: io.engine?.clientsCount || 0,
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        },
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
    log.info('Environment:', process.env.NODE_ENV || 'development');
    log.info('Log level:', LOG_LEVEL);
});
