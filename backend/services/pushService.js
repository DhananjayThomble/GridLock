const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Configure VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:noreply@gridlock.app',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Debounce: track last push timestamp per username
const lastPushTimestamps = new Map();
const DEBOUNCE_MS = 10_000;

// Hourly rate limit: max 5 notifications per user per hour
const HOURLY_LIMIT = 5;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;
// Map<username, Array<timestamp>> — sliding window of push timestamps
const hourlyPushLog = new Map();

/**
 * Check hourly rate limit for a user. Returns true if within limit.
 * Prunes expired entries from the sliding window.
 */
function checkHourlyLimit(username) {
    const now = Date.now();
    const cutoff = now - HOURLY_WINDOW_MS;
    let log = hourlyPushLog.get(username);
    if (!log) {
        log = [];
        hourlyPushLog.set(username, log);
    }
    // Prune entries older than 1 hour
    while (log.length > 0 && log[0] <= cutoff) {
        log.shift();
    }
    return log.length < HOURLY_LIMIT;
}

/**
 * Record a push send in the hourly rate limit window.
 */
function recordHourlySend(username) {
    let log = hourlyPushLog.get(username);
    if (!log) {
        log = [];
        hourlyPushLog.set(username, log);
    }
    log.push(Date.now());
}

/**
 * Check if a user is online by looking at sockets in a game room.
 * @param {object} io - Socket.IO server instance
 * @param {string} username - Username to check
 * @param {string} gameId - Game room ID
 * @param {object} game - Game object with players map
 * @returns {boolean}
 */
function isUserOnlineInGame(io, username, gameId, game) {
    if (!io || !gameId || !game) return false;
    const room = io.sockets.adapter.rooms.get(gameId);
    if (!room) return false;

    // Find the player entry matching the username
    for (let i = 1; i <= (game.playerCount || 4); i++) {
        const player = game.players[`player${i}`];
        if (player && player.username === username && !player.isCPU) {
            // Check if their socket ID is in the room
            if (room.has(player.id)) return true;
        }
    }
    return false;
}

/**
 * Send push notification to all subscriptions for a given username.
 * Handles 410 Gone by auto-deleting expired subscriptions.
 * Debounces: max 1 push per user per DEBOUNCE_MS.
 * Rate limited: max HOURLY_LIMIT pushes per user per hour.
 */
async function sendPushToUser(username, payload) {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return; // Push not configured

    // Debounce check
    const now = Date.now();
    const lastPush = lastPushTimestamps.get(username) || 0;
    if (now - lastPush < DEBOUNCE_MS) return;

    // Hourly rate limit check
    if (!checkHourlyLimit(username)) return;

    const subscriptions = await PushSubscription.find({ username });
    if (!subscriptions.length) return;
    lastPushTimestamps.set(username, now);
    recordHourlySend(username);

    const payloadStr = JSON.stringify(payload);

    const results = await Promise.allSettled(
        subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    {
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
                    },
                    payloadStr
                );
            } catch (err) {
                // 410 Gone or 404 — subscription expired, clean up
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await PushSubscription.deleteOne({ endpoint: sub.endpoint });
                }
                throw err;
            }
        })
    );

    return results;
}

// Fix #4: Periodic cleanup of stale rate limit entries to prevent unbounded growth
const CLEANUP_INTERVAL_MS = 30 * 60_000; // 30 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 60_000; // 2 hours

function sweepRateLimitMaps() {
    const cutoff = Date.now() - STALE_THRESHOLD_MS;

    for (const [username, ts] of lastPushTimestamps.entries()) {
        if (ts < cutoff) lastPushTimestamps.delete(username);
    }

    for (const [username, log] of hourlyPushLog.entries()) {
        // Prune old entries
        while (log.length > 0 && log[0] < cutoff) log.shift();
        if (log.length === 0) hourlyPushLog.delete(username);
    }
}

const _cleanupInterval = process.env.NODE_ENV !== 'test'
    ? setInterval(sweepRateLimitMaps, CLEANUP_INTERVAL_MS)
    : null;
if (_cleanupInterval) _cleanupInterval.unref();

module.exports = {
    sendPushToUser,
    isUserOnlineInGame,
    _internal: { lastPushTimestamps, DEBOUNCE_MS, hourlyPushLog, HOURLY_LIMIT, HOURLY_WINDOW_MS, checkHourlyLimit, recordHourlySend, sweepRateLimitMaps },
};
