const { getRedisClient } = require('./redisClient');

const localGames = new Map();

const REDIS_KEY_PREFIX = 'gridlock:game:';
const REDIS_TTL_SECONDS = 24 * 60 * 60; // 24 hours

function getRedisKey(gameId) {
    return `${REDIS_KEY_PREFIX}${gameId}`;
}

async function getRedisIfAvailable() {
    try {
        return await getRedisClient(); // getRedisClient() returns null if REDIS_URL not set or connect fails
    } catch (error) {
        console.error('[gameStore] Redis unavailable:', error.message);
        return null;
    }
}

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

async function getAllActiveGames() {
    const redis = await getRedisIfAvailable();
    if (!redis) {
        return new Map(localGames);
    }

    try {
        // Use SCAN instead of KEYS to avoid blocking Redis in production
        let cursor = 0;
        const allKeys = [];
        do {
            const result = await redis.scan(cursor, { MATCH: `${REDIS_KEY_PREFIX}*`, COUNT: 100 });
            cursor = result.cursor;
            allKeys.push(...result.keys);
        } while (cursor !== 0);

        const games = new Map();

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

module.exports = {
    getGame,
    setGame,
    deleteGame,
    getAllActiveGames,
    gameCount,
};
