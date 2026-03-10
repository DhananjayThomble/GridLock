/**
 * Tests for pickForfeitWinner — the production forfeit winner selection logic.
 *
 * When a player disconnects and the forfeit timer fires, the winner should be
 * the remaining connected player with the **highest score**, NOT just the first
 * player by array index.  Ties return 'draw', consistent with calculateWinner.
 *
 * Ref: GitHub issue #148
 */

const { pickForfeitWinner } = require('../utils/gameLogic');

describe('pickForfeitWinner', () => {
    test('picks the highest-scoring remaining player', () => {
        const remaining = ['player2', 'player3', 'player4'];
        const scores = { player1: 5, player2: 2, player3: 10, player4: 7 };

        expect(pickForfeitWinner(remaining, scores)).toBe('player3');
    });

    test('picks the highest-scoring player even if they are last by index', () => {
        const remaining = ['player1', 'player3'];
        const scores = { player1: 1, player2: 15, player3: 12 };

        expect(pickForfeitWinner(remaining, scores)).toBe('player3');
    });

    test('returns draw when top scorers are tied', () => {
        const remaining = ['player2', 'player3', 'player4'];
        const scores = { player1: 5, player2: 8, player3: 8, player4: 3 };

        expect(pickForfeitWinner(remaining, scores)).toBe('draw');
    });

    test('with single remaining player, picks that player', () => {
        const remaining = ['player2'];
        const scores = { player1: 10, player2: 3 };

        expect(pickForfeitWinner(remaining, scores)).toBe('player2');
    });

    test('with no remaining players, returns draw', () => {
        expect(pickForfeitWinner([], { player1: 5, player2: 3 })).toBe('draw');
    });

    test('handles missing scores gracefully (defaults to 0)', () => {
        const remaining = ['player2', 'player3'];
        const scores = { player1: 5, player3: 0 }; // player2 has no entry

        // Both effectively 0 → draw (tied)
        expect(pickForfeitWinner(remaining, scores)).toBe('draw');
    });

    test('handles undefined scores object (null guard)', () => {
        const remaining = ['player1', 'player2'];

        // scores defaults to {} → all 0 → draw
        expect(pickForfeitWinner(remaining, undefined)).toBe('draw');
        expect(pickForfeitWinner(remaining)).toBe('draw');
    });

    // Issue 4: all-zero scores should be a draw
    test('returns draw when all remaining players have zero scores', () => {
        const remaining = ['player1', 'player2', 'player3'];
        const scores = { player1: 0, player2: 0, player3: 0 };

        expect(pickForfeitWinner(remaining, scores)).toBe('draw');
    });

    // Issue 5: CPU players are eligible to win forfeit
    test('CPU players can win forfeit by highest score', () => {
        const remaining = ['player1', 'cpu_easy_1', 'cpu_hard_2'];
        const scores = { player1: 3, cpu_easy_1: 5, cpu_hard_2: 2 };

        expect(pickForfeitWinner(remaining, scores)).toBe('cpu_easy_1');
    });

    test('CPU and human players tie results in draw', () => {
        const remaining = ['player1', 'cpu_medium_1'];
        const scores = { player1: 7, cpu_medium_1: 7 };

        expect(pickForfeitWinner(remaining, scores)).toBe('draw');
    });

    test('single CPU player remaining wins', () => {
        const remaining = ['cpu_easy_1'];
        const scores = { player1: 10, cpu_easy_1: 2 };

        expect(pickForfeitWinner(remaining, scores)).toBe('cpu_easy_1');
    });
});
