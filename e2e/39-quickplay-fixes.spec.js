// e2e/39-quickplay-fixes.spec.js — Quick Play player count reset fix (#213)

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('Quick Play player count fixes (#213)', () => {

  test.beforeEach(async ({ page }) => {
    await goToLobby(page, BASE_URL);
    await page.fill('input[placeholder="Enter your name…"]', 'QPFixTest');
    // Clear any persisted quickplay selection from prior tests
    await page.evaluate(() => localStorage.removeItem('gridlock-quickplay-playerCount'));
  });

  test('default player count is 2P when no prior selection', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    const activeRadio = page.locator('[role="radio"][aria-checked="true"]');
    await expect(activeRadio).toBeVisible({ timeout: 5_000 });
    await expect(activeRadio).toHaveText(/2P/i);
  });

  test('player count selection persists across modal close/reopen', async ({ page }) => {
    // Open Quick Play
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Select 3P
    const radio3P = page.locator('[role="radio"]:has-text("3P")');
    await radio3P.click();
    await expect(radio3P).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });

    // Cancel / close the modal
    const cancelBtn = page.locator('button:has-text("Cancel")');
    if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    // Wait for modal to close
    await page.waitForTimeout(500);

    // Reopen Quick Play
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // 3P should still be selected (persisted via localStorage)
    const activeRadio = page.locator('[role="radio"][aria-checked="true"]');
    await expect(activeRadio).toBeVisible({ timeout: 5_000 });
    await expect(activeRadio).toHaveText(/3P/i);
  });

  test('player count persists in localStorage', async ({ page }) => {
    // Open Quick Play
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Select 4P
    const radio4P = page.locator('[role="radio"]:has-text("4P")');
    await radio4P.click();
    await expect(radio4P).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });

    // Verify localStorage was updated
    const stored = await page.evaluate(() => localStorage.getItem('gridlock-quickplay-playerCount'));
    expect(stored).toBe('4');
  });

  test('switching between all player counts works correctly', async ({ page }) => {
    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Cycle through all options: 2P → 3P → 4P → 2P
    for (const count of ['3P', '4P', '2P']) {
      const radio = page.locator(`[role="radio"]:has-text("${count}")`);
      await radio.click();
      await expect(radio).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });

      // Verify only one radio is checked at a time
      const checkedRadios = await page.locator('[role="radio"][aria-checked="true"]').count();
      expect(checkedRadios).toBe(1);
    }
  });

  test('Quick Play flow works with different player counts', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.click('button:has-text("⚡ Quick Play")');
    await page.waitForFunction(
      () => /Searching|Finding|Quick Play|Looking for/i.test(document.body.innerText),
      { timeout: 10_000 }
    );

    // Select 4P and verify search context updates
    const radio4P = page.locator('[role="radio"]:has-text("4P")');
    await radio4P.click();
    await page.waitForTimeout(1000);

    // Should still be in searching state — no crashes
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/Searching|Finding|Looking for|Waiting/i);

    // No JS errors during the flow
    const criticalErrors = jsErrors.filter(
      (msg) => !/ResizeObserver|favicon/i.test(msg)
    );
    expect(criticalErrors).toHaveLength(0);
  });

});
