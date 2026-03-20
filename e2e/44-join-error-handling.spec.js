// e2e/44-join-error-handling.spec.js — Join page error states (#365)

const { test, expect } = require('@playwright/test');
const { waitForGameStart, BASE_URL } = require('./helpers');
const { createGameV, joinToWaitingRoom } = require('./wave-helpers');

test.describe('Join Error Handling', () => {

  test('shows "Game not found" for invalid code', async ({ page }) => {
    test.setTimeout(30_000);

    await page.goto(`${BASE_URL}/join/XXXXXX`, { waitUntil: 'networkidle' });
    await page.fill('input[placeholder="Enter your name…"]', 'TestUser');

    // Click the Join button
    const joinBtn = page.locator('button:has-text("Join")').first();
    await joinBtn.click();

    // Verify "Game not found" error appears
    await expect(page.locator('text=Game not found')).toBeVisible({ timeout: 10_000 });

    // Verify "Find Another Game" CTA is visible
    await expect(page.locator('button:has-text("Find Another Game")')).toBeVisible();
  });

  test('shows "Game is full" with Watch Game and retry countdown', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();

    // Create 2P game, both players join, host starts
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

    // P3 navigates to join page for this game
    await p3.goto(`${BASE_URL}/join/${roomCode}`, { waitUntil: 'networkidle' });
    await p3.fill('input[placeholder="Enter your name…"]', 'Charlie');
    await p3.locator('button:has-text("Join")').first().click();

    // Verify "Game is full" error
    await expect(p3.locator('text=Game is full')).toBeVisible({ timeout: 10_000 });

    // Verify "Watch Game" button appears
    await expect(p3.locator('button:has-text("Watch Game")')).toBeVisible();

    // Verify retry countdown
    await expect(p3.locator('text=/Retrying in \\d+s/i')).toBeVisible({ timeout: 3_000 });

    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
  });

});
