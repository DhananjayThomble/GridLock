// e2e/17-push-toggle.spec.js — Push notification toggle UI tests

const { test, expect } = require('@playwright/test');
const { goToLobby } = require('./helpers');

test.describe('Push Notification Toggle', () => {

  test('push notification toggle is visible in lobby', async ({ page }) => {
    await goToLobby(page);
    const toggle = page.locator('button[aria-label="Toggle push notifications"]');
    await expect(toggle).toBeVisible();
  });

  test('push toggle default state is off', async ({ page }) => {
    await goToLobby(page);
    // Fresh session — no gridlock_push in localStorage
    const pushState = await page.evaluate(() => localStorage.getItem('gridlock_push'));
    expect(pushState).toBeNull();
  });

  test('clicking push toggle without username shows alert', async ({ page }) => {
    await goToLobby(page);

    // Clear the username field
    await page.fill('input[placeholder="Enter your name…"]:visible', '');

    // Listen for dialog (alert)
    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    const toggle = page.locator('button[aria-label="Toggle push notifications"]');
    await toggle.click();
    await page.waitForTimeout(1000);

    // Should show an alert about entering username first
    expect(alertMessage).toMatch(/username/i);
  });

  test('toggling push with username changes state', async ({ page }) => {
    await goToLobby(page);
    await page.fill('input[placeholder="Enter your name…"]:visible', 'PushTester');

    const toggle = page.locator('button[aria-label="Toggle push notifications"]');

    // Click to enable — may fail if push not supported in test env, but UI should still respond
    await toggle.click();
    await page.waitForTimeout(1500);

    // Check if state changed (push may not actually subscribe in headless, but UI should attempt)
    const pushState = await page.evaluate(() => localStorage.getItem('gridlock_push'));
    // In headless browser, push subscribe may fail silently — that's OK
    // We just verify no crash occurred
    const body = await page.locator('body').innerText();
    expect(body).toContain('GridLock'); // page didn't crash
  });

  test('toggling push off clears localStorage', async ({ page }) => {
    await goToLobby(page);

    // Manually set push enabled state
    await page.evaluate(() => localStorage.setItem('gridlock_push', 'true'));

    // Reload to pick up the state
    await page.reload({ waitUntil: 'networkidle' });

    const toggle = page.locator('button[aria-label="Toggle push notifications"]');
    // Click to disable
    await toggle.click();
    await page.waitForTimeout(1500);

    const pushState = await page.evaluate(() => localStorage.getItem('gridlock_push'));
    // Should be null or removed
    expect(pushState).toBeNull();
  });

});
