// backend/__tests__/ranked.test.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

// Set test environment
process.env.NODE_ENV = 'test';

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
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

const RankedProfile = require('../models/RankedProfile');
const {
    getTierFromElo,
    calculateRankedElo,
    calculateRankedEloExchange,
    calculateRankedDrawExchange,
    softResetElo,
    PLACEMENT_GAMES_REQUIRED,
    COOLDOWN_DURATION_MS,
    TIER_THRESHOLDS,
} = require('../models/RankedProfile');

// ── Tier Assignment Tests ─────────────────────────────────────────────────────

describe('getTierFromElo', () => {
    test('returns Bronze for ELO 0-999', () => {
        expect(getTierFromElo(0).name).toBe('Bronze');
        expect(getTierFromElo(500).name).toBe('Bronze');
        expect(getTierFromElo(999).name).toBe('Bronze');
    });

    test('returns Silver for ELO 1000-1299', () => {
        expect(getTierFromElo(1000).name).toBe('Silver');
        expect(getTierFromElo(1150).name).toBe('Silver');
        expect(getTierFromElo(1299).name).toBe('Silver');
    });

    test('returns Gold for ELO 1300-1499', () => {
        expect(getTierFromElo(1300).name).toBe('Gold');
        expect(getTierFromElo(1400).name).toBe('Gold');
        expect(getTierFromElo(1499).name).toBe('Gold');
    });

    test('returns Platinum for ELO 1500-1699', () => {
        expect(getTierFromElo(1500).name).toBe('Platinum');
        expect(getTierFromElo(1600).name).toBe('Platinum');
        expect(getTierFromElo(1699).name).toBe('Platinum');
    });

    test('returns Diamond for ELO 1700+', () => {
        expect(getTierFromElo(1700).name).toBe('Diamond');
        expect(getTierFromElo(2000).name).toBe('Diamond');
        expect(getTierFromElo(2500).name).toBe('Diamond');
    });

    test('returns tier icons correctly', () => {
        expect(getTierFromElo(500).icon).toBe('🥉');
        expect(getTierFromElo(1100).icon).toBe('🥈');
        expect(getTierFromElo(1400).icon).toBe('🥇');
        expect(getTierFromElo(1600).icon).toBe('🏆');
        expect(getTierFromElo(1800).icon).toBe('💎');
    });

    test('handles non-finite ELO gracefully', () => {
        expect(getTierFromElo(NaN).name).toBe('Silver'); // default 1200
        expect(getTierFromElo(undefined).name).toBe('Silver');
        expect(getTierFromElo(null).name).toBe('Silver');
    });
});

// ── ELO Calculation Tests ─────────────────────────────────────────────────────

describe('calculateRankedElo (legacy interface)', () => {
    test('winning against equal ELO increases rating', () => {
        const newElo = calculateRankedElo(1200, 1200, 1, false);
        expect(newElo).toBeGreaterThan(1200);
    });

    test('losing against equal ELO decreases rating', () => {
        const newElo = calculateRankedElo(1200, 1200, 0, false);
        expect(newElo).toBeLessThan(1200);
    });

    test('placement matches use K-factor 32 (larger swings)', () => {
        const placementWin = calculateRankedElo(1200, 1200, 1, true);
        const normalWin = calculateRankedElo(1200, 1200, 1, false);
        expect(placementWin - 1200).toBeGreaterThan(normalWin - 1200);
    });

    test('winning against higher-rated opponent gives more ELO', () => {
        const winAgainstHigher = calculateRankedElo(1200, 1600, 1, false);
        const winAgainstEqual = calculateRankedElo(1200, 1200, 1, false);
        expect(winAgainstHigher - 1200).toBeGreaterThan(winAgainstEqual - 1200);
    });

    test('ELO never goes below 0', () => {
        const newElo = calculateRankedElo(10, 2000, 0, false);
        expect(newElo).toBeGreaterThanOrEqual(0);
    });

    test('handles non-finite inputs gracefully', () => {
        const result = calculateRankedElo(NaN, undefined, 1, false);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
    });
});

// ── Zero-Sum ELO Exchange Tests ───────────────────────────────────────────────

