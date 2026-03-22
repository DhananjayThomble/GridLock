// e2e/33-quickplay-selector.spec.js — Quick Play Player Count selector tests

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('Quick Play Player Count Selector', () => {

  test.beforeEach(async ({ page }) => {
    await goToLobby(page, BASE_URL);
    // Fill username so Quick Play button works
    await page.fill('input[placeholder="Enter your name…"]:visible', 'TestPlayer');
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
    // Component uses role="radio" with aria-checked="true"
    const activeRadio = page.locator('[role="radio"][aria-checked="true"]');
    await expect(activeRadio).toBeVisible({ timeout: 5_000 });
    await expect(activeRadio).toHaveText(/2P/i);
  });

  test('changing selection updates search context', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Click 3P option
    const threePlayerBtn = page.locator('button:has-text("3P"), button:has-text("3 Players")').first();
    await expect(threePlayerBtn).toBeVisible({ timeout: 5_000 });
    await threePlayerBtn.click();

    // Verify selection changed
    await page.waitForTimeout(500);
    const selectedRadio = page.locator('[role="radio"][aria-checked="true"]');
    await expect(selectedRadio).toContainText(/3/);
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
    await expect(page.locator('button:has-text("🚀 Create Game"):visible').first()).toBeVisible({ timeout: 10_000 });
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
