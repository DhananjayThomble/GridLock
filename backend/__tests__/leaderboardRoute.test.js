/**
 * backend/__tests__/leaderboardRoute.test.js
 *
 * HTTP integration tests for the leaderboard REST route (routes/leaderboard.js).
 * These exercise the Express handlers end-to-end against an in-memory MongoDB,
 * complementing leaderboard.test.js (which unit-tests the underlying logic).
 *
 * Pattern mirrors profile.test.js / authIntegration.test.js:
 *   - mongodb-memory-server for an isolated DB
 *   - route mounted on a minimal express app
 *   - supertest to drive requests
 *   - beforeAll/afterAll/afterEach DB lifecycle
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');

const Leaderboard = require('../models/Leaderboard');
const leaderboardRouter = require('../routes/leaderboard');
const log = require('../utils/logger');

let mongoServer;
let app;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    app = express();
    app.use(express.json());
    app.use('/api/leaderboard', leaderboardRouter);
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
    jest.restoreAllMocks();
});

// Seed helper — uses .create() so the pre-save hook computes winRate from wins/gamesPlayed.
async function seedPlayers(players) {
    return Leaderboard.create(players);
}

describe('GET /api/leaderboard', () => {
    test('returns empty leaderboard when no players exist', async () => {
        const res = await request(app).get('/api/leaderboard');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.count).toBe(0);
        expect(res.body.leaderboard).toEqual([]);
    });

    test('returns players sorted by wins, then winRate, then elo (desc)', async () => {
        await seedPlayers([
            // 10 wins -> ranks first regardless of elo
            { username: 'alice', gamesPlayed: 10, wins: 10, losses: 0, draws: 0, elo: 1000, bestStreak: 10, currentStreak: 10 },
            // tie on wins (8) with carol; higher winRate (80 vs 50) -> ranks above carol
            { username: 'bob', gamesPlayed: 10, wins: 8, losses: 2, draws: 0, elo: 2000 },
            { username: 'carol', gamesPlayed: 16, wins: 8, losses: 8, draws: 0, elo: 1500 },
        ]);

        const res = await request(app).get('/api/leaderboard');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.count).toBe(3);

        const usernames = res.body.leaderboard.map((p) => p.username);
        expect(usernames).toEqual(['alice', 'bob', 'carol']);

        // Ranks are 1-based and sequential
        expect(res.body.leaderboard.map((p) => p.rank)).toEqual([1, 2, 3]);

        // Entry shape
        const top = res.body.leaderboard[0];
        expect(top).toMatchObject({
            rank: 1,
            username: 'alice',
            gamesPlayed: 10,
            wins: 10,
            losses: 0,
            draws: 0,
            winRate: 100,
            bestStreak: 10,
            currentStreak: 10,
            elo: 1000,
        });
        expect(top).toHaveProperty('memberSince');
        expect(top).toHaveProperty('lastPlayedAt');
    });

    test('respects the limit query param', async () => {
        await seedPlayers([
            { username: 'p1', gamesPlayed: 5, wins: 5, losses: 0, elo: 1300 },
            { username: 'p2', gamesPlayed: 5, wins: 4, losses: 1, elo: 1200 },
            { username: 'p3', gamesPlayed: 5, wins: 3, losses: 2, elo: 1100 },
        ]);

        const res = await request(app).get('/api/leaderboard?limit=2');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
        expect(res.body.leaderboard).toHaveLength(2);
    });

    test('falls back to default limit when limit is non-numeric', async () => {
        await seedPlayers([
            { username: 'p1', gamesPlayed: 5, wins: 5, losses: 0, elo: 1300 },
            { username: 'p2', gamesPlayed: 5, wins: 4, losses: 1, elo: 1200 },
        ]);

        const res = await request(app).get('/api/leaderboard?limit=notanumber');
        expect(res.status).toBe(200);
        // default limit is 10, so both seeded players come back
        expect(res.body.count).toBe(2);
    });

    test('returns 500 when the DB query fails', async () => {
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(Leaderboard, 'find').mockImplementation(() => {
            throw new Error('boom');
        });

        const res = await request(app).get('/api/leaderboard');
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/failed to fetch leaderboard/i);
    });
});

describe('GET /api/leaderboard/:username', () => {
    test('returns 404 for an unknown player', async () => {
        const res = await request(app).get('/api/leaderboard/nonexistent');
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/not found/i);
    });

    test('returns 400 for an invalid username', async () => {
        const res = await request(app).get(
            '/api/leaderboard/' + encodeURIComponent('<script>')
        );
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/invalid username/i);
    });

    test('returns a player with a computed rank', async () => {
        await seedPlayers([
            { username: 'alice', gamesPlayed: 12, wins: 10, losses: 2, draws: 0, elo: 1300 },
            { username: 'bob', gamesPlayed: 10, wins: 5, losses: 5, draws: 0, elo: 1100 },
        ]);

        const resBob = await request(app).get('/api/leaderboard/bob');
        expect(resBob.status).toBe(200);
        expect(resBob.body.success).toBe(true);
        expect(resBob.body.player).toMatchObject({
            rank: 2, // alice (10 wins) outranks bob (5 wins)
            username: 'bob',
            gamesPlayed: 10,
            wins: 5,
            losses: 5,
            elo: 1100,
        });
        expect(resBob.body.player).toHaveProperty('memberSince');

        const resAlice = await request(app).get('/api/leaderboard/alice');
        expect(resAlice.status).toBe(200);
        expect(resAlice.body.player.rank).toBe(1);
    });

    test('returns 500 when the DB query fails', async () => {
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(Leaderboard, 'findOne').mockImplementation(() => {
            throw new Error('boom');
        });

        const res = await request(app).get('/api/leaderboard/alice');
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/failed to fetch player stats/i);
    });
});

describe('POST /api/leaderboard', () => {
    test('returns 400 when username is missing', async () => {
        const res = await request(app).post('/api/leaderboard').send({ result: 'win' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/username is required/i);
    });

    test('returns 400 for an invalid username', async () => {
        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: '<script>', result: 'win' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('returns 400 when result is missing', async () => {
        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: 'validuser' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/result must be one of/i);
    });

    test('returns 400 for an invalid result value', async () => {
        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: 'validuser', result: 'quit' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/result must be one of/i);
    });

    test('creates a new player on a win', async () => {
        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: 'winner', result: 'win' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.player).toMatchObject({
            username: 'winner',
            gamesPlayed: 1,
            wins: 1,
            losses: 0,
            draws: 0,
        });
        expect(res.body.player.currentStreak).toBe(1);

        // Persisted to DB
        const stored = await Leaderboard.findOne({ username: 'winner' }).lean();
        expect(stored).not.toBeNull();
        expect(stored.wins).toBe(1);
    });

    test('accepts an explicit numeric opponentElo', async () => {
        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: 'loser', result: 'loss', opponentElo: 1500 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.player.losses).toBe(1);
        expect(res.body.player.gamesPlayed).toBe(1);
    });

    test('resolves opponent ELO from opponentUsernames', async () => {
        await seedPlayers([{ username: 'rival', gamesPlayed: 20, wins: 15, losses: 5, elo: 1400 }]);

        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: 'challenger', result: 'win', opponentUsernames: ['rival'] });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.player).toMatchObject({ username: 'challenger', wins: 1, gamesPlayed: 1 });
    });

    test('updates an existing player across multiple submissions', async () => {
        await request(app).post('/api/leaderboard').send({ username: 'repeat', result: 'win' });
        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: 'repeat', result: 'draw' });

        expect(res.status).toBe(200);
        expect(res.body.player.gamesPlayed).toBe(2);
        expect(res.body.player.wins).toBe(1);
        expect(res.body.player.draws).toBe(1);
    });

    test('returns 500 when the update fails', async () => {
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(Leaderboard, 'findOne').mockImplementation(() => {
            throw new Error('boom');
        });

        const res = await request(app)
            .post('/api/leaderboard')
            .send({ username: 'willfail', result: 'win' });

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/failed to update player stats/i);
    });
});
