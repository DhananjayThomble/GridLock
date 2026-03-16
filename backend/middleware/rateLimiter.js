// backend/middleware/rateLimiter.js
// Rate limiting for both HTTP and Socket.IO events

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// ─── IP Normalization (#302) ─────────────────────────────────────────────────

/**
 * Normalize IPv4-mapped IPv6 addresses to their IPv4 equivalents.
 * e.g. "::ffff:192.168.1.1" → "192.168.1.1"
 *
 * This prevents bypass of per-IP rate limits where the same client
 * appears as two different IPs depending on the network stack.
 * Used by our custom socket limiters (IPRateLimiter, connection tracker)
 * which don't go through express-rate-limit's built-in normalization.
 *
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
    if (!ip) return '';
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
}

// ─── HTTP Rate Limiter ────────────────────────────────────────────────────────

/**
 * General API rate limiter for HTTP endpoints
 */
const httpLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,  // 1 minute (#288 — was 15 minutes, shorter window recovers faster)
    max: 60,                    // 60 requests per minute (was 100/15min)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    // Normalize IPv4-mapped IPv6 + group IPv6 /56 subnets (#302)
    keyGenerator: (req) => {
        const ip = req.ip || req.connection?.remoteAddress || '';
        return ipKeyGenerator(normalizeIp(ip));
    },
});

/**
 * Stricter rate limiter for health/status endpoints
 */
const healthLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    // Normalize IPv4-mapped IPv6 + group IPv6 /56 subnets (#302)
    keyGenerator: (req) => {
        const ip = req.ip || req.connection?.remoteAddress || '';
        return ipKeyGenerator(normalizeIp(ip));
    },
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

        // IP-based limits are intentionally higher than per-socket limits because
        // multiple legitimate users (e.g. household, office, university) share a
        // single public IP.  Previous values (create_game: 5, queue_join: 3) were
        // too aggressive and caused false-positive rate limiting during normal
        // gameplay and automated testing.  See GitHub issue #203.
        this.limits = {
            queue_join:        { maxPerWindow: 10, windowMs: 60_000 },  // 10 queue_join/min per IP
            create_game:       { maxPerWindow: 15, windowMs: 60_000 },  // 15 create_game/min per IP
            create_tournament: { maxPerWindow: 2,  windowMs: 60_000 },  // 2 tournament creates/min per IP
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

// ─── Per-IP WebSocket Connection Limiter (#286) ─────────────────────────────

/**
 * Per-IP WebSocket connection limiter.
 * Limits the number of concurrent socket connections from a single IP.
 */
const MAX_SOCKETS_PER_IP = 50;

/**
 * Upper bound on tracked IPs to prevent OOM from IP-space exhaustion.
 * When exceeded, new IPs are rejected (fail-closed) until existing IPs disconnect.
 * Consistent with the IPRateLimiter OOM guard pattern (MAX_IP_TRACKER_SIZE).
 */
const MAX_TRACKED_IPS = 10_000;

const socketConnectionTracker = new Map(); // Map<ip, Set<socketId>>

/**
 * Track a new socket connection for an IP.
 * @param {string} ip
 * @param {string} socketId
 * @returns {boolean} true if tracked, false if rejected (OOM guard — too many distinct IPs)
 */
function trackSocketConnection(ip, socketId) {
    if (!socketConnectionTracker.has(ip)) {
        // OOM guard: reject new IPs when at capacity
        if (socketConnectionTracker.size >= MAX_TRACKED_IPS) {
            return false;
        }
        socketConnectionTracker.set(ip, new Set());
    }
    socketConnectionTracker.get(ip).add(socketId);
    return true;
}

function untrackSocketConnection(ip, socketId) {
    ip = normalizeIp(ip); // Normalize IPv4-mapped IPv6 (#302)
    if (socketConnectionTracker.has(ip)) {
        socketConnectionTracker.get(ip).delete(socketId);
        if (socketConnectionTracker.get(ip).size === 0) {
            socketConnectionTracker.delete(ip);
        }
    }
}

function getSocketCountForIP(ip) {
    ip = normalizeIp(ip); // Normalize IPv4-mapped IPv6 (#302)
    return socketConnectionTracker.has(ip) ? socketConnectionTracker.get(ip).size : 0;
}

module.exports = {
    httpLimiter,
    healthLimiter,
    socketLimiter,
    ipLimiter,
    normalizeIp,
    SocketRateLimiter,
    IPRateLimiter,
    checkRateLimit,
    MAX_IP_TRACKER_SIZE,
    MAX_SOCKETS_PER_IP,
    MAX_TRACKED_IPS,
    trackSocketConnection,
    untrackSocketConnection,
    getSocketCountForIP,
};
