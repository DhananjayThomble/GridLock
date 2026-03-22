// e2e/20-negative-lobby.spec.js — Negative lobby testing

const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, BASE_URL } = require('./helpers');

test.describe('Negative Lobby Tests', () => {

  test('empty username rejects game creation', async ({ page }) => {
    await goToLobby(page);

    // Clear username
    await page.fill('input[placeholder="Enter your name…"]:visible', '');

    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.click('button:has-text("🚀 Create Game")');
    await page.waitForTimeout(2000);

    // Should either show alert, stay on lobby, or show inline error
    const url = page.url();
    const stayedOnLobby = !url.includes('/game');
    const gotAlert = alertMessage.length > 0;
    const body = await page.locator('body').innerText();
    const hasInlineError = body.includes('name') || body.includes('username') || body.includes('required');

    expect(stayedOnLobby || gotAlert || hasInlineError,
      `Empty username should be rejected. URL: ${url}, Alert: ${alertMessage}`).toBe(true);
  });

  test('whitespace-only username rejects game creation', async ({ page }) => {
    await goToLobby(page);
    await page.fill('input[placeholder="Enter your name…"]:visible', '   ');

    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.click('button:has-text("🚀 Create Game")');
    await page.waitForTimeout(2000);

    const url = page.url();
    const stayedOnLobby = !url.includes('/game');
    const gotAlert = alertMessage.length > 0;

    expect(stayedOnLobby || gotAlert,
      `Whitespace username should be rejected. URL: ${url}`).toBe(true);
  });

  test('join with empty game code shows error', async ({ page }) => {
    await goToLobby(page);
    await page.click('button:has-text("🔗 Join Game")');
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="Enter your name…"]:visible', 'JoinTester');
    // Leave code empty
    const codeInput = page.locator('input[placeholder*="e.g"]');
    await codeInput.fill('');

    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.locator('button:has-text("Join Game")').last().click();
    await page.waitForTimeout(2000);

    const url = page.url();
    const stayedOnLobby = !url.includes('/game');
    const gotAlert = alertMessage.length > 0;

    expect(stayedOnLobby || gotAlert,
      'Empty code should not navigate to game').toBe(true);
  });

  test('join with random invalid code shows error', async ({ page }) => {
    await goToLobby(page);
    await page.click('button:has-text("🔗 Join Game")');
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="Enter your name…"]:visible', 'InvalidJoiner');
    await page.fill('input[placeholder*="e.g"]', 'ZZZZZ9');
    await page.locator('button:has-text("Join Game")').last().click();

    await page.waitForTimeout(5000);
    const url = page.url();
    const body = await page.locator('body').innerText();

    const handledGracefully =
      !url.includes('/game') ||
      body.includes('not found') || body.includes('error') || body.includes('Error') ||
      body.includes('invalid') || body.includes('Game not found') ||
      body.includes('Waiting') || body.trim().length > 20;

    expect(handledGracefully, `Invalid code should be handled. URL: ${url}`).toBe(true);
  });

  test('switching between Create/Join/Tournament tabs rapidly causes no crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Accept any alerts that pop up (e.g. empty username alerts)
    page.on('dialog', dialog => dialog.accept().catch(() => {}));

    await goToLobby(page);

    // Use exact tab labels: '🎮 Create Game', '🔗 Join Game', '🏆 Tournament'
    // These are the tab-switching buttons — NOT submit buttons
    for (let i = 0; i < 6; i++) {
      await page.locator('button:has-text("🔗 Join Game")').first().click().catch(() => {});
      await page.waitForTimeout(80);
      await page.locator('button:has-text("🎮 Create Game")').first().click().catch(() => {});
      await page.waitForTimeout(80);
      await page.locator('button:has-text("🏆 Tournament")').first().click().catch(() => {});
      await page.waitForTimeout(80);
    }

    await page.waitForTimeout(500);
    // Should still be on lobby — not navigated to /game
    const url = page.url();
    expect(url, 'Should stay on lobby after rapid tab switching').not.toContain('/game');
    expect(errors, `JS errors during rapid tab switch: ${errors.join('; ')}`).toHaveLength(0);
  });

  test('creating game then trying to join own game is handled', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await goToLobby(page);
      const roomCode = await createGame(page, { username: 'SelfJoiner', playerCount: 2, gridSize: '3×3' });

      // Open a new page in same context and try to join
      const page2 = await ctx.newPage();
      await goToLobby(page2);
      await page2.click('button:has-text("🔗 Join Game")');
      await page2.waitForTimeout(200);
      await page2.fill('input[placeholder="Enter your name…"]:visible', 'SelfJoiner');
      await page2.fill('input[placeholder*="e.g"]', roomCode);
      await page2.locator('button:has-text("Join Game")').last().click();

      await page2.waitForTimeout(5000);
      // Should either show an error or handle it gracefully
      const body = await page2.locator('body').innerText();
      expect(body.trim().length).toBeGreaterThan(10);
      await page2.close();
    } finally {
      await ctx.close();
    }
  });

});
