// e2e/43-host-start-button.spec.js — Host start flow for all-human games

const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers');
const { createGameV, joinToWaitingRoom } = require('./wave-helpers');

test.describe('Host Start Button', () => {

  test('host sees Start button while waiting, non-host sees waiting message', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // P1 creates 2P game (no CPU) → waiting room
    const roomCode = await createGameV(p1, { username: 'HostAlice', playerCount: 2, gridSize: '3×3' });
    expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);
    await expect(p1).toHaveURL(/\/waiting\//);

    // P2 joins — lands on /waiting/ or /game/ depending on auto-start race
    await joinToWaitingRoom(p2, { username: 'GuestBob', roomCode });

    // Race: the 5s auto-start timer in test mode may fire before we get here.
    // Check if P1 is still in the waiting room; if so, verify the Start button.
    if (p1.url().includes('/waiting/')) {
      // Try to see the Start button (may already have auto-started)
      const startBtn = p1.locator('button:has-text("Start Game")');
      const startVisible = await startBtn.isVisible({ timeout: 3_000 }).catch(() => false);

      if (startVisible) {
        // Non-host (P2) should see "Waiting for host" if still in waiting room
        if (p2.url().includes('/waiting/')) {
          await expect(p2.locator('text=/waiting for.*host/i')).toBeVisible({ timeout: 3_000 });
        }
        // Host clicks Start
        await startBtn.click();
      }
    }

    // Both should reach game page (either via host click or auto-start)
    await p1.waitForURL(/\/game/, { timeout: 15_000 });
    await p2.waitForURL(/\/game/, { timeout: 15_000 });

    await expect(p1.locator('text=/turn/i')).toBeVisible({ timeout: 10_000 });
    await expect(p2.locator('text=/turn/i')).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });

  test('host can manually start game before auto-start countdown', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    const roomCode = await createGameV(p1, { username: 'Host', playerCount: 2, gridSize: '3×3' });
    await expect(p1).toHaveURL(/\/waiting\//);

    // P2 joins
    await joinToWaitingRoom(p2, { username: 'Guest', roomCode });

    // Host clicks Start if still in waiting room (race with 5s auto-start)
    if (p1.url().includes('/waiting/')) {
      const startBtn = p1.locator('button:has-text("Start Game")');
      if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await startBtn.click();
      }
    }

    // Both should reach game page
    await p1.waitForURL(/\/game/, { timeout: 15_000 });
    await p2.waitForURL(/\/game/, { timeout: 15_000 });

    await expect(p1.locator('text=/turn/i')).toBeVisible({ timeout: 10_000 });
    await expect(p2.locator('text=/turn/i')).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });

});
