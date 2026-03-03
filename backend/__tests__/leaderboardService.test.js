const {
  buildAtomicLeaderboardUpdate,
} = require('../services/leaderboardUpdateService');

describe('leaderboardUpdateService', () => {
  test('buildAtomicLeaderboardUpdate increments wins and streak on win', () => {
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
    expect(firstSet.currentStreak).toEqual({ $add: [{ $ifNull: ['$currentStreak', 0] }, 1] });
  });

  test('buildAtomicLeaderboardUpdate resets currentStreak on loss', () => {
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'bob',
      result: 'loss',
      newElo: 990,
    });

    const firstSet = pipeline[0].$set;
    expect(firstSet.losses).toEqual({ $add: [{ $ifNull: ['$losses', 0] }, 1] });
    expect(firstSet.currentStreak).toBe(0);
  });

  test('buildAtomicLeaderboardUpdate keeps currentStreak on draw', () => {
    const pipeline = buildAtomicLeaderboardUpdate({
      username: 'carol',
      result: 'draw',
      newElo: 1000,
    });

    const firstSet = pipeline[0].$set;
    expect(firstSet.draws).toEqual({ $add: [{ $ifNull: ['$draws', 0] }, 1] });
    expect(firstSet.currentStreak).toEqual({ $ifNull: ['$currentStreak', 0] });
  });
});
