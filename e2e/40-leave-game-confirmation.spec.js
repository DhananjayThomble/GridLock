// e2e/40-leave-game-confirmation.spec.js — Leave game confirmation modal (#365)

const { test, expect } = require('@playwright/test');
const { createCpuGameV } = require('./wave-helpers');

test.describe('Leave Game Confirmation', () => {

  test('shows confirmation modal and Stay keeps you in game', async ({ page }) => {
    test.setTimeout(60_000);
    await createCpuGameV(page, { username: 'Leaver', gridSize: '3×3' });

    await page.click('text=← Leave Game');

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('#leave-modal-title')).toContainText('Leave Game?');
    await expect(page.locator('text=Are you sure you want to leave?')).toBeVisible();

    await page.click('button:has-text("Stay")');
    await expect(modal).not.toBeVisible();

    expect(page.url()).toMatch(/\/game/);
    await expect(page.locator('text=/turn/i')).toBeVisible();
  });

  test('Leave button in modal navigates to lobby', async ({ page }) => {
    test.setTimeout(60_000);
    await createCpuGameV(page, { username: 'Leaver2', gridSize: '3×3' });

    await page.click('text=← Leave Game');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.click('[role="dialog"] button:has-text("Leave")');

    await page.waitForURL(/\/(?:beta\/?)?$/, { timeout: 10_000 });
    await expect(page.locator('body')).toContainText('GridLock');
    await expect(page.locator('button:has-text("🚀 Create Game"):visible').first()).toBeVisible();
  });

  test('can reopen modal after closing with Stay', async ({ page }) => {
    test.setTimeout(60_000);
    await createCpuGameV(page, { username: 'Leaver3', gridSize: '3×3' });

    await page.click('text=← Leave Game');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.click('button:has-text("Stay")');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    await page.click('text=← Leave Game');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.click('[role="dialog"] button:has-text("Leave")');
    await page.waitForURL(/\/(?:beta\/?)?$/, { timeout: 10_000 });
  });

});
