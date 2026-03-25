// e2e/30-quick-play.spec.js
// E2E tests for Quick Play matchmaking flow

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

const BASE = BASE_URL;

test.describe('Quick Play', () => {

  test('Quick Play button is visible and prominent', async ({ page }) => {
    await goToLobby(page, BASE);
    const quickPlayBtn = page.locator('button:has-text("⚡ Quick Play")');
    await expect(quickPlayBtn).toBeVisible();
    // Verify it has descriptive text below
    await expect(page.locator('text=Instant match with random opponents')).toBeVisible();
  });

  test('Quick Play requires username', async ({ page }) => {
    await goToLobby(page, BASE);
    // Clear username if any
    await page.fill('input[placeholder="Enter your name…"]:visible', '');
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('username');
      await dialog.accept();
    });
    await page.click('button:has-text("⚡ Quick Play")');
  });

  test('Quick Play shows searching overlay with cancel', async ({ page }) => {
    await goToLobby(page, BASE);
    await page.fill('input[placeholder="Enter your name…"]:visible', 'TestQP');

    await page.click('button:has-text("⚡ Quick Play")');

    // Should see searching overlay
    await expect(page.locator('text=Searching for opponents')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Cancel')).toBeVisible();

    // Should show grid/player preferences
    await expect(page.locator('text=Grid: 3×3')).toBeVisible();
    await expect(page.locator('text=Players: 2')).toBeVisible();

    // Cancel should dismiss the overlay
    await page.click('button:has-text("Cancel")');
    await expect(page.locator('text=Searching for opponents')).not.toBeVisible({ timeout: 3000 });
  });

  test('Quick Play shows CPU fallback after waiting', async ({ page }) => {
    await goToLobby(page, BASE);
    await page.fill('input[placeholder="Enter your name…"]:visible', 'WaiterQP');

    await page.click('button:has-text("⚡ Quick Play")');
    await expect(page.locator('text=Searching for opponents')).toBeVisible({ timeout: 5000 });

    // Wait for CPU option to appear (shows at 15s in prod, but we wait for it)
    await expect(page.locator('button:has-text("Play vs CPU instead")')).toBeVisible({ timeout: 20000 });

    // Click CPU fallback
    await page.click('button:has-text("Play vs CPU instead")');

    // Should navigate to game
    await page.waitForURL(/\/game/, { timeout: 15000 });
  });

  test('Two players Quick Play match into same game', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await goToLobby(page1, BASE);
      await goToLobby(page2, BASE);

      // Player 1 enters queue
      await page1.fill('input[placeholder="Enter your name…"]:visible', 'QPAlice');
      await page1.click('button:has-text("⚡ Quick Play")');
      await expect(page1.locator('text=Searching for opponents')).toBeVisible({ timeout: 5000 });

      // Player 2 enters queue — should match
      await page2.fill('input[placeholder="Enter your name…"]:visible', 'QPBob');
      await page2.click('button:has-text("⚡ Quick Play")');

      // Both should navigate to /game
      await page1.waitForURL(/\/game/, { timeout: 15000 });
      await page2.waitForURL(/\/game/, { timeout: 15000 });

      // Both should see the game board
      await expect(page1.locator('text=QPAlice')).toBeVisible({ timeout: 10000 });
      await expect(page2.locator('text=QPBob')).toBeVisible({ timeout: 10000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('Queue leave on page navigation', async ({ page }) => {
    await goToLobby(page, BASE);
    await page.fill('input[placeholder="Enter your name…"]:visible', 'LeaveQP');

    await page.click('button:has-text("⚡ Quick Play")');
    await expect(page.locator('text=Searching for opponents')).toBeVisible({ timeout: 5000 });

    // Cancel
    await page.click('button:has-text("Cancel")');
    await expect(page.locator('text=Searching for opponents')).not.toBeVisible({ timeout: 3000 });

    // Quick Play button should be visible again
    await expect(page.locator('button:has-text("⚡ Quick Play")')).toBeVisible();
  });
});
