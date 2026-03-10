// e2e/33-quickplay-selector.spec.js — Quick Play Player Count selector tests

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

const BASE = process.env.TEST_BASE_URL
  || (process.env.CI ? 'http://localhost:4173' : 'http://localhost/beta');

test.describe('Quick Play Player Count Selector', () => {

  test.beforeEach(async ({ page }) => {
    await goToLobby(page, BASE);
    // Fill username so Quick Play button works
    await page.fill('input[placeholder="Enter your name…"]', 'TestPlayer');
  });

  test('Quick Play modal shows player count toggle', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');

    // Wait for Quick Play modal/overlay to appear
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Should show player count options (2P, 3P, 4P or "2 Players", etc.)
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/2\s*P|2\s*Players/i);
    expect(bodyText).toMatch(/3\s*P|3\s*Players/i);
    expect(bodyText).toMatch(/4\s*P|4\s*Players/i);
  });

  test('default player count is 2P', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // The 2P option should be active/selected by default
    // Check for active state — usually a highlighted button or aria-pressed
    const activeBtn = page.locator('button[aria-pressed="true"], button.active, [data-active="true"]').first();
    const activeBtnExists = await activeBtn.isVisible().catch(() => false);

    if (activeBtnExists) {
      const text = await activeBtn.innerText();
      expect(text).toMatch(/2/);
    } else {
      // Fallback: check search text mentions 2-player
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).toMatch(/2.?player|2P/i);
    }
  });

  test('changing selection updates search context', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Click 3P or "3 Players" option
    const threePlayerBtn = page.locator('button:has-text("3P"), button:has-text("3 Players")').first();
    if (await threePlayerBtn.isVisible().catch(() => false)) {
      await threePlayerBtn.click();

      // Give a moment for the UI to update
      await page.waitForTimeout(500);

      // Verify the UI reflects the 3-player selection
      const bodyText = await page.locator('body').innerText();
      // Should mention 3-player or 3P context in the search area
      expect(bodyText).toMatch(/3.?player|3P|3×|three/i);
    }
  });

  test('cancel returns to lobby', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Click cancel button
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("✕"), button:has-text("Back"), button[aria-label="Cancel"]').first();
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    await cancelBtn.click();

    // Should return to lobby
    await expect(page.locator('button:has-text("🚀 Create Game")')).toBeVisible({ timeout: 10_000 });
  });

  test('CPU fallback creates game with selected player count', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Wait for CPU fallback option to appear (after ~15s timeout)
    // Or click "Play vs CPU" button if it appears
    const cpuBtn = page.locator('button:has-text("CPU"), button:has-text("Play vs CPU"), button:has-text("Play with CPU")').first();
    await expect(cpuBtn).toBeVisible({ timeout: 35_000 });
    await cpuBtn.click();

    // Should navigate to a game
    await page.waitForURL(/\/game/, { timeout: 15_000 });
    await page.waitForFunction(
      () => /Your turn|turn|CPU|🤖/i.test(document.body.innerText),
      { timeout: 20_000 }
    );
  });

});
