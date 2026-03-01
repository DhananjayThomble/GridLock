/**
 * Shared Redis client for all stores.
 * If REDIS_URL is not set, provides a graceful in-memory fallback
 * so single-instance deployments work without Redis.
 */
const { createClient } = require('redis');

let client = null;
let isConnected = false;

async function getRedisClient() {
    if (client && isConnected) return client;
    if (client) return client; // connecting in progress

    const url = process.env.REDIS_URL;
    if (!url) return null; // No Redis configured — caller should use in-memory fallback

    client = createClient({ url });

    client.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
        isConnected = false;
    });

    client.on('connect', () => {
        isConnected = true;
    });

    client.on('reconnecting', () => {
        isConnected = false;
    });

    await client.connect();
    isConnected = true;
    return client;
}

function isRedisAvailable() {
    return isConnected && client !== null;
}

module.exports = { getRedisClient, isRedisAvailable };
