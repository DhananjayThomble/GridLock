const { getRedisClient } = require('./redisClient');

const REMATCH_TTL_SECONDS = 5 * 60;
const REMATCH_KEY_PREFIX = 'gridlock:rematch:';

// In-memory fallback: Map<gameId, Set<playerId>>
const rematchVotes = new Map();

function getKey(gameId) {
    return `${REMATCH_KEY_PREFIX}${gameId}`;
}

async function addVote(gameId, playerId) {
    const gameKey = String(gameId);
    const playerKey = String(playerId);

    try {
        const redis = await getRedisClient();
        if (redis) {
            const key = getKey(gameKey);
            const added = await redis.sAdd(key, playerKey);
            await redis.expire(key, REMATCH_TTL_SECONDS);
            const count = await redis.sCard(key);
            return { count, isNew: added === 1 };
        }
    } catch (error) {
        console.error('[rematchStore] Redis addVote failed, using in-memory fallback:', error.message);
    }

    let votes = rematchVotes.get(gameKey);
    if (!votes) { votes = new Set(); rematchVotes.set(gameKey, votes); }
    const before = votes.size;
    votes.add(playerKey);
    return { count: votes.size, isNew: votes.size > before };
}

async function getVoteCount(gameId) {
    const gameKey = String(gameId);

    try {
        const redis = await getRedisClient();
        if (redis) return await redis.sCard(getKey(gameKey));
    } catch (error) {
        console.error('[rematchStore] Redis getVoteCount failed, using in-memory fallback:', error.message);
    }

    const votes = rematchVotes.get(gameKey);
    return votes ? votes.size : 0;
}

async function clearVotes(gameId) {
    const gameKey = String(gameId);

    try {
        const redis = await getRedisClient();
        if (redis) { await redis.del(getKey(gameKey)); return; }
    } catch (error) {
        console.error('[rematchStore] Redis clearVotes failed, using in-memory fallback:', error.message);
    }

    rematchVotes.delete(gameKey);
}

async function storeCount() {
    try {
        const redis = await getRedisClient();
        if (redis) {
            let cursor = 0;
            let total = 0;
            do {
                const result = await redis.scan(cursor, { MATCH: `${REMATCH_KEY_PREFIX}*`, COUNT: 100 });
                cursor = result.cursor;
                total += result.keys.length;
            } while (cursor !== 0);
            return total;
        }
    } catch (error) {
        console.error('[rematchStore] Redis storeCount failed, using in-memory fallback:', error.message);
    }

    return rematchVotes.size;
}

async function removeVote(gameId, playerId) {
    const gameKey = String(gameId);
    const playerKey = String(playerId);

    try {
        const redis = await getRedisClient();
        if (redis) {
            const key = getKey(gameKey);
            const removed = await redis.sRem(key, playerKey);
            const count = await redis.sCard(key);
            return { count, wasRemoved: removed === 1 };
        }
    } catch (error) {
        console.error('[rematchStore] Redis removeVote failed, using in-memory fallback:', error.message);
    }

    const votes = rematchVotes.get(gameKey);
    if (!votes) return { count: 0, wasRemoved: false };
    const had = votes.has(playerKey);
    votes.delete(playerKey);
    return { count: votes.size, wasRemoved: had };
}

async function hasVoted(gameId, playerId) {
    const gameKey = String(gameId);
    const playerKey = String(playerId);

    try {
        const redis = await getRedisClient();
        if (redis) {
            return await redis.sIsMember(getKey(gameKey), playerKey);
        }
    } catch (error) {
        console.error('[rematchStore] Redis hasVoted failed, using in-memory fallback:', error.message);
    }

    const votes = rematchVotes.get(gameKey);
    return votes ? votes.has(playerKey) : false;
}

module.exports = { addVote, removeVote, hasVoted, getVoteCount, clearVotes, storeCount };
