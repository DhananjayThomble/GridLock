// e2e/46-spectator-full-game.spec.js — Spectator mode when game is full (#365)

const { test, expect } = require('@playwright/test');
const { waitForGameStart, BASE_URL } = require('./helpers');
const { createGameV, joinToWaitingRoom } = require('./wave-helpers');

test.describe('Spectator on Full Game', () => {

  test('third user can watch a full game as spectator', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();

    // P1 creates 2P game, P2 joins, host starts
    const roomCode = await createGameV(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinToWaitingRoom(p2, { username: 'Bob', roomCode });
    // Host clicks Start if still in waiting room (or auto-start fires in 5s)
    if (p1.url().includes('/waiting/')) {
      const startBtn = p1.locator('button:has-text("Start Game")');
      if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await startBtn.click();
      }
    }
    await p1.waitForURL(/\/game/, { timeout: 20_000 });
    await p2.waitForURL(/\/game/, { timeout: 20_000 });
    await waitForGameStart(p1, p2);

    // P3 navigates to join page
    await p3.goto(`${BASE_URL}/join/${roomCode}`, { waitUntil: 'networkidle' });
    await p3.fill('input[placeholder="Enter your name…"]', 'Charlie');
    await p3.locator('button:has-text("Join")').first().click();

    // "Game is full" message
    await expect(p3.locator('text=Game is full')).toBeVisible({ timeout: 10_000 });

    // Click "Watch Game"
    await p3.click('button:has-text("Watch Game")');

    // Enters game as spectator
    await p3.waitForURL(/\/game/, { timeout: 15_000 });
    await p3.waitForFunction(
      () => /turn/i.test(document.body.innerText),
      { timeout: 15_000 }
    );

    // Spectator sees "Spectating" not "Your turn"
    const spectatorText = await p3.locator('body').innerText();
    expect(spectatorText).not.toContain('Your turn');
    expect(spectatorText).toMatch(/Spectating/i);

    // Spectator count shown to players
    await expect(p1.locator('text=/watching/i')).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
  });

});
