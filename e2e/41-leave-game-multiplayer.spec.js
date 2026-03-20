// e2e/41-leave-game-multiplayer.spec.js — Leave game notifies other players (#365)

const { test, expect } = require('@playwright/test');
const { createGameV, joinToWaitingRoom } = require('./wave-helpers');

test.describe('Leave Game Multiplayer Notification', () => {

  test('leaving notifies other player and shows (left) badge', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // P1 creates 2P game (no CPU)
    const roomCode = await createGameV(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

    // P2 joins (waits for /waiting/ or /game)
    await joinToWaitingRoom(p2, { username: 'Bob', roomCode });

    // Host clicks Start Game when room is full (or auto-start fires in 5s)
    const startBtn = p1.locator('button:has-text("Start Game")');
    if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await startBtn.click();
    }

    // Wait for both to reach /game
    await p1.waitForURL(/\/game/, { timeout: 20_000 });
    await p2.waitForURL(/\/game/, { timeout: 20_000 });

    // Wait for game to show turn indicator on both
    await p1.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 10_000 });
    await p2.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 10_000 });

    // P2 clicks Leave Game → confirms
    await p2.click('text=← Leave Game');
    await expect(p2.locator('[role="dialog"]')).toBeVisible();
    await p2.click('[role="dialog"] button:has-text("Leave")');
    await p2.waitForURL(/\/(?:beta\/?)?$/, { timeout: 10_000 });

    // P1 should see "left the game" notification
    await p1.waitForFunction(
      () => /left the game/i.test(document.body.innerText),
      { timeout: 15_000 }
    );

    // P1's game should still have a board visible
    await expect(p1.locator('text=/turn/i')).toBeVisible({ timeout: 5_000 });

    // Departed player has "(left)" badge in scorebar
    await expect(p1.locator('text=(left)')).toBeVisible({ timeout: 5_000 });

    await ctx1.close();
    await ctx2.close();
  });

});
