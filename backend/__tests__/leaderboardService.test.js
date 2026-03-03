const {
  buildAtomicLeaderboardUpdate,
  updateLeaderboardWithOptimisticElo,
} = require('../services/leaderboardUpdateService');

// ── buildAtomicLeaderboardUpdate unit tests ─────────────────────────────────

describe('buildAtomicLeaderboardUpdate', () => {
  test('increments wins and streak on win', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'alice',
      result: 'win',
      newElo: 1016,
      now,
    });

    expect(Array.isArray(pipeline)).toBe(true);
    expect(pipeline).toHaveLength(3);

    const firstSet = pipeline[0].$set;
    expect(firstSet.username).toBe('alice');
    expect(firstSet.elo).toBe(1016);
    expect(firstSet.gamesPlayed).toEqual({ $add: [{ $ifNull: ['$gamesPlayed', 0] }, 1] });
    expect(firstSet.wins).toEqual({ $add: [{ $ifNull: ['$wins', 0] }, 1] });
    expect(firstSet.losses).toEqual({ $add: [{ $ifNull: ['$losses', 0] }, 0] });
    expect(firstSet.draws).toEqual({ $add: [{ $ifNull: ['$draws', 0] }, 0] });
    expect(firstSet.currentStreak).toEqual({ $add: [{ $ifNull: ['$currentStreak', 0] }, 1] });
  });

  test('resets currentStreak on loss', () => {
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'bob',
      result: 'loss',
      newElo: 990,
    });

    const firstSet = pipeline[0].$set;
    expect(firstSet.losses).toEqual({ $add: [{ $ifNull: ['$losses', 0] }, 1] });
    expect(firstSet.wins).toEqual({ $add: [{ $ifNull: ['$wins', 0] }, 0] });
    expect(firstSet.currentStreak).toBe(0);
  });

  test('keeps currentStreak on draw', () => {
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'carol',
      result: 'draw',
      newElo: 1000,
    });

    const firstSet = pipeline[0].$set;
    expect(firstSet.draws).toEqual({ $add: [{ $ifNull: ['$draws', 0] }, 1] });
    expect(firstSet.currentStreak).toEqual({ $ifNull: ['$currentStreak', 0] });
  });

  test('second pipeline stage computes bestStreak on win', () => {
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'dave',
      result: 'win',
      newElo: 1020,
    });

    const secondSet = pipeline[1].$set;
    expect(secondSet.bestStreak).toEqual({ $max: ['$bestStreak', '$currentStreak'] });
  });

  test('second pipeline stage preserves bestStreak on loss', () => {
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'eve',
      result: 'loss',
      newElo: 980,
    });

    const secondSet = pipeline[1].$set;
    expect(secondSet.bestStreak).toBe('$bestStreak');
  });

  test('third pipeline stage computes winRate from wins/gamesPlayed', () => {
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'frank',
      result: 'win',
      newElo: 1010,
    });

    const thirdSet = pipeline[2].$set;
    expect(thirdSet.winRate).toBeDefined();
    expect(thirdSet.winRate.$cond).toBeDefined();
    // winRate = round((wins / gamesPlayed) * 100, 2)
    expect(thirdSet.winRate.$cond[0]).toEqual({ $gt: ['$gamesPlayed', 0] });
  });
});

// ── updateLeaderboardWithOptimisticElo integration tests ────────────────────
// These require a real MongoDB connection via the Leaderboard model.
// We mock the model to test retry logic and error handling without a DB.

