// e2e/16-3player-flow.spec.js — 3-player game flow

const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, joinGame, waitForGameStart, makeMove } = require('./helpers');

test.describe('3-Player Game Flow', () => {

  test('3 players join, turns rotate through all 3', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();

    const errors = [];
    for (const p of [p1, p2, p3]) {
      p.on('pageerror', e => errors.push(e.message));
    }

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'Alice3P', playerCount: 3, gridSize: '3×3' });
      expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

      await joinGame(p2, { username: 'Bob3P', roomCode });
      await joinGame(p3, { username: 'Carol3P', roomCode });

      await waitForGameStart(p1, p2, p3);

      // Verify no one is stuck as player_joining
      for (const [name, page] of [['Alice3P', p1], ['Bob3P', p2], ['Carol3P', p3]]) {
        const text = await page.locator('body').innerText();
        expect(text, `${name} stuck as player_joining`).not.toContain('player_joining');
      }

      // Play moves and verify turn rotates through all 3 players
      const turnSequence = [];
      for (let round = 0; round < 24; round++) {
        for (const [name, page] of [['Alice3P', p1], ['Bob3P', p2], ['Carol3P', p3]]) {
          try {
            const text = await page.locator('body').innerText().catch(() => '');
            if (text.includes('Your turn')) {
              const moveSucceeded = await makeMove(page);
              if (!moveSucceeded) continue;
              if (turnSequence[turnSequence.length - 1] !== name) {
                turnSequence.push(name);
              }
              break;
            }
          } catch { continue; }
        }
        await p1.waitForTimeout(400);
        if (turnSequence.length >= 3) break;
      }

      // All 3 players should have had a turn
      expect(turnSequence.length).toBeGreaterThanOrEqual(3);
      const uniquePlayers = [...new Set(turnSequence)];
      expect(uniquePlayers.length, 'All 3 players should get turns').toBe(3);

      // Verify scores tracked for all 3
      const p1Text = await p1.locator('body').innerText();
      expect(p1Text).toContain('Alice3P');
      expect(p1Text).toContain('Bob3P');
      expect(p1Text).toContain('Carol3P');

      expect(errors).toHaveLength(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
      await ctx3.close();
    }
  });

});