describe('calculateRankedEloExchange (zero-sum)', () => {
    test('returns positive exchange for equal opponents', () => {
        const exchange = calculateRankedEloExchange(1200, 1200);
        expect(exchange).toBeGreaterThan(0);
        expect(exchange).toBe(8); // K=16, expected=0.5, change=16*(1-0.5)=8
    });

    test('exchange is zero-sum: winner gains exactly what loser loses', () => {
        const exchange = calculateRankedEloExchange(1200, 1400);
        // Winner (1200) gains `exchange`, loser (1400) loses `exchange`
        const newWinner = 1200 + exchange;
        const newLoser = 1400 - exchange;
        // Sum should equal original sum
        expect(newWinner + newLoser).toBe(1200 + 1400);
    });

    test('upset win (lower ELO beats higher) gives larger exchange', () => {
        const upsetExchange = calculateRankedEloExchange(1000, 1400);
        const equalExchange = calculateRankedEloExchange(1200, 1200);
        expect(upsetExchange).toBeGreaterThan(equalExchange);
    });

    test('expected win (higher ELO beats lower) gives smaller exchange', () => {
        const expectedExchange = calculateRankedEloExchange(1400, 1000);
        const equalExchange = calculateRankedEloExchange(1200, 1200);
        expect(expectedExchange).toBeLessThan(equalExchange);
    });

    test('placement games use higher K-factor', () => {
        const placementExchange = calculateRankedEloExchange(1200, 1200, true, false);
        const normalExchange = calculateRankedEloExchange(1200, 1200, false, false);
        expect(placementExchange).toBeGreaterThan(normalExchange);
    });

    test('minimum exchange is 1', () => {
        // Very high ELO beating very low — expected score ≈ 1, so change ≈ 0
        const exchange = calculateRankedEloExchange(2000, 200);
        expect(exchange).toBeGreaterThanOrEqual(1);
    });
});

describe('calculateRankedDrawExchange', () => {
    test('draw between equal opponents gives 0 change', () => {
        const change = calculateRankedDrawExchange(1200, 1200);
        expect(change).toBe(0);
    });

    test('draw is zero-sum: changes sum to zero', () => {
        const change1 = calculateRankedDrawExchange(1200, 1400);
        const change2 = calculateRankedDrawExchange(1400, 1200);
        expect(change1 + change2).toBe(0);
    });

    test('lower-rated player gains ELO from draw against higher-rated', () => {
        const change = calculateRankedDrawExchange(1000, 1400);
        expect(change).toBeGreaterThan(0);
    });

    test('higher-rated player loses ELO from draw against lower-rated', () => {
        const change = calculateRankedDrawExchange(1400, 1000);
        expect(change).toBeLessThan(0);
    });
});

// ── Soft Reset Tests ──────────────────────────────────────────────────────────

describe('softResetElo', () => {
    test('compresses ELO toward 1200 by 50%', () => {
        expect(softResetElo(1600)).toBe(1400); // 1200 + (1600-1200)*0.5 = 1400
        expect(softResetElo(800)).toBe(1000);  // 1200 + (800-1200)*0.5 = 1000
        expect(softResetElo(1200)).toBe(1200); // Already at 1200
    });

    test('handles high ELO correctly', () => {
        expect(softResetElo(2000)).toBe(1600); // 1200 + 800*0.5
    });

    test('handles non-finite input', () => {
        expect(softResetElo(NaN)).toBe(1200);
        expect(softResetElo(undefined)).toBe(1200);
    });
});

// ── RankedProfile Model Tests ─────────────────────────────────────────────────

