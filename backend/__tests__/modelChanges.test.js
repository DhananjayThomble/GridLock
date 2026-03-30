/**
 * backend/__tests__/modelChanges.test.js
 *
 * Tests that userId field works correctly on existing models.
 * Verifies: optional field, sparse index, can be null, can be set.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await mongoose.connection.syncIndexes();
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

const Leaderboard = require('../models/Leaderboard');
const RankedProfile = require('../models/RankedProfile');
const GameHistory = require('../models/GameHistory');
const DailyResult = require('../models/DailyResult');

describe('userId field on existing models', () => {
  describe('Leaderboard', () => {
    test('userId defaults to null', async () => {
      const lb = await Leaderboard.create({ username: 'player1' });
      expect(lb.userId).toBeNull();
    });

    test('userId can be set to an ObjectId', async () => {
      const id = new mongoose.Types.ObjectId();
      const lb = await Leaderboard.create({ username: 'player2', userId: id });
      expect(lb.userId.toString()).toBe(id.toString());
    });

    test('multiple null userId values allowed (sparse index)', async () => {
      await Leaderboard.create({ username: 'guest1' });
      await Leaderboard.create({ username: 'guest2' });
      const count = await Leaderboard.countDocuments({ userId: null });
      expect(count).toBe(2);
    });
  });

  describe('RankedProfile', () => {
    test('userId defaults to null', async () => {
      const rp = await RankedProfile.create({ username: 'ranked1' });
      expect(rp.userId).toBeNull();
    });

    test('userId can be set', async () => {
      const id = new mongoose.Types.ObjectId();
      const rp = await RankedProfile.create({ username: 'ranked2', userId: id });
      expect(rp.userId.toString()).toBe(id.toString());
    });
  });

  describe('GameHistory', () => {
    test('userId defaults to null', async () => {
      const gh = await GameHistory.create({
        gameId: 'game-1',
        username: 'histplayer',
        opponents: ['opp1'],
        playerCount: 2,
        gridSize: 3,
        result: 'win',
      });
      expect(gh.userId).toBeNull();
    });

    test('userId can be set', async () => {
      const id = new mongoose.Types.ObjectId();
      const gh = await GameHistory.create({
        gameId: 'game-2',
        username: 'histplayer2',
        opponents: ['opp2'],
        playerCount: 2,
        gridSize: 3,
        result: 'loss',
        userId: id,
      });
      expect(gh.userId.toString()).toBe(id.toString());
    });
  });

  describe('DailyResult', () => {
    test('userId defaults to null', async () => {
      const dr = await DailyResult.create({
        date: '2026-03-30',
        username: 'dailyguest',
        score: 5,
        moves: 10,
        duration: 30,
      });
      expect(dr.userId).toBeNull();
    });

    test('userId can be set', async () => {
      const id = new mongoose.Types.ObjectId();
      const dr = await DailyResult.create({
        date: '2026-03-30',
        username: 'dailyauth',
        score: 7,
        moves: 8,
        duration: 25,
        userId: id,
      });
      expect(dr.userId.toString()).toBe(id.toString());
    });

    test('sparse unique index { date: 1, userId: 1 } allows multiple nulls', async () => {
      await DailyResult.create({
        date: '2026-03-30',
        username: 'guest1',
        score: 5,
        moves: 10,
        duration: 30,
      });
      // Second guest on same date with null userId should work
      const dr = await DailyResult.create({
        date: '2026-03-30',
        username: 'guest2',
        score: 6,
        moves: 9,
        duration: 25,
      });
      expect(dr).toBeTruthy();
    });

    test('sparse unique index enforces one per userId per date', async () => {
      const id = new mongoose.Types.ObjectId();
      await DailyResult.create({
        date: '2026-03-30',
        username: 'auth1',
        score: 5,
        moves: 10,
        duration: 30,
        userId: id,
      });
      await expect(
        DailyResult.create({
          date: '2026-03-30',
          username: 'auth1_alt',
          score: 6,
          moves: 9,
          duration: 25,
          userId: id,
        })
      ).rejects.toThrow();
    });
  });
});
