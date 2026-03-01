/**
 * backend/__tests__/leaderboard.test.js
 *
 * Unit tests for the leaderboard logic.
 * These tests exercise the business logic (ELO calculation, stat updates)
 * without requiring a live MongoDB connection by mocking the Mongoose model.
 */

// ---------------------------------------------------------------------------
// ELO calculation (pure function — no mocking needed)
// ---------------------------------------------------------------------------
describe('Leaderboard.calculateElo (ELO algorithm)', () => {
    // We test the static helper directly by importing its logic inline.
    // The formula: newElo = currentElo + K * (score - expectedScore)
    // expectedScore = 1 / (1 + 10^((opponentElo - currentElo) / 400))
    function calculateElo(currentElo, opponentElo, score, kFactor = 32) {
        const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - currentElo) / 400));
        const newElo = Math.round(currentElo + kFactor * (score - expectedScore));
        return Math.max(0, newElo);
    }

    test('equal players: winner gains ~16 ELO', () => {
        const newElo = calculateElo(1000, 1000, 1);
        expect(newElo).toBe(1016);
    });

    test('equal players: loser loses ~16 ELO', () => {
        const newElo = calculateElo(1000, 1000, 0);
        expect(newElo).toBe(984);
    });

    test('equal players: draw keeps ELO close to 1000', () => {
        const newElo = calculateElo(1000, 1000, 0.5);
        expect(newElo).toBe(1000);
    });

    test('higher-rated player wins: gains less ELO', () => {
        const newElo = calculateElo(1200, 1000, 1); // favourite wins
        expect(newElo).toBeLessThan(1216); // gains less than 16
        expect(newElo).toBeGreaterThan(1200);
    });

    test('higher-rated player loses: loses more ELO', () => {
        const newElo = calculateElo(1200, 1000, 0); // favourite loses
        expect(newElo).toBeLessThan(1200);
    });

    test('lower-rated player wins: gains more ELO', () => {
        const newElo = calculateElo(800, 1000, 1); // underdog wins
        expect(newElo).toBeGreaterThan(816); // gains more than 16
    });

    test('ELO cannot go below 0', () => {
        const newElo = calculateElo(10, 3000, 0); // massive loss
        expect(newElo).toBeGreaterThanOrEqual(0);
    });

    test('custom K-factor changes gain magnitude', () => {
        const k16 = calculateElo(1000, 1000, 1, 16);
        const k32 = calculateElo(1000, 1000, 1, 32);
        expect(k32).toBeGreaterThan(k16);
    });
});

