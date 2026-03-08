// backend/middleware/rateLimiter.js
// Rate limiting for both HTTP and Socket.IO events

const rateLimit = require('express-rate-limit');

// ─── HTTP Rate Limiter ────────────────────────────────────────────────────────

/**
 * General API rate limiter for HTTP endpoints
 */
const httpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,                  // 100 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

/**
 * Stricter rate limiter for health/status endpoints
 */
const healthLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── Socket.IO Rate Limiter ──────────────────────────────────────────────────

/**
 * In-memory per-socket event rate tracker
 * Tracks event counts per socket per time window
 */
class SocketRateLimiter {
    constructor() {
        // Map<socketId, Map<eventName, { count, windowStart }>>
        this.trackers = new Map();

        // Event-specific limits: { maxPerWindow, windowMs }
        this.limits = {
            create_game:     { maxPerWindow: 5,  windowMs: 60_000 },   // 5 creates/min
            join_game:       { maxPerWindow: 10, windowMs: 60_000 },   // 10 joins/min
            make_move:       { maxPerWindow: 60, windowMs: 60_000 },   // 60 moves/min (fast play)
            request_rematch: { maxPerWindow: 5,  windowMs: 60_000 },   // 5 rematch requests/min
            queue_join:      { maxPerWindow: 3,  windowMs: 60_000 },   // 3 queue joins/min
            queue_leave:     { maxPerWindow: 10, windowMs: 60_000 },   // 10 queue leaves/min
        };
    }

    /**
     * Check if an event from a socket should be allowed
     * @param {string} socketId 
     * @param {string} eventName 
     * @returns {boolean} true if allowed, false if rate-limited
     */
    allow(socketId, eventName) {
        if (process.env.NODE_ENV === 'test') return true;

        const limit = this.limits[eventName];
        if (!limit) return true; // No limit configured for this event

        if (!this.trackers.has(socketId)) {
            this.trackers.set(socketId, new Map());
        }

        const socketTracker = this.trackers.get(socketId);
        const now = Date.now();

        if (!socketTracker.has(eventName)) {
            socketTracker.set(eventName, { count: 1, windowStart: now });
            return true;
        }

        const tracker = socketTracker.get(eventName);

        // Reset window if expired
        if (now - tracker.windowStart >= limit.windowMs) {
            tracker.count = 1;
            tracker.windowStart = now;
            return true;
        }

        // Check count
        tracker.count++;
        if (tracker.count > limit.maxPerWindow) {
            return false; // Rate limited
        }

        return true;
    }

    /**
     * Clean up tracking data for a disconnected socket
     * @param {string} socketId 
     */
    cleanup(socketId) {
        this.trackers.delete(socketId);
    }

    /**
     * Periodic cleanup of stale entries (call every few minutes)
     */
    purgeStale() {
        const now = Date.now();
        const maxAge = 5 * 60_000; // 5 minutes

        for (const [socketId, events] of this.trackers.entries()) {
            let allStale = true;
            for (const [, tracker] of events.entries()) {
                if (now - tracker.windowStart < maxAge) {
                    allStale = false;
                    break;
                }
            }
            if (allStale) {
                this.trackers.delete(socketId);
            }
        }
    }
}

// Singleton instance
const socketLimiter = new SocketRateLimiter();

// Purge stale entries every 2 minutes (skip in test to avoid open handles)
const _purgeInterval = process.env.NODE_ENV !== 'test'
    ? setInterval(() => socketLimiter.purgeStale(), 2 * 60_000)
    : null;

// Allow the timer to not block Node from exiting
if (_purgeInterval) _purgeInterval.unref();

module.exports = {
    httpLimiter,
    healthLimiter,
    socketLimiter,
    SocketRateLimiter,
};
