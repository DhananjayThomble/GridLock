/**
 * Tests for forfeit winner selection logic.
 *
 * When a player disconnects and the forfeit timer fires, the winner should be
 * the remaining connected player with the **highest score**, NOT just the first
 * player by array index.
 *
 * Ref: GitHub issue #148
 */

describe('Forfeit winner selection', () => {
    /**
     * Helper that mirrors the forfeit winner logic in socketHandlers.js.
     * Extracted here so we can unit-test it in isolation.
     */
    function pickForfeitWinner(currentGame, disconnectedPlayerId) {
        const remaining = [];
        for (let i = 1; i <= currentGame.playerCount; i++) {
            const pid = `player${i}`;
            const p = currentGame.players[pid];
            if (p && pid !== disconnectedPlayerId && !p.disconnectedAt) {
                remaining.push(pid);
            }
        }

        let winner;
        if (remaining.length === 0) {
            winner = 'draw';
        } else if (remaining.length === 1) {
            winner = remaining[0];
        } else {
            winner = remaining.reduce((best, pid) => {
                const bestScore = currentGame.gameState.scores[best] || 0;
                const pidScore = currentGame.gameState.scores[pid] || 0;
                return pidScore > bestScore ? pid : best;
            }, remaining[0]);
        }

        return winner;
    }

    function makeGame(playerCount, players, scores) {
        return {
            playerCount,
            players,
            gameState: { scores },
        };
    }

    test('picks the highest-scoring remaining player', () => {
        const game = makeGame(4, {
            player1: { username: 'alice' },                         // disconnected
            player2: { username: 'bob' },
            player3: { username: 'charlie' },
            player4: { username: 'diana' },
        }, {
            player1: 5,
            player2: 2,
            player3: 10,
            player4: 7,
        });

        const winner = pickForfeitWinner(game, 'player1');
        expect(winner).toBe('player3'); // highest score among remaining
    });

    test('picks the highest-scoring player even if they are last by index', () => {
        const game = makeGame(3, {
            player1: { username: 'alice' },
            player2: { username: 'bob' },                          // disconnected
            player3: { username: 'charlie' },
        }, {
            player1: 1,
            player2: 15,
            player3: 12,
        });

        const winner = pickForfeitWinner(game, 'player2');
        expect(winner).toBe('player3'); // 12 > 1
    });

    test('with tied scores, picks the first player deterministically', () => {
        const game = makeGame(4, {
            player1: { username: 'alice' },                         // disconnected
            player2: { username: 'bob' },
            player3: { username: 'charlie' },
            player4: { username: 'diana' },
        }, {
            player1: 5,
            player2: 8,
            player3: 8,
            player4: 3,
        });

        const winner = pickForfeitWinner(game, 'player1');
        // player2 and player3 both have 8; player2 comes first → tiebreak
        expect(winner).toBe('player2');
    });

    test('with single remaining player, picks that player', () => {
        const game = makeGame(2, {
            player1: { username: 'alice' },                         // disconnected
            player2: { username: 'bob' },
        }, {
            player1: 10,
            player2: 3,
        });

        const winner = pickForfeitWinner(game, 'player1');
        expect(winner).toBe('player2');
    });

    test('with no remaining players, returns draw', () => {
        const game = makeGame(2, {
            player1: { username: 'alice' },                         // disconnected
            player2: { username: 'bob', disconnectedAt: Date.now() }, // also disconnected
        }, {
            player1: 5,
            player2: 3,
        });

        const winner = pickForfeitWinner(game, 'player1');
        expect(winner).toBe('draw');
    });

    test('handles missing scores gracefully (defaults to 0)', () => {
        const game = makeGame(3, {
            player1: { username: 'alice' },                         // disconnected
            player2: { username: 'bob' },
            player3: { username: 'charlie' },
        }, {
            // player2 has no score entry, player3 has 0
            player1: 5,
            player3: 0,
        });

        const winner = pickForfeitWinner(game, 'player1');
        // Both have 0, player2 comes first → tiebreak
        expect(winner).toBe('player2');
    });

    test('skips players that are also disconnected', () => {
        const game = makeGame(4, {
            player1: { username: 'alice' },                         // forfeit target
            player2: { username: 'bob', disconnectedAt: Date.now() }, // also gone
            player3: { username: 'charlie' },
            player4: { username: 'diana' },
        }, {
            player1: 5,
            player2: 20,
            player3: 3,
            player4: 10,
        });

        const winner = pickForfeitWinner(game, 'player1');
        // player2 is disconnected, so between player3(3) and player4(10) → player4
        expect(winner).toBe('player4');
    });
});