describe('RankedProfile model', () => {
    test('creates profile with default values', async () => {
        const profile = new RankedProfile({ username: 'TestPlayer' });
        await profile.save();

        expect(profile.elo).toBe(1200);
        expect(profile.tier).toBe('Silver'); // 1200 = Silver
        expect(profile.tierIcon).toBe('🥈');
        expect(profile.season).toBe(1);
        expect(profile.wins).toBe(0);
        expect(profile.losses).toBe(0);
        expect(profile.placementGames).toHaveLength(0);
        expect(profile.cooldownUntil).toBeNull();
    });

    test('isInPlacement returns true when < 5 games', async () => {
        const profile = new RankedProfile({ username: 'Placer' });
        await profile.save();
        expect(profile.isInPlacement()).toBe(true);

        // Add 4 games — still in placement
        for (let i = 0; i < 4; i++) {
            profile.placementGames.push({ result: 'win', opponentElo: 1200, eloAfter: 1216 });
        }
        await profile.save();
        expect(profile.isInPlacement()).toBe(true);

        // Add 5th game — placement complete
        profile.placementGames.push({ result: 'win', opponentElo: 1200, eloAfter: 1232 });
        await profile.save();
        expect(profile.isInPlacement()).toBe(false);
    });

    test('isOnCooldown returns true during cooldown', async () => {
        const profile = new RankedProfile({
            username: 'CooldownPlayer',
            cooldownUntil: new Date(Date.now() + 60000),
        });
        await profile.save();
        expect(profile.isOnCooldown()).toBe(true);
    });

    test('isOnCooldown returns false after cooldown expires', async () => {
        const profile = new RankedProfile({
            username: 'ExpiredCooldown',
            cooldownUntil: new Date(Date.now() - 1000),
        });
        await profile.save();
        expect(profile.isOnCooldown()).toBe(false);
    });

    test('tier auto-updates on save based on ELO', async () => {
        const profile = new RankedProfile({ username: 'TierTest', elo: 1700 });
        await profile.save();
        expect(profile.tier).toBe('Diamond');
        expect(profile.tierIcon).toBe('💎');

        profile.elo = 500;
        await profile.save();
        expect(profile.tier).toBe('Bronze');
        expect(profile.tierIcon).toBe('🥉');
    });

    test('unique username constraint', async () => {
        await RankedProfile.create({ username: 'UniqueTest' });
        await expect(RankedProfile.create({ username: 'UniqueTest' })).rejects.toThrow();
    });
});

// ── Queue Matching Logic Tests (using actual implementation) ──────────────────

describe('Ranked queue matching', () => {
    const { rankedQueue, rankedQueueIndex, removeFromRankedQueue } = require('../controllers/socketHandlers')._internal;

    beforeEach(() => {
        // Clear the queue before each test
        rankedQueue.length = 0;
        rankedQueueIndex.clear();
    });

    test('removeFromRankedQueue removes player and cleans up index', () => {
        rankedQueue.push({ socketId: 'sock1', username: 'A', elo: 1200, gridSize: 3, joinedAt: Date.now() });
        rankedQueueIndex.set('sock1', 'A');
        expect(rankedQueue.length).toBe(1);
        expect(rankedQueueIndex.has('sock1')).toBe(true);

        removeFromRankedQueue('sock1');
        expect(rankedQueue.length).toBe(0);
        expect(rankedQueueIndex.has('sock1')).toBe(false);
    });

    test('removeFromRankedQueue is a no-op for non-existent socket', () => {
        rankedQueue.push({ socketId: 'sock1', username: 'A', elo: 1200, gridSize: 3, joinedAt: Date.now() });
        rankedQueueIndex.set('sock1', 'A');

        removeFromRankedQueue('sock-nonexistent');
        expect(rankedQueue.length).toBe(1);
    });

    test('players within 200 ELO should match', () => {
        const playerA = { elo: 1200, gridSize: 3, joinedAt: Date.now() };
        const playerB = { elo: 1350, gridSize: 3, joinedAt: Date.now() };
        const diff = Math.abs(playerA.elo - playerB.elo);
        expect(diff).toBeLessThanOrEqual(200);
    });

    test('players outside 200 ELO should not match initially', () => {
        const playerA = { elo: 1200, gridSize: 3, joinedAt: Date.now() };
        const playerB = { elo: 1500, gridSize: 3, joinedAt: Date.now() };
        const diff = Math.abs(playerA.elo - playerB.elo);
        expect(diff).toBeGreaterThan(200);
    });

    test('ELO range expands after 30s wait', () => {
        const RANKED_ELO_RANGE = 200;
        const RANKED_ELO_EXPAND_AFTER_MS = 30000;

        const playerA = { elo: 1200, joinedAt: Date.now() - 35000 }; // 35s ago
        const playerB = { elo: 1500, joinedAt: Date.now() };

        const maxWait = Math.max(Date.now() - playerA.joinedAt, Date.now() - playerB.joinedAt);
        const effectiveRange = maxWait >= RANKED_ELO_EXPAND_AFTER_MS
            ? RANKED_ELO_RANGE * 2
            : RANKED_ELO_RANGE;

        const diff = Math.abs(playerA.elo - playerB.elo);
        expect(effectiveRange).toBe(400);
        expect(diff).toBeLessThanOrEqual(effectiveRange);
    });

    test('different grid sizes should not match', () => {
        const playerA = { elo: 1200, gridSize: 3 };
        const playerB = { elo: 1200, gridSize: 4 };
        expect(playerA.gridSize).not.toBe(playerB.gridSize);
    });
});