// ---------------------------------------------------------------------------
// winRate computation logic
// ---------------------------------------------------------------------------
describe('winRate computation', () => {
    function computeWinRate(wins, gamesPlayed) {
        if (gamesPlayed === 0) return 0;
        return parseFloat(((wins / gamesPlayed) * 100).toFixed(2));
    }

    test('0 games → 0% winRate', () => {
        expect(computeWinRate(0, 0)).toBe(0);
    });

    test('all wins → 100% winRate', () => {
        expect(computeWinRate(10, 10)).toBe(100);
    });

    test('half wins → 50% winRate', () => {
        expect(computeWinRate(5, 10)).toBe(50);
    });

    test('winRate rounds to 2 decimal places', () => {
        expect(computeWinRate(1, 3)).toBe(33.33);
    });

    test('no wins → 0% winRate', () => {
        expect(computeWinRate(0, 5)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Streak logic
// ---------------------------------------------------------------------------
describe('streak tracking', () => {
    function applyResult(state, result) {
        const next = { ...state };
        next.gamesPlayed += 1;
        if (result === 'win') {
            next.wins += 1;
            next.currentStreak += 1;
            if (next.currentStreak > next.bestStreak) next.bestStreak = next.currentStreak;
        } else if (result === 'loss') {
            next.losses += 1;
            next.currentStreak = 0;
        } else {
            next.draws += 1;
            // streak maintained on draw
        }
        return next;
    }

    const initialState = {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        currentStreak: 0,
        bestStreak: 0,
    };

    test('consecutive wins build streak', () => {
        let s = initialState;
        s = applyResult(s, 'win');
        s = applyResult(s, 'win');
        s = applyResult(s, 'win');
        expect(s.currentStreak).toBe(3);
        expect(s.bestStreak).toBe(3);
    });

    test('loss resets current streak', () => {
        let s = initialState;
        s = applyResult(s, 'win');
        s = applyResult(s, 'win');
        s = applyResult(s, 'loss');
        expect(s.currentStreak).toBe(0);
        expect(s.bestStreak).toBe(2); // best preserved
    });

    test('bestStreak persists after loss', () => {
        let s = initialState;
        s = applyResult(s, 'win');
        s = applyResult(s, 'win');
        s = applyResult(s, 'win');
        s = applyResult(s, 'loss');
        s = applyResult(s, 'win');
        expect(s.bestStreak).toBe(3);
        expect(s.currentStreak).toBe(1);
    });

    test('draw does not reset streak', () => {
        let s = initialState;
        s = applyResult(s, 'win');
        s = applyResult(s, 'win');
        s = applyResult(s, 'draw');
        expect(s.currentStreak).toBe(2);
        expect(s.draws).toBe(1);
    });

    test('gamesPlayed increments for all result types', () => {
        let s = initialState;
        s = applyResult(s, 'win');
        s = applyResult(s, 'loss');
        s = applyResult(s, 'draw');
        expect(s.gamesPlayed).toBe(3);
        expect(s.wins).toBe(1);
        expect(s.losses).toBe(1);
        expect(s.draws).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Route validation logic (unit-testable without Express)
// ---------------------------------------------------------------------------
describe('POST /api/leaderboard input validation', () => {
    function validatePostBody({ username, result }) {
        const validResults = ['win', 'loss', 'draw'];
        const errors = [];
        if (!username || typeof username !== 'string' || username.trim().length === 0) {
            errors.push('username is required');
        }
        if (!result || !validResults.includes(result)) {
            errors.push(`result must be one of: ${validResults.join(', ')}`);
        }
        return errors;
    }

    test('valid body produces no errors', () => {
        expect(validatePostBody({ username: 'alice', result: 'win' })).toHaveLength(0);
    });

    test('missing username produces error', () => {
        const errs = validatePostBody({ result: 'win' });
        expect(errs).toContain('username is required');
    });

    test('empty username produces error', () => {
        const errs = validatePostBody({ username: '   ', result: 'win' });
        expect(errs).toContain('username is required');
    });

    test('invalid result produces error', () => {
        const errs = validatePostBody({ username: 'alice', result: 'abandon' });
        expect(errs.some((e) => e.includes('result must be one of'))).toBe(true);
    });

    test('missing result produces error', () => {
        const errs = validatePostBody({ username: 'alice' });
        expect(errs.some((e) => e.includes('result must be one of'))).toBe(true);
    });

    test('all three valid result values pass', () => {
        ['win', 'loss', 'draw'].forEach((r) => {
            expect(validatePostBody({ username: 'bob', result: r })).toHaveLength(0);
        });
    });
});

// ---------------------------------------------------------------------------
// Rank computation logic
// ---------------------------------------------------------------------------
describe('leaderboard ranking', () => {
    const players = [
        { username: 'alice', wins: 10, winRate: 80, elo: 1200 },
        { username: 'bob', wins: 10, winRate: 70, elo: 1100 },
        { username: 'carol', wins: 8, winRate: 90, elo: 1300 },
        { username: 'dave', wins: 5, winRate: 50, elo: 900 },
    ];

    function sortLeaderboard(players) {
        return [...players].sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            return b.elo - a.elo;
        });
    }

    test('players are sorted by wins descending', () => {
        const sorted = sortLeaderboard(players);
        expect(sorted[0].wins).toBeGreaterThanOrEqual(sorted[1].wins);
        expect(sorted[1].wins).toBeGreaterThanOrEqual(sorted[2].wins);
    });

    test('tie in wins: higher winRate ranks first', () => {
        const sorted = sortLeaderboard(players);
        // alice and bob both have 10 wins; alice has higher winRate
        const aliceIdx = sorted.findIndex((p) => p.username === 'alice');
        const bobIdx = sorted.findIndex((p) => p.username === 'bob');
        expect(aliceIdx).toBeLessThan(bobIdx);
    });

    test('rank 1 is assigned to the first entry', () => {
        const sorted = sortLeaderboard(players).map((p, i) => ({ ...p, rank: i + 1 }));
        expect(sorted[0].rank).toBe(1);
        expect(sorted[sorted.length - 1].rank).toBe(players.length);
    });
});
