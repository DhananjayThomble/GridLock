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

// ─── Shared rate-check logic ─────────────────────────────────────────────────

/**
 * Check and increment a rate limit counter within a tracker Map.
 * Shared by both SocketRateLimiter and IPRateLimiter to avoid duplication.
 *
 * @param {Map} trackerMap - Map<key, { count, windowStart }>
 * @param {string} key - The counter key (event name, '__global__', etc.)
 * @param {{ maxPerWindow: number, windowMs: number }} limit
 * @param {number} now - Current timestamp (Date.now())
 * @returns {boolean} true if allowed
 */
function checkRateLimit(trackerMap, key, limit, now) {
    if (!trackerMap.has(key)) {
        trackerMap.set(key, { count: 1, windowStart: now });
        return true;
    }

    const tracker = trackerMap.get(key);

    // Reset window if expired
    if (now - tracker.windowStart >= limit.windowMs) {
        tracker.count = 1;
        tracker.windowStart = now;
        return true;
    }

    tracker.count++;
    return tracker.count <= limit.maxPerWindow;
}

/**
 * Purge stale entries from a Map<key, Map<subkey, { windowStart }>>
 * Shared by both SocketRateLimiter and IPRateLimiter.
 *
 * @param {Map} trackers - The outer tracker map
 * @param {number} maxAge - Max age in ms before an entry is considered stale
 */
function purgeStaleEntries(trackers, maxAge) {
    const now = Date.now();
    for (const [id, events] of trackers.entries()) {
        let allStale = true;
        for (const [, tracker] of events.entries()) {
            if (now - tracker.windowStart < maxAge) {
                allStale = false;
                break;
            }
        }
        if (allStale) {
            trackers.delete(id);
        }
    }
}

// ─── Socket.IO Rate Limiter ──────────────────────────────────────────────────

/**
 * In-memory per-socket event rate tracker
 * Tracks event counts per socket per time window.
 * No upper-bound cap needed: socket IDs are bounded by max concurrent connections.
 */
class SocketRateLimiter {
    constructor() {
        // Map<socketId, Map<eventName, { count, windowStart }>>
        this.trackers = new Map();

        // Global per-socket rate limit: max events per second (all events combined)
        this.globalLimit = { maxPerWindow: 10, windowMs: 1_000 }; // 10 events/sec

        // Event-specific limits: { maxPerWindow, windowMs }
        this.limits = {
            create_game:        { maxPerWindow: 5,  windowMs: 60_000 },   // 5 creates/min
            join_game:          { maxPerWindow: 10, windowMs: 60_000 },   // 10 joins/min
            make_move:          { maxPerWindow: 60, windowMs: 60_000 },   // 60 moves/min (fast play)
            request_rematch:    { maxPerWindow: 5,  windowMs: 60_000 },   // 5 rematch requests/min
            queue_join:         { maxPerWindow: 8,  windowMs: 60_000 },   // 8 queue joins/min (allows re-queue on player count change)
            queue_leave:        { maxPerWindow: 10, windowMs: 60_000 },   // 10 queue leaves/min
            create_tournament:  { maxPerWindow: 3,  windowMs: 60_000 },   // 3 tournament creates/min
            join_tournament:    { maxPerWindow: 5,  windowMs: 60_000 },   // 5 tournament joins/min
            send_game_invite:   { maxPerWindow: 10, windowMs: 60_000 },   // 10 invites/min
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

        if (!this.trackers.has(socketId)) {
            this.trackers.set(socketId, new Map());
        }
        const socketTracker = this.trackers.get(socketId);
        const now = Date.now();

        // ── Global per-socket rate check (all events combined) ──
        if (!checkRateLimit(socketTracker, '__global__', this.globalLimit, now)) {
            return false;
        }

        // ── Event-specific limit ──
        const limit = this.limits[eventName];
        if (!limit) return true; // No event-specific limit configured

        return checkRateLimit(socketTracker, eventName, limit, now);
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
        purgeStaleEntries(this.trackers, 5 * 60_000);
    }
}

// ─── IP-Based Rate Limiter for Socket Events ────────────────────────────────

/**
 * Upper bound on tracked IPs to prevent OOM from IP-space exhaustion.
 * When exceeded, new IPs are rejected (fail-closed) until stale entries are purged.
 */
const MAX_IP_TRACKER_SIZE = 10_000;

/**
 * Tracks event rates by IP address (for events like queue_join, create_game
 * where per-socket limits aren't enough — a user can open multiple sockets).
 */
class IPRateLimiter {
    constructor(maxTrackerSize = MAX_IP_TRACKER_SIZE) {
        // Map<ip, Map<eventName, { count, windowStart }>>
        this.trackers = new Map();
        this.maxTrackerSize = maxTrackerSize;

        this.limits = {
            queue_join:        { maxPerWindow: 3, windowMs: 60_000 },   // 3 queue_join/min per IP
            create_game:       { maxPerWindow: 5, windowMs: 60_000 },   // 5 create_game/min per IP
            create_tournament: { maxPerWindow: 2, windowMs: 60_000 },   // 2 tournament creates/min per IP
        };
    }

    /**
     * Check if an event from an IP should be allowed.
     * Fail-closed: if the tracker map exceeds maxTrackerSize and this is a new IP,
     * reject the request to prevent unbounded memory growth (OOM vector).
     *
     * @param {string} ip
     * @param {string} eventName
     * @returns {boolean}
     */
    allow(ip, eventName) {
        if (process.env.NODE_ENV === 'test') return true;

        const limit = this.limits[eventName];
        if (!limit) return true;

        if (!this.trackers.has(ip)) {
            // OOM guard: reject new IPs when at capacity (fail-closed)
            if (this.trackers.size >= this.maxTrackerSize) {
                return false;
            }
            this.trackers.set(ip, new Map());
        }

        const ipTracker = this.trackers.get(ip);
        const now = Date.now();

        return checkRateLimit(ipTracker, eventName, limit, now);
    }

    /**
     * Periodic cleanup of stale entries
     */
    purgeStale() {
        purgeStaleEntries(this.trackers, 5 * 60_000);
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

// Allow the timer to not block Node from exiting
if (_purgeInterval) _purgeInterval.unref();

module.exports = {
    httpLimiter,
    healthLimiter,
    socketLimiter,
    ipLimiter,
    SocketRateLimiter,
    IPRateLimiter,
    checkRateLimit,
    MAX_IP_TRACKER_SIZE,
};