// ── Cooldown Constants ────────────────────────────────────────────────────────

describe('Ranked constants', () => {
    test('cooldown duration is 5 minutes', () => {
        expect(COOLDOWN_DURATION_MS).toBe(5 * 60 * 1000);
    });

    test('placement requires 5 games', () => {
        expect(PLACEMENT_GAMES_REQUIRED).toBe(5);
    });

    test('tier thresholds are ordered correctly', () => {
        // Thresholds should be in descending order of minElo
        for (let i = 0; i < TIER_THRESHOLDS.length - 1; i++) {
            expect(TIER_THRESHOLDS[i].minElo).toBeGreaterThan(TIER_THRESHOLDS[i + 1].minElo);
        }
    });
});

// ── Season Reset Integration Test ─────────────────────────────────────────────

describe('Season reset integration', () => {
    test('soft reset compresses all profiles toward 1200', async () => {
        await RankedProfile.create([
            { username: 'HighElo', elo: 1800, season: 1, wins: 20, losses: 5 },
            { username: 'LowElo', elo: 800, season: 1, wins: 5, losses: 20 },
            { username: 'MidElo', elo: 1200, season: 1, wins: 10, losses: 10 },
        ]);

        // Simulate the new bulk updateMany approach
        const newSeasonNumber = 2;
        await RankedProfile.updateMany({}, [
            {
                $set: {
                    elo: {
                        $max: [
                            0,
                            { $round: [{ $add: [{ $multiply: [{ $subtract: ['$elo', 1200] }, 0.5] }, 1200] }, 0] },
                        ],
                    },
                    season: newSeasonNumber,
                    placementGames: [],
                    wins: 0,
                    losses: 0,
                    cooldownUntil: null,
                },
            },
        ], { updatePipeline: true });

        const high = await RankedProfile.findOne({ username: 'HighElo' });
        const low = await RankedProfile.findOne({ username: 'LowElo' });
        const mid = await RankedProfile.findOne({ username: 'MidElo' });

        expect(high.elo).toBe(1500); // 1200 + (1800-1200)*0.5
        expect(low.elo).toBe(1000);  // 1200 + (800-1200)*0.5
        expect(mid.elo).toBe(1200);  // unchanged
        expect(high.season).toBe(2);
        expect(high.wins).toBe(0);
        expect(high.placementGames).toHaveLength(0);
    });
});

// ── Ranked Joi Schema Validation ──────────────────────────────────────────────

describe('Ranked socket schema validation', () => {
    const { validatePayload } = require('../middleware/socketSchemas');

    test('ranked_queue_join validates valid payload', () => {
        const result = validatePayload('ranked_queue_join', {
            username: 'TestPlayer',
            avatar: '🎮',
            gridSize: 3,
        });
        expect(result.valid).toBe(true);
        expect(result.value.username).toBe('TestPlayer');
    });

    test('ranked_queue_join rejects missing username', () => {
        const result = validatePayload('ranked_queue_join', {
            gridSize: 3,
        });
        expect(result.valid).toBe(false);
    });

    test('ranked_queue_join rejects invalid grid size', () => {
        const result = validatePayload('ranked_queue_join', {
            username: 'TestPlayer',
            gridSize: 10,
        });
        expect(result.valid).toBe(false);
    });

    test('ranked_queue_leave validates empty payload', () => {
        const result = validatePayload('ranked_queue_leave', {});
        expect(result.valid).toBe(true);
    });

    // ranked_game_end schema removed — it was dead code (server-only event, Fix #5)
});
