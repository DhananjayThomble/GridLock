/**
 * Shared Redis client for all stores.
 * If REDIS_URL is not set, returns null — callers use in-memory fallback.
 *
 * Usage in stores: const redis = await getRedisClient();
 *                  if (!redis) { // use in-memory fallback }
 *
 * NOTE: Do NOT pre-check isRedisAvailable() before calling getRedisClient().
 * isRedisAvailable() only returns true AFTER the first connect, so checking
 * it first would prevent the initial connection from ever being established.
 */
const { createClient } = require('redis');

let client = null;
let connectPromise = null;

async function getRedisClient() {
    const url = process.env.REDIS_URL;
    if (!url) return null; // No Redis configured — use in-memory fallback

    // Already connected
    if (client && client.isReady) return client;

    // Connection in progress — wait for it rather than creating a second client
    if (connectPromise) {
        try { await connectPromise; } catch (_) { return null; }
        return client && client.isReady ? client : null;
    }

    // First call — create and connect
    client = createClient({ url });

    client.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
    });

    connectPromise = client.connect().then(() => {
        console.info('[Redis] Connected to', url);
        connectPromise = null;
    }).catch((err) => {
        console.error('[Redis] Failed to connect:', err.message);
        client = null;
        connectPromise = null;
    });

    try {
        await connectPromise;
    } catch (_) {
        return null;
    }

    return client && client.isReady ? client : null;
}

function isRedisAvailable() {
    return !!(client && client.isReady);
}

module.exports = { getRedisClient, isRedisAvailable };
