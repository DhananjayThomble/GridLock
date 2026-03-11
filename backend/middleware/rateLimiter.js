// backend/middleware/rateLimiter.js
// Rate limiting for both HTTP and Socket.IO events

const rateLimit = require('express-rate-limit');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum socket events per second per socket (global flood protection) */
const GLOBAL_EVENTS_PER_SECOND = 10;

/** @type {Record<string, { maxPerWindow: number, windowMs: number }>} */
const EVENT_LIMITS = {
    create_game:       { maxPerWindow: 5,  windowMs: 60_000 },
    join_game:         { maxPerWindow: 10, windowMs: 60_000 },
    make_move:         { maxPerWindow: 60, windowMs: 60_000 },
    request_rematch:   { maxPerWindow: 5,  windowMs: 60_000 },
    queue_join:        { maxPerWindow: 3,  windowMs: 60_000 },
    queue_leave:       { maxPerWindow: 10, windowMs: 60_000 },
    create_tournament: { maxPerWindow: 3,  windowMs: 60_000 },
    join_tournament:   { maxPerWindow: 5,  windowMs: 60_000 },
    rematch_cancel:    { maxPerWindow: 5,  windowMs: 60_000 },
};

// ─── HTTP Rate Limiter ────────────────────────────────────────────────────────

/**
 * General API rate limiter for HTTP endpoints.
 */
const httpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

/**
 * Stricter rate limiter for health/status endpoints.
 */
const healthLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── Socket.IO Rate Limiter ──────────────────────────────────────────────────

/**
 * In-memory per-socket event rate tracker.
 * Enforces both per-event limits and a global events/second cap.
 */
class SocketRateLimiter {
    constructor() {
        /** @type {Map<string, Map<string, { count: number, windowStart: number }>>} */
        this.trackers = new Map();

        /** @type {Map<string, { count: number, windowStart: number }>} global flood tracker per socket */
        this.globalTrackers = new Map();

        /** Event-specific limits */
        this.limits = { ...EVENT_LIMITS };
    }

    /**
     * Check if an event from a socket should be allowed.
     * Enforces both global (10 events/sec) and per-event limits.
     * @param {string} socketId
     * @param {string} eventName
     * @returns {boolean} true if allowed, false if rate-limited
     */
    allow(socketId, eventName) {
        if (process.env.NODE_ENV === 'test') return true;

        const now = Date.now();

        // ── Global flood check (10 events/second) ────────────────────────────
        if (!this._allowGlobal(socketId, now)) return false;

        // ── Per-event check ──────────────────────────────────────────────────
        const limit = this.limits[eventName];
        if (!limit) return true;

        if (!this.trackers.has(socketId)) {
            this.trackers.set(socketId, new Map());
        }

        const socketTracker = this.trackers.get(socketId);

        if (!socketTracker.has(eventName)) {
            socketTracker.set(eventName, { count: 1, windowStart: now });
            return true;
        }

        const tracker = socketTracker.get(eventName);

        if (now - tracker.windowStart >= limit.windowMs) {
            tracker.count = 1;
            tracker.windowStart = now;
            return true;
        }

        tracker.count++;
        return tracker.count <= limit.maxPerWindow;
    }

    /**
     * Global events-per-second check for a socket.
     * @param {string} socketId
     * @param {number} now
     * @returns {boolean}
     * @private
     */
    _allowGlobal(socketId, now) {
        const windowMs = 1000;
        const max = GLOBAL_EVENTS_PER_SECOND;

        if (!this.globalTrackers.has(socketId)) {
            this.globalTrackers.set(socketId, { count: 1, windowStart: now });
            return true;
        }

        const tracker = this.globalTrackers.get(socketId);

        if (now - tracker.windowStart >= windowMs) {
            tracker.count = 1;
            tracker.windowStart = now;
            return true;
        }

        tracker.count++;
        return tracker.count <= max;
    }

    /**
     * Clean up tracking data for a disconnected socket.
     * @param {string} socketId
     */
    cleanup(socketId) {
        this.trackers.delete(socketId);
        this.globalTrackers.delete(socketId);
    }

    /**
     * Periodic cleanup of stale entries (call every few minutes).
     */
    purgeStale() {
        const now = Date.now();
        const maxAge = 5 * 60_000;

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
                this.globalTrackers.delete(socketId);
            }
        }
    }
}

// ─── IP-Based Socket Rate Limiter ────────────────────────────────────────────

/**
 * IP-based rate limiter for socket events that need per-IP throttling
 * (queue_join, create_game, create_tournament).
 */
class IPRateLimiter {
    constructor() {
        /** @type {Map<string, Map<string, { count: number, windowStart: number }>>} */
        this.trackers = new Map();

        /** IP-specific event limits */
        this.limits = {
            queue_join:        { maxPerWindow: 3, windowMs: 60_000 },
            create_game:       { maxPerWindow: 5, windowMs: 60_000 },
            create_tournament: { maxPerWindow: 3, windowMs: 60_000 },
        };
    }

    /**
     * Check if an event from an IP should be allowed.
     * @param {string} ip
     * @param {string} eventName
     * @returns {boolean}
     */
    allow(ip, eventName) {
        if (process.env.NODE_ENV === 'test') return true;

        const limit = this.limits[eventName];
        if (!limit) return true;

        const now = Date.now();

        if (!this.trackers.has(ip)) {
            this.trackers.set(ip, new Map());
        }

        const ipTracker = this.trackers.get(ip);

        if (!ipTracker.has(eventName)) {
            ipTracker.set(eventName, { count: 1, windowStart: now });
            return true;
        }

        const tracker = ipTracker.get(eventName);

        if (now - tracker.windowStart >= limit.windowMs) {
            tracker.count = 1;
            tracker.windowStart = now;
            return true;
        }

        tracker.count++;
        return tracker.count <= limit.maxPerWindow;
    }

    /**
     * Periodic cleanup of stale entries.
     */
    purgeStale() {
        const now = Date.now();
        const maxAge = 5 * 60_000;

        for (const [ip, events] of this.trackers.entries()) {
            let allStale = true;
            for (const [, tracker] of events.entries()) {
                if (now - tracker.windowStart < maxAge) {
                    allStale = false;
                    break;
                }
            }
            if (allStale) {
                this.trackers.delete(ip);
            }
        }
    }
}

// Singleton instances
const socketLimiter = new SocketRateLimiter();
const ipLimiter = new IPRateLimiter();

// Purge stale entries every 2 minutes (skip in test to avoid open handles)
const _purgeInterval = process.env.NODE_ENV !== 'test'
    ? setInterval(() => {
        socketLimiter.purgeStale();
        ipLimiter.purgeStale();
    }, 2 * 60_000)
    : null;

if (_purgeInterval) _purgeInterval.unref();

module.exports = {
    httpLimiter,
    healthLimiter,
    socketLimiter,
    ipLimiter,
    SocketRateLimiter,
    IPRateLimiter,
    GLOBAL_EVENTS_PER_SECOND,
    EVENT_LIMITS,
};
