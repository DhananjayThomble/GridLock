// @ts-check
const { getRedisClient } = require('./redisClient');

const DISCONNECT_KEY_PREFIX = 'gridlock:disconnect:';

/**
 * A tracked player disconnect. Stored in Redis (JSON-encoded, with a TTL) or in
 * the in-memory fallback Map, keyed by `${gameId}:${playerId}`.
 * @typedef {Object} DisconnectEntry
 * @property {string} socketId - Socket ID the player was connected with
 * @property {number} timestamp - Epoch ms when the disconnect was recorded
 * @property {string} gameId - Game the player disconnected from
 * @property {string} playerId - Player who disconnected
 */

// In-memory fallback: Map<`${gameId}:${playerId}`, DisconnectEntry>
const disconnects = /** @type {Map<string, DisconnectEntry>} */ (new Map());

/**
 * Build the in-memory Map key for a game/player pair.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {string}
 */
function makeTimerKey(gameId, playerId) {
    return `${gameId}:${playerId}`;
}

/**
 * Build the Redis key for a game/player pair.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {string}
 */
function getRedisKey(gameId, playerId) {
    return `${DISCONNECT_KEY_PREFIX}${gameId}:${playerId}`;
}

/**
 * Record a player disconnect with a reconnection-window TTL.
 * @param {string} gameId
 * @param {string} playerId
 * @param {string} socketId - Socket ID the player was connected with
 * @param {number} timeoutMs - Reconnection window in milliseconds
 * @returns {Promise<void>}
 */
async function setDisconnect(gameId, playerId, socketId, timeoutMs) {
    const gameKey = String(gameId);
    const playerKey = String(playerId);
    const key = makeTimerKey(gameKey, playerKey);
    const timestamp = Date.now();
    const ttlMs = Math.max(1, Number(timeoutMs) || 1);

    try {
        const redis = await getRedisClient();
        if (redis) {
            const payload = JSON.stringify({ socketId, timestamp, gameId: gameKey, playerId: playerKey });
            await redis.set(getRedisKey(gameKey, playerKey), payload, { PX: ttlMs });
            return;
        }
    } catch (error) {
        console.error('[disconnectStore] Redis setDisconnect failed, using in-memory fallback:', error.message);
    }

    disconnects.set(key, { socketId, timestamp, gameId: gameKey, playerId: playerKey });
}

/**
 * Clear a recorded disconnect (player reconnected or game ended).
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<void>}
 */
async function clearDisconnect(gameId, playerId) {
    const gameKey = String(gameId);
    const playerKey = String(playerId);

    try {
        const redis = await getRedisClient();
        if (redis) { await redis.del(getRedisKey(gameKey, playerKey)); return; }
    } catch (error) {
        console.error('[disconnectStore] Redis clearDisconnect failed, using in-memory fallback:', error.message);
    }

    disconnects.delete(makeTimerKey(gameKey, playerKey));
}

/**
 * Whether a player is currently within their disconnect window.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<boolean>}
 */
async function isDisconnected(gameId, playerId) {
    const gameKey = String(gameId);
    const playerKey = String(playerId);

    try {
        const redis = await getRedisClient();
        if (redis) {
            const exists = await redis.exists(getRedisKey(gameKey, playerKey));
            return exists === 1;
        }
    } catch (error) {
        console.error('[disconnectStore] Redis isDisconnected failed, using in-memory fallback:', error.message);
    }

    return disconnects.has(makeTimerKey(gameKey, playerKey));
}

/**
 * Get the socket ID and timestamp for a tracked disconnect, if any.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<{ socketId: string, timestamp: number }|null>}
 */
async function getDisconnectInfo(gameId, playerId) {
    const gameKey = String(gameId);
    const playerKey = String(playerId);

    try {
        const redis = await getRedisClient();
        if (redis) {
            const raw = await redis.get(getRedisKey(gameKey, playerKey));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return { socketId: parsed.socketId, timestamp: parsed.timestamp };
        }
    } catch (error) {
        console.error('[disconnectStore] Redis getDisconnectInfo failed, using in-memory fallback:', error.message);
    }

    const info = disconnects.get(makeTimerKey(gameKey, playerKey));
    return info ? { socketId: info.socketId, timestamp: info.timestamp } : null;
}

/**
 * Count of active disconnect entries across the backing store.
 * @returns {Promise<number>}
 */
async function storeCount() {
    try {
        const redis = await getRedisClient();
        if (redis) {
            let cursor = '0';
            let total = 0;
            do {
                const result = await redis.scan(String(cursor), { MATCH: `${DISCONNECT_KEY_PREFIX}*`, COUNT: 100 });
                cursor = result.cursor;
                total += result.keys.length;
            } while (String(cursor) !== '0');
            return total;
        }
    } catch (error) {
        console.error('[disconnectStore] Redis storeCount failed, using in-memory fallback:', error.message);
    }

    return disconnects.size;
}

/**
 * Return all active disconnect entries.
 * Used by recoverDisconnectTimers on server restart (#481).
 * @returns {Promise<DisconnectEntry[]>}
 */
async function getAllDisconnects() {
    const results = /** @type {DisconnectEntry[]} */ ([]);

    try {
        const redis = await getRedisClient();
        if (redis) {
            let cursor = '0';
            do {
                const result = await redis.scan(String(cursor), { MATCH: `${DISCONNECT_KEY_PREFIX}*`, COUNT: 100 });
                cursor = result.cursor;
                for (const key of result.keys) {
                    try {
                        const raw = await redis.get(key);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            results.push({
                                gameId: parsed.gameId,
                                playerId: parsed.playerId,
                                socketId: parsed.socketId,
                                timestamp: parsed.timestamp,
                            });
                        }
                    } catch (_) { /* skip malformed entries */ }
                }
            } while (String(cursor) !== '0');
            return results;
        }
    } catch (error) {
        console.error('[disconnectStore] Redis getAllDisconnects failed, using in-memory fallback:', error.message);
    }

    // In-memory fallback
    for (const [, value] of disconnects.entries()) {
        results.push({ gameId: value.gameId, playerId: value.playerId, socketId: value.socketId, timestamp: value.timestamp });
    }
    return results;
}

module.exports = { setDisconnect, clearDisconnect, isDisconnected, getDisconnectInfo, storeCount, getAllDisconnects };
