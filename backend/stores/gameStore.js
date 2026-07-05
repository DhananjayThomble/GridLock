// @ts-check
const { getRedisClient } = require('./redisClient');

/**
 * A full game state object. This store treats games opaquely — it stores,
 * serializes, caches, and returns them without inspecting their shape. The
 * canonical game shape is owned by the socket handlers and utils/gameLogic.js.
 * @typedef {Object<string, any>} StoredGame
 */

// Hot in-memory cache / single-instance fallback: Map<gameId, StoredGame>
const localGames = /** @type {Map<string, StoredGame>} */ (new Map());

const REDIS_KEY_PREFIX = 'gridlock:game:';
const REDIS_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * @param {string} gameId
 * @returns {string}
 */
function getRedisKey(gameId) {
    return `${REDIS_KEY_PREFIX}${gameId}`;
}

/**
 * Get the shared Redis client, or null if it is unavailable / not configured.
 * Typed as `any` because the client is optional and only accessed dynamically.
 * @returns {Promise<any>}
 */
async function getRedisIfAvailable() {
    try {
        return await getRedisClient(); // getRedisClient() returns null if REDIS_URL not set or connect fails
    } catch (error) {
        console.error('[gameStore] Redis unavailable:', error.message);
        return null;
    }
}

/**
 * Fetch a game by ID (Redis first, then in-memory hot cache).
 * @param {string} gameId
 * @returns {Promise<StoredGame|null>}
 */
async function getGame(gameId) {
    const redis = await getRedisIfAvailable();

    if (redis) {
        try {
            const raw = await redis.get(getRedisKey(gameId));
            if (raw) {
                const game = JSON.parse(raw);
                localGames.set(gameId, game); // hot cache
                return game;
            }
        } catch (error) {
            console.error(`[gameStore] Failed to get game ${gameId} from Redis:`, error.message);
        }
    }

    return localGames.get(gameId) || null;
}

/**
 * Store/update a game, writing through to Redis when available.
 * @param {string} gameId
 * @param {StoredGame} game
 * @returns {Promise<void>}
 */
async function setGame(gameId, game) {
    localGames.set(gameId, game);

    const redis = await getRedisIfAvailable();
    if (!redis) return;

    try {
        await redis.set(getRedisKey(gameId), JSON.stringify(game), {
            EX: REDIS_TTL_SECONDS,
        });
    } catch (error) {
        console.error(`[gameStore] Failed to set game ${gameId} in Redis:`, error.message);
    }
}

/**
 * Delete a game from both the hot cache and Redis.
 * @param {string} gameId
 * @returns {Promise<void>}
 */
async function deleteGame(gameId) {
    localGames.delete(gameId);

    const redis = await getRedisIfAvailable();
    if (!redis) return;

    try {
        await redis.del(getRedisKey(gameId));
    } catch (error) {
        console.error(`[gameStore] Failed to delete game ${gameId} from Redis:`, error.message);
    }
}

/**
 * Return all active games as a Map keyed by gameId.
 * @returns {Promise<Map<string, StoredGame>>}
 */
async function getAllActiveGames() {
    const redis = await getRedisIfAvailable();
    if (!redis) {
        return new Map(localGames);
    }

    try {
        // Use SCAN instead of KEYS to avoid blocking Redis in production
        let cursor = '0';
        const allKeys = /** @type {string[]} */ ([]);
        do {
            const result = await redis.scan(cursor, { MATCH: `${REDIS_KEY_PREFIX}*`, COUNT: 100 });
            cursor = String(result.cursor);
            allKeys.push(...result.keys);
        } while (cursor !== '0');

        const games = /** @type {Map<string, StoredGame>} */ (new Map());

        for (const key of allKeys) {
            try {
                const raw = await redis.get(key);
                if (!raw) continue;

                const game = JSON.parse(raw);
                const gameId = key.slice(REDIS_KEY_PREFIX.length);

                games.set(gameId, game);
                localGames.set(gameId, game); // keep hot cache updated
            } catch (error) {
                console.error(`[gameStore] Failed to parse game for key ${key}:`, error.message);
            }
        }

        return games;
    } catch (error) {
        console.error('[gameStore] Failed to fetch active games from Redis:', error.message);
        return new Map(localGames);
    }
}

