// backend/__tests__/gameHistory.test.js
// Unit tests for the game history API endpoint

const express = require('express');
const request = require('supertest');
const gameHistoryRouter = require('../routes/gameHistory');

// Mock sanitizeUsername
jest.mock('../utils/sanitize', () => ({
  sanitizeUsername: (username) => {
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return { valid: false, error: 'Invalid username' };
    }
    const trimmed = username.trim();
    if (trimmed.length > 20) {
      return { valid: false, error: 'Username too long' };
    }
    return { valid: true, value: trimmed };
  },
}));

// Mock the GameHistory model
jest.mock('../models/GameHistory', () => {
  const mockAllGames = [
    {
      gameId: 'GAME01', username: 'alice', opponents: ['bob'], playerCount: 2,
      gridSize: 3, result: 'win', scores: { player: 5, opponent: 3 },
      eloBefore: 1000, eloAfter: 1016, duration: 120,
      playedAt: new Date('2026-03-10T10:00:00Z'),
    },
    {
      gameId: 'GAME02', username: 'alice', opponents: ['charlie'], playerCount: 2,
      gridSize: 4, result: 'loss', scores: { player: 3, opponent: 8 },
      eloBefore: 1016, eloAfter: 1000, duration: 200,
      playedAt: new Date('2026-03-09T10:00:00Z'),
    },
    {
      gameId: 'GAME03', username: 'alice', opponents: ['bob', 'charlie'], playerCount: 3,
      gridSize: 5, result: 'draw', scores: { player: 4, opponent: 4 },
      eloBefore: 1000, eloAfter: 1000, duration: 300,
      playedAt: new Date('2026-03-08T10:00:00Z'),
    },
    {
      gameId: 'GAME04', username: 'alice', opponents: ['dave'], playerCount: 2,
      gridSize: 3, result: 'win', scores: { player: 6, opponent: 2 },
      eloBefore: 1000, eloAfter: 1018, duration: 90,
      playedAt: new Date('2026-03-07T10:00:00Z'),
    },
  ];

  function mockFilterGames(query) {
    return mockAllGames.filter((g) => {
      if (query.username && g.username !== query.username) return false;
      if (query.result && g.result !== query.result) return false;
      if (query.playerCount && g.playerCount !== query.playerCount) return false;
      if (query.gridSize && g.gridSize !== query.gridSize) return false;
      return true;
    });
  }

  const mockModel = {
    countDocuments: jest.fn((query) => Promise.resolve(mockFilterGames(query).length)),
    find: jest.fn((query) => {
      const filtered = mockFilterGames(query);
      let result = [...filtered];
      const chain = {
        sort: jest.fn(() => chain),
        skip: jest.fn((n) => { result = result.slice(n); return chain; }),
        limit: jest.fn((n) => { result = result.slice(0, n); return chain; }),
        select: jest.fn(() => chain),
        lean: jest.fn(() => Promise.resolve(result)),
      };
      return chain;
    }),
    aggregate: jest.fn((pipeline) => {
      const matchStage = pipeline.find((s) => s.$match);
      const query = matchStage ? matchStage.$match : {};
      const filtered = mockFilterGames(query);

      if (filtered.length === 0) return Promise.resolve([]);

      const wins = filtered.filter((g) => g.result === 'win').length;
      const losses = filtered.filter((g) => g.result === 'loss').length;
      const draws = filtered.filter((g) => g.result === 'draw').length;
      const durations = filtered.filter((g) => g.duration != null).map((g) => g.duration);
      const avgDuration = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

      // Simulate recentResults (sorted by playedAt desc)
      const sorted = [...filtered].sort((a, b) => b.playedAt - a.playedAt);
      const mockRecentResults = sorted.map((g) => g.result);

      return Promise.resolve([{
        _id: null,
        wins,
        losses,
        draws,
        avgDuration,
        recentResults: mockRecentResults,
      }]);
    }),
  };

  return mockModel;
});

function createApp() {
  const app = express();
  app.use('/api/games/history', gameHistoryRouter);
  return app;
}

