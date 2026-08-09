/**
 * backend/__tests__/rankedRoute.test.js
 *
 * HTTP integration tests for the ranked REST route (routes/ranked.js).
 * These exercise the Express handlers end-to-end against an in-memory MongoDB,
 * complementing ranked.test.js (which unit-tests the ELO / tier / model logic).
 *
 * Pattern mirrors profile.test.js / authIntegration.test.js.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');

const RankedProfile = require('../models/RankedProfile');
const rankedRouter = require('../routes/ranked');
const log = require('../utils/logger');

const ADMIN_KEY = 'super-secret-admin-key'; // 22 chars

let mongoServer;
let app;
let ORIGINAL_ADMIN_KEY;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    ORIGINAL_ADMIN_KEY = process.env.ADMIN_API_KEY;

    app = express();
    app.use(express.json());
    app.use('/api/ranked', rankedRouter);
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
    // Always restore the admin key to whatever it was before this file ran.
    if (ORIGINAL_ADMIN_KEY === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = ORIGINAL_ADMIN_KEY;

    jest.restoreAllMocks();
});

describe('GET /api/ranked/profile/:username', () => {
    test('returns 400 for an invalid username', async () => {
        const res = await request(app).get(
            '/api/ranked/profile/' + encodeURIComponent('<script>')
        );
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/invalid username/i);
    });

    test('returns 404 when the profile does not exist', async () => {
        const res = await request(app).get('/api/ranked/profile/ghost');
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/not found/i);
    });

    test('returns a profile with rank, tier, and derived flags', async () => {
        await RankedProfile.create([
            { username: 'topplayer', elo: 1800, wins: 30, losses: 5 },
            {
                username: 'target',
                elo: 1600,
                wins: 10,
                losses: 5,
                draws: 1,
                placementGames: [
                    { result: 'win', opponentElo: 1200, eloAfter: 1216 },
                    { result: 'loss', opponentElo: 1200, eloAfter: 1200 },
                ],
                cooldownUntil: new Date(Date.now() + 60_000),
            },
        ]);

        const res = await request(app).get('/api/ranked/profile/target');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.profile).toMatchObject({
            rank: 2, // one player (topplayer) has higher ELO
            username: 'target',
            elo: 1600,
            tier: 'Platinum',
            tierIcon: '🏆',
            wins: 10,
            losses: 5,
            draws: 1,
            gamesPlayed: 16,
            winRate: 62.5,
            isInPlacement: true, // only 2 placement games recorded
            isOnCooldown: true, // cooldownUntil is in the future
        });
        expect(res.body.profile).toHaveProperty('memberSince');
    });

    test('reports isOnCooldown false once cooldown has expired', async () => {
        await RankedProfile.create({
            username: 'cooled',
            elo: 1200,
            cooldownUntil: new Date(Date.now() - 60_000),
        });

        const res = await request(app).get('/api/ranked/profile/cooled');
        expect(res.status).toBe(200);
        expect(res.body.profile.isOnCooldown).toBe(false);
    });

    test('returns 500 when the DB query fails', async () => {
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(RankedProfile, 'findOne').mockImplementation(() => {
            throw new Error('boom');
        });

        const res = await request(app).get('/api/ranked/profile/target');
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/failed to fetch ranked profile/i);
    });
});

describe('GET /api/ranked/leaderboard', () => {
    test('returns an empty leaderboard when no profiles exist', async () => {
        const res = await request(app).get('/api/ranked/leaderboard');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.count).toBe(0);
        expect(res.body.leaderboard).toEqual([]);
    });

    test('returns profiles sorted by ELO desc with computed tiers', async () => {
        await RankedProfile.create([
            { username: 'silver', elo: 1200, wins: 5, losses: 5 },
            { username: 'diamond', elo: 1800, wins: 40, losses: 10 },
            { username: 'platinum', elo: 1500, wins: 20, losses: 10 },
        ]);

        const res = await request(app).get('/api/ranked/leaderboard');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(3);

        const usernames = res.body.leaderboard.map((p) => p.username);
        expect(usernames).toEqual(['diamond', 'platinum', 'silver']);
        expect(res.body.leaderboard.map((p) => p.rank)).toEqual([1, 2, 3]);

        const top = res.body.leaderboard[0];
        expect(top).toMatchObject({
            rank: 1,
            username: 'diamond',
            elo: 1800,
            tier: 'Diamond',
            tierIcon: '💎',
        });
        expect(top).toHaveProperty('winRate');
        expect(top).toHaveProperty('memberSince');
    });

    test('respects the limit query param', async () => {
        await RankedProfile.create([
            { username: 'a', elo: 1500 },
            { username: 'b', elo: 1400 },
            { username: 'c', elo: 1300 },
        ]);

        const res = await request(app).get('/api/ranked/leaderboard?limit=1');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
        expect(res.body.leaderboard[0].username).toBe('a');
    });

    test('falls back to default limit when limit is non-numeric', async () => {
        await RankedProfile.create([
            { username: 'a', elo: 1500 },
            { username: 'b', elo: 1400 },
        ]);

        const res = await request(app).get('/api/ranked/leaderboard?limit=abc');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
    });

    test('returns 500 when the DB query fails', async () => {
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(RankedProfile, 'find').mockImplementation(() => {
            throw new Error('boom');
        });

        const res = await request(app).get('/api/ranked/leaderboard');
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/failed to fetch ranked leaderboard/i);
    });
});

describe('POST /api/ranked/season-reset', () => {
    test('returns 503 when the admin key is not configured on the server', async () => {
        delete process.env.ADMIN_API_KEY;
        const res = await request(app)
            .post('/api/ranked/season-reset')
            .set('x-admin-key', 'anything');
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/not configured/i);
    });

    test('returns 401 when the admin key header is missing', async () => {
        process.env.ADMIN_API_KEY = ADMIN_KEY;
        const res = await request(app).post('/api/ranked/season-reset');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/unauthorized/i);
    });

    test('returns 401 for a wrong key of a different length', async () => {
        process.env.ADMIN_API_KEY = ADMIN_KEY;
        const res = await request(app)
            .post('/api/ranked/season-reset')
            .set('x-admin-key', 'short');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/unauthorized/i);
    });

    test('returns 401 for a wrong key of the same length', async () => {
        process.env.ADMIN_API_KEY = ADMIN_KEY;
        // Same length as ADMIN_KEY but different content -> exercises timingSafeEqual
        const wrongKey = 'x'.repeat(ADMIN_KEY.length);
        expect(wrongKey.length).toBe(ADMIN_KEY.length);
        const res = await request(app)
            .post('/api/ranked/season-reset')
            .set('x-admin-key', wrongKey);
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/unauthorized/i);
    });

    test('performs a soft reset for all profiles with a valid admin key', async () => {
        process.env.ADMIN_API_KEY = ADMIN_KEY;
        await RankedProfile.create([
            { username: 'HighElo', elo: 1800, season: 1, wins: 20, losses: 5, draws: 2 },
            { username: 'LowElo', elo: 800, season: 1, wins: 5, losses: 20 },
            { username: 'MidElo', elo: 1200, season: 1, wins: 10, losses: 10 },
        ]);

        const res = await request(app)
            .post('/api/ranked/season-reset')
            .set('x-admin-key', ADMIN_KEY);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.resetCount).toBe(3);
        expect(res.body.newSeason).toBe(2);
        expect(res.body.message).toMatch(/season reset complete/i);

        // ELO is compressed 50% toward 1200; counters cleared; tier re-derived.
        const high = await RankedProfile.findOne({ username: 'HighElo' }).lean();
        expect(high.elo).toBe(1500); // 1200 + (1800-1200)*0.5
        expect(high.season).toBe(2);
        expect(high.wins).toBe(0);
        expect(high.losses).toBe(0);
        expect(high.draws).toBe(0);
        expect(high.placementGames).toHaveLength(0);
        expect(high.cooldownUntil).toBeNull();
        expect(high.tier).toBe('Platinum');
        expect(high.tierIcon).toBe('🏆');

        const low = await RankedProfile.findOne({ username: 'LowElo' }).lean();
        expect(low.elo).toBe(1000); // 1200 + (800-1200)*0.5
        expect(low.tier).toBe('Silver');

        const mid = await RankedProfile.findOne({ username: 'MidElo' }).lean();
        expect(mid.elo).toBe(1200); // already centred
        expect(mid.tier).toBe('Silver');
    });

    test('returns 500 when the reset operation fails', async () => {
        process.env.ADMIN_API_KEY = ADMIN_KEY;
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(RankedProfile, 'findOne').mockImplementation(() => {
            throw new Error('boom');
        });

        const res = await request(app)
            .post('/api/ranked/season-reset')
            .set('x-admin-key', ADMIN_KEY);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/failed to perform season reset/i);
    });
});
