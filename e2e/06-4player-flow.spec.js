const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, joinGame, waitForGameStart, makeMove } = require('./helpers');

test.describe('4-Player Game Flow', () => {

  test('Creates game, 4 players join, turns rotate correctly', async ({ browser }) => {
    test.setTimeout(120_000); // 4 players take time
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const ctx4 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();
    const p4 = await ctx4.newPage();

    const errors = [];
    for (const p of [p1, p2, p3, p4]) {
      p.on('pageerror', e => errors.push(e.message));
    }

    // 1. P1 creates game
    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 4, gridSize: '3×3' });
    expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

    // 2. P2, P3, P4 join
    await joinGame(p2, { username: 'Bob', roomCode });
    await joinGame(p3, { username: 'Carol', roomCode });
    await joinGame(p4, { username: 'Dave', roomCode });

    // 3. Wait for game start (all 4 on board)
    await waitForGameStart(p1, p2, p3, p4);

    // 4. Verify no one is stuck as player_joining
    for (const [name, page] of [['Alice', p1], ['Bob', p2], ['Carol', p3], ['Dave', p4]]) {
      const text = await page.locator('body').innerText();
      expect(text, `${name} stuck as player_joining`).not.toContain('player_joining');
    }

    // 5. Play moves and verify turn rotates through ALL 4 players in sequence
    const turnSequence = [];
    for (let round = 0; round < 24; round++) {
      for (const [name, page] of [['Alice', p1], ['Bob', p2], ['Carol', p3], ['Dave', p4]]) {
        try {
          const text = await page.locator('body').innerText().catch(() => '');
          if (text.includes('Your turn')) {
            const moveSucceeded = await makeMove(page);
            if (!moveSucceeded) {
              throw new Error(`makeMove did not perform a move for ${name} while it was their turn`);
            }
            if (turnSequence[turnSequence.length - 1] !== name) {
              turnSequence.push(name);
            }
            break;
          }
        } catch { continue; }
      }
      await p1.waitForTimeout(300);
      if (turnSequence.length >= 4) break;
    }

    expect(turnSequence.slice(0, 4)).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);

    // 6. No JS errors
    expect(errors).toHaveLength(0);

    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
    await ctx4.close();
  });

});
