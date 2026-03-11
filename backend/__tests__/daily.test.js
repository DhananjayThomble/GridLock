/**
 * backend/__tests__/daily.test.js
 *
 * Tests for daily challenge: seed determinism, result submission,
 * duplicate prevention, leaderboard ordering, streak calculation.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

const DailyChallenge = require('../models/DailyChallenge');
const DailyResult = require('../models/DailyResult');
const {
  getDayNumber,
  seededRng,
  dateSeed,
  generateBoardFromSeed,
  LAUNCH_DATE,
} = require('../routes/daily');

// ── Seed Determinism ────────────────────────────────────────────────────────
describe('Seeded RNG determinism', () => {
  test('same seed produces identical sequence', () => {
    const rng1 = seededRng(42);
    const rng2 = seededRng(42);
    const seq1 = Array.from({ length: 20 }, () => rng1());
    const seq2 = Array.from({ length: 20 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  test('different seeds produce different sequences', () => {
    const rng1 = seededRng(42);
    const rng2 = seededRng(99);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).not.toEqual(seq2);
  });

  test('dateSeed returns consistent hash for same date', () => {
    expect(dateSeed('2026-03-11')).toBe(dateSeed('2026-03-11'));
  });

  test('dateSeed returns different hashes for different dates', () => {
    expect(dateSeed('2026-03-11')).not.toBe(dateSeed('2026-03-12'));
  });
});

// ── Board Generation ────────────────────────────────────────────────────────
describe('Board generation from seed', () => {
  test('same date produces identical board', () => {
    const board1 = generateBoardFromSeed('2026-03-11', 3);
    const board2 = generateBoardFromSeed('2026-03-11', 3);
    expect(board1).toEqual(board2);
  });

  test('different dates produce different boards', () => {
    const board1 = generateBoardFromSeed('2026-03-11', 3);
    const board2 = generateBoardFromSeed('2026-03-12', 3);
    // At least one line should differ
    const flat1 = JSON.stringify(board1);
    const flat2 = JSON.stringify(board2);
    expect(flat1).not.toEqual(flat2);
  });

  test('board has correct dimensions for 3x3 grid', () => {
    const board = generateBoardFromSeed('2026-03-11', 3);
    // Horizontal lines: (3+1) rows x 3 cols = 4x3
    expect(board.predrawnH.length).toBe(4);
    expect(board.predrawnH[0].length).toBe(3);
    // Vertical lines: 3 rows x (3+1) cols = 3x4
    expect(board.predrawnV.length).toBe(3);
    expect(board.predrawnV[0].length).toBe(4);
  });

  test('board has correct dimensions for 5x5 grid', () => {
    const board = generateBoardFromSeed('2026-04-01', 5);
    expect(board.predrawnH.length).toBe(6);
    expect(board.predrawnH[0].length).toBe(5);
    expect(board.predrawnV.length).toBe(5);
    expect(board.predrawnV[0].length).toBe(6);
  });

  test('no box is fully completed by pre-drawn lines', () => {
    // Test multiple dates to be thorough
    for (const date of ['2026-03-01', '2026-06-15', '2026-12-31']) {
      const board = generateBoardFromSeed(date, 3);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const sides = [
            board.predrawnH[r][c],
            board.predrawnH[r + 1][c],
            board.predrawnV[r][c],
            board.predrawnV[r][c + 1],
          ];
          const allDrawn = sides.every((s) => s === 1);
          expect(allDrawn).toBe(false);
        }
      }
    }
  });
});

// ── Day Numbering ───────────────────────────────────────────────────────────
describe('Day numbering', () => {
  test('launch date is day 1', () => {
    expect(getDayNumber(LAUNCH_DATE)).toBe(1);
  });

  test('day after launch is day 2', () => {
    expect(getDayNumber('2026-03-02')).toBe(2);
  });

  test('10 days after launch is day 11', () => {
    expect(getDayNumber('2026-03-11')).toBe(11);
  });
});

// ── DailyChallenge Model ────────────────────────────────────────────────────
describe('DailyChallenge model', () => {
  test('creates a challenge document', async () => {
    const doc = await DailyChallenge.create({
      date: '2026-03-11',
      seed: '2026-03-11',
      gridSize: 3,
      dayNumber: 11,
    });
    expect(doc.date).toBe('2026-03-11');
    expect(doc.seed).toBe('2026-03-11');
    expect(doc.gridSize).toBe(3);
    expect(doc.dayNumber).toBe(11);
  });

  test('enforces unique date constraint', async () => {
    await DailyChallenge.create({
      date: '2026-03-11',
      seed: '2026-03-11',
      gridSize: 3,
      dayNumber: 11,
    });
    await expect(
      DailyChallenge.create({
        date: '2026-03-11',
        seed: '2026-03-11',
        gridSize: 3,
        dayNumber: 11,
      })
    ).rejects.toThrow();
  });
});

// ── DailyResult Model & Duplicate Prevention ────────────────────────────────
describe('DailyResult model', () => {
  test('creates a result document', async () => {
    const doc = await DailyResult.create({
      date: '2026-03-11',
      username: 'alice',
      score: 5,
      moves: 12,
      duration: 45,
    });
    expect(doc.date).toBe('2026-03-11');
    expect(doc.username).toBe('alice');
    expect(doc.score).toBe(5);
    expect(doc.moves).toBe(12);
    expect(doc.duration).toBe(45);
    expect(doc.completedAt).toBeDefined();
  });

  test('prevents duplicate submission (same user + same date)', async () => {
    await DailyResult.create({
      date: '2026-03-11',
      username: 'alice',
      score: 5,
      moves: 12,
      duration: 45,
    });
    await expect(
      DailyResult.create({
        date: '2026-03-11',
        username: 'alice',
        score: 7,
        moves: 10,
        duration: 30,
      })
    ).rejects.toThrow();
  });

  test('allows same user on different dates', async () => {
    await DailyResult.create({
      date: '2026-03-11',
      username: 'alice',
      score: 5,
      moves: 12,
      duration: 45,
    });
    const doc = await DailyResult.create({
      date: '2026-03-12',
      username: 'alice',
      score: 7,
      moves: 10,
      duration: 30,
    });
    expect(doc.date).toBe('2026-03-12');
  });

  test('allows different users on same date', async () => {
    await DailyResult.create({
      date: '2026-03-11',
      username: 'alice',
      score: 5,
      moves: 12,
      duration: 45,
    });
    const doc = await DailyResult.create({
      date: '2026-03-11',
      username: 'bob',
      score: 3,
      moves: 14,
      duration: 60,
    });
    expect(doc.username).toBe('bob');
  });
});

// ── Leaderboard Ordering ────────────────────────────────────────────────────
describe('Leaderboard ordering', () => {
  test('ranks by score descending, then moves ascending', async () => {
    await DailyResult.create([
      { date: '2026-03-11', username: 'alice', score: 5, moves: 12, duration: 45 },
      { date: '2026-03-11', username: 'bob', score: 7, moves: 10, duration: 30 },
      { date: '2026-03-11', username: 'charlie', score: 7, moves: 8, duration: 25 },
      { date: '2026-03-11', username: 'diana', score: 3, moves: 15, duration: 60 },
    ]);

    const results = await DailyResult.find({ date: '2026-03-11' })
      .sort({ score: -1, moves: 1, duration: 1 })
      .lean();

    expect(results[0].username).toBe('charlie'); // 7 score, 8 moves (fewer)
    expect(results[1].username).toBe('bob');     // 7 score, 10 moves
    expect(results[2].username).toBe('alice');   // 5 score
    expect(results[3].username).toBe('diana');   // 3 score
  });

  test('tiebreaker by duration when score and moves are equal', async () => {
    await DailyResult.create([
      { date: '2026-03-11', username: 'alice', score: 5, moves: 10, duration: 60 },
      { date: '2026-03-11', username: 'bob', score: 5, moves: 10, duration: 30 },
    ]);

    const results = await DailyResult.find({ date: '2026-03-11' })
      .sort({ score: -1, moves: 1, duration: 1 })
      .lean();

    expect(results[0].username).toBe('bob');   // Same score/moves, faster
    expect(results[1].username).toBe('alice');
  });
});

// ── Streak Calculation ──────────────────────────────────────────────────────
describe('Streak calculation', () => {
  test('calculates consecutive day streak', async () => {
    // Create results for 5 consecutive days
    const dates = ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11'];
    for (const date of dates) {
      await DailyResult.create({
        date,
        username: 'streaker',
        score: 5,
        moves: 10,
        duration: 30,
      });
    }

    const results = await DailyResult.find({ username: 'streaker' })
      .sort({ date: -1 })
      .select('date')
      .lean();

    const playedDates = new Set(results.map((r) => r.date));
    const sortedDates = [...playedDates].sort();

    let bestStreak = 1;
    let streak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1] + 'T00:00:00Z');
      const curr = new Date(sortedDates[i] + 'T00:00:00Z');
      const diffDays = (curr - prev) / (24 * 60 * 60 * 1000);
      if (diffDays === 1) {
        streak++;
      } else {
        bestStreak = Math.max(bestStreak, streak);
        streak = 1;
      }
    }
    bestStreak = Math.max(bestStreak, streak);

    expect(bestStreak).toBe(5);
  });

  test('streak breaks on gap days', async () => {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-04', '2026-03-05'];
    for (const date of dates) {
      await DailyResult.create({
        date,
        username: 'gapper',
        score: 5,
        moves: 10,
        duration: 30,
      });
    }

    const results = await DailyResult.find({ username: 'gapper' })
      .sort({ date: 1 })
      .select('date')
      .lean();

    const sortedDates = results.map((r) => r.date);
    let bestStreak = 1;
    let streak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1] + 'T00:00:00Z');
      const curr = new Date(sortedDates[i] + 'T00:00:00Z');
      const diffDays = (curr - prev) / (24 * 60 * 60 * 1000);
      if (diffDays === 1) {
        streak++;
      } else {
        bestStreak = Math.max(bestStreak, streak);
        streak = 1;
      }
    }
    bestStreak = Math.max(bestStreak, streak);

    expect(bestStreak).toBe(2); // max consecutive is 2
  });

  test('badges awarded at 7, 30, 100 day thresholds', () => {
    const getBadges = (streakLen) => {
      const badges = [];
      if (streakLen >= 7) badges.push('🔥7');
      if (streakLen >= 30) badges.push('🔥30');
      if (streakLen >= 100) badges.push('🔥100');
      return badges;
    };

    expect(getBadges(3)).toEqual([]);
    expect(getBadges(7)).toEqual(['🔥7']);
    expect(getBadges(15)).toEqual(['🔥7']);
    expect(getBadges(30)).toEqual(['🔥7', '🔥30']);
    expect(getBadges(100)).toEqual(['🔥7', '🔥30', '🔥100']);
  });
});

// ── Star Rating ─────────────────────────────────────────────────────────────
describe('Star rating calculation', () => {
  const getStars = (score, totalBoxes) => {
    const pct = totalBoxes > 0 ? score / totalBoxes : 0;
    if (pct > 0.66) return 3;
    if (pct >= 0.33) return 2;
    return 1;
  };

  test('1 star for < 33% boxes', () => {
    expect(getStars(2, 9)).toBe(1); // 22%
  });

  test('2 stars for 33-66% boxes', () => {
    expect(getStars(3, 9)).toBe(2); // 33%
    expect(getStars(5, 9)).toBe(2); // 55%
  });

  test('3 stars for > 66% boxes', () => {
    expect(getStars(7, 9)).toBe(3); // 78%
    expect(getStars(9, 9)).toBe(3); // 100%
  });
});
