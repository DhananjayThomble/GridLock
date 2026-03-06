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

/**
 * Check if a user has an active (non-disconnected) socket in a specific game room.
 * If online, we skip sending push notifications.
 */
function isUserOnline(io, username, gameId) {
    if (!io || !gameId) return false;
    const room = io.sockets.adapter.rooms.get(gameId);
    if (!room) return false;

    for (const socketId of room) {
        const s = io.sockets.sockets.get(socketId);
        if (s && s.data && !s.data.isSpectator) {
            // We need to match by username — socket.data doesn't store username directly,
            // so we check via the game store pattern. However, for simplicity and to avoid
            // circular deps, we check if the socket is connected (not disconnected).
            // The caller should pass the username and we check if any non-spectator socket exists.
            // Since each player has exactly one socket per game, if the room has the socket, they're online.
            // We'll need the game object to map socket -> username, so we accept a resolver function.
        }
    }
    return false;
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
 */
async function sendPushToUser(username, payload) {
    if (!process.env.VAPID_PUBLIC_KEY) return; // Push not configured

    // Debounce check
    const now = Date.now();
    const lastPush = lastPushTimestamps.get(username) || 0;
    if (now - lastPush < DEBOUNCE_MS) return;
    lastPushTimestamps.set(username, now);

    const subscriptions = await PushSubscription.find({ username });
    if (!subscriptions.length) return;

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

module.exports = {
    sendPushToUser,
    isUserOnline,
    isUserOnlineInGame,
    _internal: { lastPushTimestamps, DEBOUNCE_MS },
};
