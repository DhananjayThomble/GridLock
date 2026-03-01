const { getRedisClient, isRedisAvailable } = require('./redisClient');

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

  if (isRedisAvailable()) {
    try {
      const redis = await getRedisClient();
      const key = getKey(gameKey);

      const added = await redis.sAdd(key, playerKey);
      await redis.expire(key, REMATCH_TTL_SECONDS);
      const count = await redis.sCard(key);

      return { count, isNew: added === 1 };
    } catch (error) {
      console.error('[rematchStore] Redis addVote failed, using in-memory fallback:', error);
    }
  }

  let votes = rematchVotes.get(gameKey);
  if (!votes) {
    votes = new Set();
    rematchVotes.set(gameKey, votes);
  }

  const before = votes.size;
  votes.add(playerKey);
  return { count: votes.size, isNew: votes.size > before };
}

async function getVoteCount(gameId) {
  const gameKey = String(gameId);

  if (isRedisAvailable()) {
    try {
      const redis = await getRedisClient();
      return await redis.sCard(getKey(gameKey));
    } catch (error) {
      console.error('[rematchStore] Redis getVoteCount failed, using in-memory fallback:', error);
    }
  }

  const votes = rematchVotes.get(gameKey);
  return votes ? votes.size : 0;
}

async function clearVotes(gameId) {
  const gameKey = String(gameId);

  if (isRedisAvailable()) {
    try {
      const redis = await getRedisClient();
      await redis.del(getKey(gameKey));
      return;
    } catch (error) {
      console.error('[rematchStore] Redis clearVotes failed, using in-memory fallback:', error);
    }
  }

  rematchVotes.delete(gameKey);
}

async function storeCount() {
  if (isRedisAvailable()) {
    try {
      const redis = await getRedisClient();
      let cursor = '0';
      let total = 0;

      do {
        const result = await redis.scan(cursor, {
          MATCH: `${REMATCH_KEY_PREFIX}*`,
          COUNT: 100,
        });

        cursor = result.cursor;
        total += result.keys.length;
      } while (cursor !== '0');

      return total;
    } catch (error) {
      console.error('[rematchStore] Redis storeCount failed, using in-memory fallback:', error);
    }
  }

  return rematchVotes.size;
}

module.exports = {
  addVote,
  getVoteCount,
  clearVotes,
  storeCount,
};
