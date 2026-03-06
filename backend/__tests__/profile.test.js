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

describe('GameHistory Model', () => {
  const GameHistory = require('../models/GameHistory');

  it('should create a game history record', async () => {
    const doc = await GameHistory.create({
      gameId: 'ABC123',
      username: 'testuser',
      opponents: ['opponent1'],
      playerCount: 2,
      gridSize: 3,
      result: 'win',
      scores: { player: 10, opponent: 5 },
      eloBefore: 1000,
      eloAfter: 1020,
      duration: 120,
    });

    expect(doc.gameId).toBe('ABC123');
    expect(doc.username).toBe('testuser');
    expect(doc.opponents).toEqual(['opponent1']);
    expect(doc.result).toBe('win');
    expect(doc.scores.player).toBe(10);
    expect(doc.scores.opponent).toBe(5);
    expect(doc.eloBefore).toBe(1000);
    expect(doc.eloAfter).toBe(1020);
    expect(doc.duration).toBe(120);
    expect(doc.playedAt).toBeDefined();
  });

  it('should reject invalid result values', async () => {
    await expect(
      GameHistory.create({
        gameId: 'ABC123',
        username: 'testuser',
        opponents: [],
        playerCount: 2,
        gridSize: 3,
        result: 'invalid',
      })
    ).rejects.toThrow();
  });

  it('should require gameId, username, playerCount, gridSize, result', async () => {
    await expect(GameHistory.create({})).rejects.toThrow();
  });
});

describe('Leaderboard eloHistory', () => {
  const Leaderboard = require('../models/Leaderboard');
  const { updateLeaderboardWithOptimisticElo } = require('../services/leaderboardUpdateService');

  it('should push eloHistory entries on update', async () => {
    const updated = await updateLeaderboardWithOptimisticElo({
      username: 'elotest',
      result: 'win',
      avgOpponentElo: 1000,
      fallbackElo: 1000,
      gameId: 'GAME1',
    });

    expect(updated.eloHistory).toBeDefined();
    expect(updated.eloHistory.length).toBe(1);
    expect(updated.eloHistory[0].gameId).toBe('GAME1');
    expect(updated.eloHistory[0].elo).toBe(updated.elo);
  });

  it('should cap eloHistory at 50 entries', async () => {
    // Create a player with 49 eloHistory entries via findOneAndUpdate
    await Leaderboard.findOneAndUpdate(
      { username: 'captest' },
      {
        $set: {
          username: 'captest',
          elo: 1000,
          gamesPlayed: 49,
          wins: 25,
          losses: 24,
          draws: 0,
          winRate: 51.02,
          eloHistory: Array.from({ length: 49 }, (_, i) => ({
            elo: 1000 + i,
            date: new Date(),
            gameId: `G${i}`,
          })),
        },
      },
      { upsert: true, new: true },
    );

    // Run 3 more updates to push beyond 50
    for (let i = 0; i < 3; i++) {
      await updateLeaderboardWithOptimisticElo({
        username: 'captest',
        result: 'win',
        avgOpponentElo: 1000,
        fallbackElo: 1000,
        gameId: `EXTRA${i}`,
      });
    }

    const player = await Leaderboard.findOne({ username: 'captest' }).lean();
    expect(player.eloHistory.length).toBeLessThanOrEqual(50);
  });
});

describe('Profile API Route', () => {
  const express = require('express');
  const request = require('supertest');
  const Leaderboard = require('../models/Leaderboard');
  const GameHistory = require('../models/GameHistory');

  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/profile', require('../routes/profile'));
  });

  it('should return 404 for unknown player', async () => {
    const res = await request(app).get('/api/profile/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('should return player profile with correct structure', async () => {
    // Seed leaderboard via findOneAndUpdate (bypasses pre-save hook)
    await Leaderboard.findOneAndUpdate(
      { username: 'profiletest' },
      {
        $set: {
          username: 'profiletest',
          gamesPlayed: 10,
          wins: 7,
          losses: 2,
          draws: 1,
          winRate: 70,
          elo: 1100,
          bestStreak: 5,
          currentStreak: 3,
          eloHistory: [
            { elo: 1000, date: new Date(), gameId: 'G1' },
            { elo: 1050, date: new Date(), gameId: 'G2' },
          ],
        },
      },
      { upsert: true, new: true },
    );

    // Seed game history
    await GameHistory.create({
      gameId: 'G1',
      username: 'profiletest',
      opponents: ['rival1'],
      playerCount: 2,
      gridSize: 3,
      result: 'win',
      scores: { player: 8, opponent: 3 },
      eloBefore: 1000,
      eloAfter: 1050,
      duration: 90,
    });

    const res = await request(app).get('/api/profile/profiletest');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const profile = res.body.profile;
    expect(profile.username).toBe('profiletest');
    expect(profile.gamesPlayed).toBe(10);
    expect(profile.wins).toBe(7);
    expect(profile.elo).toBe(1100);
    expect(profile.rank).toBeDefined();
    expect(profile.eloHistory).toHaveLength(2);
    expect(profile.recentMatches).toHaveLength(1);
    expect(profile.computed).toBeDefined();
    expect(profile.computed.favoriteGridSize).toBe(3);
    expect(profile.computed.mostPlayedOpponent).toBe('rival1');
  });

  it('should return 400 for invalid username', async () => {
    const res = await request(app).get('/api/profile/');
    // Express will not match /:username with empty string, so it's 404
    expect([400, 404]).toContain(res.status);
  });
});