describe('updateLeaderboardWithOptimisticElo', () => {
  let mockLeaderboard;

  beforeEach(() => {
    // Replace the Leaderboard model require with mocks
    mockLeaderboard = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      calculateElo: jest.fn((current, opponent, score) => {
        // Simplified ELO for testing
        const k = 32;
        const expected = 1 / (1 + Math.pow(10, (opponent - current) / 400));
        return Math.round(current + k * (score - expected));
      }),
    };

    // Patch the require cache
    jest.resetModules();
    jest.doMock('../models/Leaderboard', () => mockLeaderboard);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates new entry when player does not exist', async () => {
    const { updateLeaderboardWithOptimisticElo: updateFn } = require('../services/leaderboardUpdateService');

    mockLeaderboard.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const updatedDoc = { username: 'newplayer', elo: 1016, wins: 1 };
    mockLeaderboard.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(updatedDoc),
    });

    const result = await updateFn({
      username: 'newplayer',
      result: 'win',
      avgOpponentElo: 1000,
    });

    expect(result).toEqual(updatedDoc);
    expect(mockLeaderboard.findOne).toHaveBeenCalledWith({ username: 'newplayer' });
    // Should upsert since player doesn't exist
    const updateCall = mockLeaderboard.findOneAndUpdate.mock.calls[0];
    expect(updateCall[2].upsert).toBe(true);
  });

  test('updates existing entry with optimistic ELO filter', async () => {
    const { updateLeaderboardWithOptimisticElo: updateFn } = require('../services/leaderboardUpdateService');

    mockLeaderboard.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'abc123', elo: 1000 }),
      }),
    });

    const updatedDoc = { username: 'existing', elo: 984, losses: 1 };
    mockLeaderboard.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(updatedDoc),
    });

    const result = await updateFn({
      username: 'existing',
      result: 'loss',
      avgOpponentElo: 1000,
    });

    expect(result).toEqual(updatedDoc);
    // Should NOT upsert since player exists
    const updateCall = mockLeaderboard.findOneAndUpdate.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: 'abc123', elo: 1000 });
    expect(updateCall[2].upsert).toBe(false);
  });

  test('retries on optimistic lock miss (null return)', async () => {
    const { updateLeaderboardWithOptimisticElo: updateFn } = require('../services/leaderboardUpdateService');

    mockLeaderboard.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn()
          .mockResolvedValueOnce({ _id: 'abc', elo: 1000 })  // attempt 1
          .mockResolvedValueOnce({ _id: 'abc', elo: 1010 }), // attempt 2 (concurrent update changed elo)
      }),
    });

    const updatedDoc = { username: 'retryplayer', elo: 994 };
    mockLeaderboard.findOneAndUpdate
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })     // attempt 1 fails
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(updatedDoc) }); // attempt 2 succeeds

    const result = await updateFn({
      username: 'retryplayer',
      result: 'loss',
      avgOpponentElo: 1000,
      maxRetries: 3,
    });

    expect(result).toEqual(updatedDoc);
    expect(mockLeaderboard.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  test('retries on duplicate key error during upsert race', async () => {
    const { updateLeaderboardWithOptimisticElo: updateFn } = require('../services/leaderboardUpdateService');

    mockLeaderboard.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn()
          .mockResolvedValueOnce(null)                        // attempt 1: no doc
          .mockResolvedValueOnce({ _id: 'xyz', elo: 1000 }), // attempt 2: now exists
      }),
    });

    const dupKeyError = new Error('duplicate key');
    dupKeyError.code = 11000;

    const updatedDoc = { username: 'raceplayer', elo: 1016 };
    mockLeaderboard.findOneAndUpdate
      .mockReturnValueOnce({ lean: jest.fn().mockRejectedValue(dupKeyError) })   // attempt 1: race
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(updatedDoc) });    // attempt 2: ok

    const result = await updateFn({
      username: 'raceplayer',
      result: 'win',
      avgOpponentElo: 1000,
      maxRetries: 3,
    });

    expect(result).toEqual(updatedDoc);
  });

  test('throws after max retries exhausted', async () => {
    const { updateLeaderboardWithOptimisticElo: updateFn } = require('../services/leaderboardUpdateService');

    mockLeaderboard.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'fail', elo: 1000 }),
      }),
    });

    // Always return null (optimistic lock always misses)
    mockLeaderboard.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(updateFn({
      username: 'failplayer',
      result: 'win',
      avgOpponentElo: 1000,
      maxRetries: 2,
    })).rejects.toThrow(/Failed to update leaderboard.*after 2 retries/);
  });

  test('throws non-duplicate-key errors immediately', async () => {
    const { updateLeaderboardWithOptimisticElo: updateFn } = require('../services/leaderboardUpdateService');

    mockLeaderboard.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const dbError = new Error('connection lost');
    dbError.code = 999;
    mockLeaderboard.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockRejectedValue(dbError),
    });

    await expect(updateFn({
      username: 'errorplayer',
      result: 'win',
      avgOpponentElo: 1000,
    })).rejects.toThrow('connection lost');

    // Should NOT retry on non-duplicate-key errors
    expect(mockLeaderboard.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
