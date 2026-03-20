// e2e/45-rejoin-banner.spec.js — Rejoin game banner on lobby (#365)

const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers');
const { createCpuGameV } = require('./wave-helpers');

test.describe('Rejoin Game Banner', () => {

  test('shows rejoin banner after navigating away without leaving', async ({ page }) => {
    test.setTimeout(60_000);

    await createCpuGameV(page, { username: 'RejoinUser', gridSize: '3×3' });
    await expect(page.locator('text=/turn/i')).toBeVisible();

    // Navigate to lobby directly (without Leave Game flow — preserves localStorage)
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('GridLock');

    // Rejoin banner appears
    await expect(page.locator('text=/unfinished game/i')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Rejoin Game")')).toBeVisible();
  });

  test('clicking Rejoin navigates to game join page', async ({ page }) => {
    test.setTimeout(60_000);

    await createCpuGameV(page, { username: 'RejoinUser2', gridSize: '3×3' });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await expect(page.locator('button:has-text("Rejoin Game")')).toBeVisible({ timeout: 5_000 });
    await page.click('button:has-text("Rejoin Game")');
    await page.waitForURL(/\/join\//, { timeout: 10_000 });
  });

  test('dismiss banner makes it disappear', async ({ page }) => {
    test.setTimeout(60_000);

    await createCpuGameV(page, { username: 'RejoinUser3', gridSize: '3×3' });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await expect(page.locator('text=/unfinished game/i')).toBeVisible({ timeout: 5_000 });
    await page.click('[aria-label="Dismiss active game banner"]');
    await expect(page.locator('text=/unfinished game/i')).not.toBeVisible({ timeout: 3_000 });
  });

  test('voluntary leave clears active game — no rejoin banner', async ({ page }) => {
    test.setTimeout(60_000);

    await createCpuGameV(page, { username: 'NoRejoin', gridSize: '3×3' });

    // Leave via the proper flow (clears localStorage)
    await page.click('text=← Leave Game');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.click('[role="dialog"] button:has-text("Leave")');
    await page.waitForURL(/\/(?:beta\/?)?$/, { timeout: 10_000 });

    // Rejoin banner should NOT appear
    await page.waitForTimeout(1000);
    await expect(page.locator('text=/unfinished game/i')).not.toBeVisible();
  });

});