/**
 * Count of active games in the backing store.
 * @returns {Promise<number>}
 */
async function gameCount() {
    const redis = await getRedisIfAvailable();
    if (!redis) {
        return localGames.size;
    }

    try {
        // Use SCAN instead of KEYS to avoid blocking Redis in production
        let cursor = '0';
        let total = 0;
        do {
            const result = await redis.scan(String(cursor), { MATCH: `${REDIS_KEY_PREFIX}*`, COUNT: 100 });
            cursor = result.cursor;
            total += result.keys.length;
        } while (cursor !== '0');
        return total;
    } catch (error) {
        console.error('[gameStore] Failed to count games in Redis:', error.message);
        return localGames.size;
    }
}

// ── Atomic spectator count (#303) ────────────────────────────────────────────
// Uses a dedicated Redis key per game so increments/decrements are atomic
// (INCRBY / DECRBY). Falls back to a local Map when Redis is unavailable.

const SPECTATOR_KEY_PREFIX = 'gridlock:spectators:';
// In-memory fallback: Map<gameId, spectatorCount>
const localSpectatorCounts = /** @type {Map<string, number>} */ (new Map());

/**
 * @param {string} gameId
 * @returns {string}
 */
function spectatorKey(gameId) {
    return `${SPECTATOR_KEY_PREFIX}${gameId}`;
}

/**
 * Atomically adjust the spectator count for a game.
 * @param {string} gameId
 * @param {number} delta - typically +1 (join) or -1 (leave)
 * @returns {Promise<number>} new count (floored at 0)
 */
async function adjustSpectatorCount(gameId, delta) {
    const redis = await getRedisIfAvailable();

    if (redis) {
        try {
            const newVal = await redis.incrBy(spectatorKey(gameId), delta);
            // Floor at 0 — if it went negative, reset
            if (newVal < 0) {
                await redis.set(spectatorKey(gameId), '0', { EX: REDIS_TTL_SECONDS });
                return 0;
            }
            // Set TTL to match game TTL
            await redis.expire(spectatorKey(gameId), REDIS_TTL_SECONDS);
            return newVal;
        } catch (error) {
            console.error(`[gameStore] adjustSpectatorCount Redis error for ${gameId}:`, error.message);
            // Fall through to local
        }
    }

    // In-memory fallback
    const current = localSpectatorCounts.get(gameId) || 0;
    const newVal = Math.max(0, current + delta);
    localSpectatorCounts.set(gameId, newVal);
    return newVal;
}

/**
 * Get the current spectator count for a game.
 * @param {string} gameId
 * @returns {Promise<number>}
 */
async function getSpectatorCount(gameId) {
    const redis = await getRedisIfAvailable();

    if (redis) {
        try {
            const val = await redis.get(spectatorKey(gameId));
            return val ? Math.max(0, parseInt(val, 10)) : 0;
        } catch (error) {
            console.error(`[gameStore] getSpectatorCount Redis error for ${gameId}:`, error.message);
        }
    }

    return localSpectatorCounts.get(gameId) || 0;
}

/**
 * Delete spectator count key when a game is cleaned up.
 * @param {string} gameId
 * @returns {Promise<void>}
 */
async function deleteSpectatorCount(gameId) {
    localSpectatorCounts.delete(gameId);

    const redis = await getRedisIfAvailable();
    if (!redis) return;

    try {
        await redis.del(spectatorKey(gameId));
    } catch (error) {
        console.error(`[gameStore] deleteSpectatorCount Redis error for ${gameId}:`, error.message);
    }
}

module.exports = {
    getGame,
    setGame,
    deleteGame,
    getAllActiveGames,
    gameCount,
    adjustSpectatorCount,
    getSpectatorCount,
    deleteSpectatorCount,
};
