// @ts-check
const { getRedisClient } = require('./redisClient');

const REMATCH_TTL_SECONDS = 5 * 60;
const REMATCH_KEY_PREFIX = 'gridlock:rematch:';

/**
 * Result of adding a rematch vote.
 * @typedef {Object} AddVoteResult
 * @property {number} count - Total distinct players who have voted for a rematch
 * @property {boolean} isNew - True if this call recorded a new vote (not a duplicate)
 */

/**
 * Result of removing a rematch vote.
 * @typedef {Object} RemoveVoteResult
 * @property {number} count - Remaining distinct players who have voted
 * @property {boolean} wasRemoved - True if a vote was actually removed
 */

// In-memory fallback: Map<gameId, Set<playerId>>
const rematchVotes = /** @type {Map<string, Set<string>>} */ (new Map());

/**
 * @param {string} gameId
 * @returns {string}
 */
function getKey(gameId) {
    return `${REMATCH_KEY_PREFIX}${gameId}`;
}

/**
 * Add a player's rematch vote for a game.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<AddVoteResult>}
 */
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

/**
 * Get the number of distinct rematch votes for a game.
 * @param {string} gameId
 * @returns {Promise<number>}
 */
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

/**
 * Clear all rematch votes for a game.
 * @param {string} gameId
 * @returns {Promise<void>}
 */
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

/**
 * Count of games that currently have at least one rematch vote.
 * @returns {Promise<number>}
 */
async function storeCount() {
    try {
        const redis = await getRedisClient();
        if (redis) {
            let cursor = '0';
            let total = 0;
            do {
                const result = await redis.scan(String(cursor), { MATCH: `${REMATCH_KEY_PREFIX}*`, COUNT: 100 });
                cursor = result.cursor;
                total += result.keys.length;
            } while (cursor !== '0');
            return total;
        }
    } catch (error) {
        console.error('[rematchStore] Redis storeCount failed, using in-memory fallback:', error.message);
    }

    return rematchVotes.size;
}

/**
 * Remove a player's rematch vote for a game.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<RemoveVoteResult>}
 */
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

/**
 * Whether a player has voted for a rematch.
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<boolean>}
 */
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