describe('Game History API', () => {
  test('GET /api/games/history returns 400 without player param', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/player/i);
  });

  test('GET /api/games/history returns 400 for invalid username', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=');
    expect(res.status).toBe(400);
  });

  test('GET /api/games/history returns games for valid player', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBe(4);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.totalCount).toBe(4);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.totalGames).toBe(4);
    expect(res.body.stats.wins).toBe(2);
    expect(res.body.stats.losses).toBe(1);
    expect(res.body.stats.draws).toBe(1);
    expect(res.body.stats.winRate).toBe(50);
  });

  test('GET /api/games/history returns eloDelta in each entry', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice');

    expect(res.status).toBe(200);
    const firstGame = res.body.history[0];
    expect(firstGame.eloDelta).toBeDefined();
    expect(typeof firstGame.eloDelta).toBe('number');
  });

  test('filters by result=win', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&result=win');

    expect(res.status).toBe(200);
    expect(res.body.history.every((g) => g.result === 'win')).toBe(true);
    expect(res.body.history.length).toBe(2);
  });

  test('filters by playerCount', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&playerCount=3');

    expect(res.status).toBe(200);
    expect(res.body.history.every((g) => g.playerCount === 3)).toBe(true);
    expect(res.body.history.length).toBe(1);
  });

  test('filters by gridSize', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&gridSize=3');

    expect(res.status).toBe(200);
    expect(res.body.history.every((g) => g.gridSize === 3)).toBe(true);
    expect(res.body.history.length).toBe(2);
  });

  test('pagination defaults to page 1 with limit 20', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice');

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.totalPages).toBe(1);
  });

  test('respects custom page and limit', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.history.length).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  test('stats include currentStreak', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice');

    expect(res.status).toBe(200);
    expect(res.body.stats.currentStreak).toBeDefined();
    expect(res.body.stats.currentStreak.type).toBeDefined();
    expect(typeof res.body.stats.currentStreak.count).toBe('number');
  });

  test('stats include avgDuration', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice');

    expect(res.status).toBe(200);
    expect(res.body.stats.avgDuration).toBeDefined();
    expect(typeof res.body.stats.avgDuration).toBe('number');
  });

  test('returns empty history for unknown player', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=unknownuser');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.history).toHaveLength(0);
    expect(res.body.stats.totalGames).toBe(0);
  });

  test('ignores invalid filter values', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&result=invalid&playerCount=abc&gridSize=999');

    expect(res.status).toBe(200);
    // Invalid result should be ignored, so we get all games
    expect(res.body.history.length).toBe(4);
  });

  test('each history entry contains required fields', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice');

    expect(res.status).toBe(200);
    const game = res.body.history[0];
    expect(game).toHaveProperty('gameId');
    expect(game).toHaveProperty('opponents');
    expect(game).toHaveProperty('playerCount');
    expect(game).toHaveProperty('gridSize');
    expect(game).toHaveProperty('result');
    expect(game).toHaveProperty('scores');
    expect(game).toHaveProperty('playedAt');
    expect(game).toHaveProperty('eloDelta');
  });

  // === skipStats support (#2) ===
  test('skipStats=true omits stats from response', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&skipStats=true');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.history.length).toBe(4);
    expect(res.body.stats).toBeUndefined();
  });

  test('skipStats=false includes stats normally', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&skipStats=false');

    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.totalGames).toBe(4);
  });

  // === Pagination edge cases (#7) ===
  test('page beyond total returns empty history', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&page=999');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.history).toHaveLength(0);
    expect(res.body.pagination.page).toBe(999);
    expect(res.body.pagination.totalCount).toBe(4);
  });

  test('limit=0 is clamped to 1', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&limit=0');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.history.length).toBe(1);
    expect(res.body.pagination.limit).toBe(1);
  });

  test('limit=100 is capped at 50', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&limit=100');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination.limit).toBe(50);
  });

  test('limit=-1 is clamped to 1', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&limit=-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.history.length).toBe(1);
    expect(res.body.pagination.limit).toBe(1);
  });

  // === NoSQL injection tests (#8) ===
  test('rejects NoSQL injection in player param: player[$gt]=', async () => {
    const app = createApp();
    // Express parses player[$gt]= as { player: { '$gt': '' } } — not a string
    const res = await request(app).get('/api/games/history?player[$gt]=');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects NoSQL injection in result param: result[$ne]=win', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&result[$ne]=win');

    expect(res.status).toBe(200);
    // result[$ne]=win is not in ['win','loss','draw'] allowlist, so filter is ignored
    // Should return all 4 games (filter not applied), NOT an injection result
    expect(res.body.history.length).toBe(4);
    // Verify no injection occurred — we should still see all result types
    const results = res.body.history.map((g) => g.result);
    expect(results).toContain('win');
  });

  test('rejects NoSQL injection in playerCount param: playerCount[$gt]=0', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&playerCount[$gt]=0');

    expect(res.status).toBe(200);
    // parseInt of an object returns NaN, so filter is ignored — all games returned
    expect(res.body.history.length).toBe(4);
  });

  test('rejects NoSQL injection in gridSize param: gridSize[$gt]=0', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/history?player=alice&gridSize[$gt]=0');

    expect(res.status).toBe(200);
    // parseInt of an object returns NaN, so filter is ignored — all games returned
    expect(res.body.history.length).toBe(4);
  });
});
