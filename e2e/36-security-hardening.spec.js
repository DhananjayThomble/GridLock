// e2e/36-security-hardening.spec.js — Security hardening, rate limiting, reconnection E2E tests

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, makeMove, getApiBase, BASE_URL,
} = require('./helpers');

test.describe('Security Headers (Helmet)', () => {

  test('API responses include security headers from Helmet', async ({ request }) => {
    const apiBase = getApiBase();
    const response = await request.get(`${apiBase}/health`);
    const headers = response.headers();

    // Helmet sets these by default
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBeDefined();
    // CSP header (custom one from server)
    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['content-security-policy']).toContain("default-src 'none'");
  });

  test('API responses include X-DNS-Prefetch-Control header', async ({ request }) => {
    const apiBase = getApiBase();
    const response = await request.get(`${apiBase}/health`);
    const headers = response.headers();
    expect(headers['x-dns-prefetch-control']).toBeDefined();
  });
});

test.describe('Payload Validation', () => {

  test('server rejects invalid game ID format via UI error', async ({ page }) => {
    await goToLobby(page);
    await page.click('button:has-text("🔗 Join Game")');
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="Enter your name…"]', 'TestUser');
    // Enter an invalid game code (too short)
    await page.fill('input[placeholder*="e.g"]', 'AB');
    // Try to join
    await page.click('button:has-text("Join as Player")');
    await page.getByRole('button', { name: /Join Game/i }).last().click();

    // Should see an error (either from client validation or server)
    await page.waitForTimeout(2000);
    // Should NOT navigate to /game
    expect(page.url()).not.toMatch(/\/game/);
  });
});

test.describe('XSS Prevention', () => {

  test('XSS in username is sanitized', async ({ page }) => {
    await goToLobby(page);
    // Enter a malicious username
    await page.fill('input[placeholder="Enter your name…"]', '<script>alert("xss")</script>');
    await page.click('button:has-text("2 Players")');
    await page.click('button:has-text("3×3")');

    // Enable CPU toggle for a quick game
    await page.locator('button:has-text("Play vs CPU")').click();
    await page.waitForSelector('text=/Easy|Medium|Hard/i', { timeout: 3000 });
    await page.click('button:has-text("🚀 Create Game")');
    await page.waitForURL(/\/game/, { timeout: 15_000 });

    // Wait for game to load
    await page.waitForFunction(
      () => /turn/i.test(document.body.innerText),
      { timeout: 20_000 }
    );

    // Verify no raw script tags in the page
    const bodyHtml = await page.content();
    expect(bodyHtml).not.toContain('<script>alert');

    // The escaped version should be displayed
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('<script>');
  });
});

test.describe('Reconnection Overlay', () => {

  test('reconnection overlay appears during disconnect', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await goToLobby(page);

      // Create a CPU game (simplest way to get into a game)
      await page.fill('input[placeholder="Enter your name…"]', 'OverlayTester');
      await page.click('button:has-text("2 Players")');
      await page.click('button:has-text("3×3")');
      await page.locator('button:has-text("Play vs CPU")').click();
      await page.waitForSelector('text=/Easy|Medium|Hard/i', { timeout: 3000 });
      await page.click('button:has-text("🚀 Create Game")');
      await page.waitForURL(/\/game/, { timeout: 15_000 });
      await page.waitForFunction(
        () => /turn/i.test(document.body.innerText),
        { timeout: 20_000 }
      );

      // Simulate network disconnect by going offline
      await page.context().setOffline(true);

      // Wait a bit for the socket to detect disconnect
      await page.waitForTimeout(3000);

      // Check for reconnection overlay
      const overlayVisible = await page.locator('.reconnection-overlay').isVisible().catch(() => false);
      const bodyText = await page.locator('body').innerText();
      const hasReconnectText = bodyText.includes('Reconnecting') || bodyText.includes('Connection Lost');

      // Re-enable network
      await page.context().setOffline(false);

      expect(overlayVisible || hasReconnectText).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('connection lost shows retry button after max reconnect attempts', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await goToLobby(page);

      // Navigate to game page
      await page.fill('input[placeholder="Enter your name…"]', 'RetryTester');
      await page.click('button:has-text("2 Players")');
      await page.click('button:has-text("3×3")');
      await page.locator('button:has-text("Play vs CPU")').click();
      await page.waitForSelector('text=/Easy|Medium|Hard/i', { timeout: 3000 });
      await page.click('button:has-text("🚀 Create Game")');
      await page.waitForURL(/\/game/, { timeout: 15_000 });
      await page.waitForFunction(
        () => /turn/i.test(document.body.innerText),
        { timeout: 20_000 }
      );

      // Go offline to trigger disconnect
      await page.context().setOffline(true);

      // Wait for reconnection attempts to exhaust (socket.io will retry)
      // The overlay should eventually show "Connection Lost" with retry button
      let hasRetryButton = false;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);
        const bodyText = await page.locator('body').innerText();
        if (bodyText.includes('Connection Lost') || bodyText.includes('Retry')) {
          hasRetryButton = true;
          break;
        }
      }

      // Re-enable network
      await page.context().setOffline(false);

      // If retry button appeared, verify it's clickable
      if (hasRetryButton) {
        const retryBtn = page.locator('.reconnect-retry-btn');
        if (await retryBtn.isVisible().catch(() => false)) {
          await retryBtn.click();
          // Should start reconnecting again
          await page.waitForTimeout(2000);
        }
      }

      // At minimum, the overlay mechanism should have been triggered
      expect(hasRetryButton).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Reconnection - Game State Restore', () => {

  test('reconnect mid-game restores game state', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    let ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    let p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'StateAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'StateBob', roomCode });
      await waitForGameStart(p1, p2);

      // Make a move to establish game state
      const text1 = await p1.locator('body').innerText();
      if (text1.includes('Your turn')) {
        await makeMove(p1);
      } else {
        await makeMove(p2);
      }
      await p1.waitForTimeout(1000);

      // Disconnect P2
      await p2.close();
      await ctx2.close();
      await p1.waitForTimeout(2000);

      // P2 reconnects
      ctx2 = await browser.newContext();
      p2 = await ctx2.newPage();
      await joinGame(p2, { username: 'StateBob', roomCode });
      await p1.waitForTimeout(3000);

      // Verify game state is restored (turn indicator present)
      const p2Body = await p2.locator('body').innerText();
      const hasGameState = p2Body.includes('turn') || p2Body.includes('Turn');
      expect(hasGameState).toBe(true);

      // Verify P1 sees reconnection
      const p1Body = await p1.locator('body').innerText();
      const gameActive = p1Body.includes('turn') || p1Body.includes('Turn');
      expect(gameActive).toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close().catch(() => {});
    }
  });
});

test.describe('Rate Limiting', () => {

  test('rapid HTTP requests get rate-limited', async ({ request }) => {
    const apiBase = getApiBase();

    // Send many rapid requests to health endpoint (stricter: 30/min)
    const responses = [];
    for (let i = 0; i < 35; i++) {
      const resp = await request.get(`${apiBase}/health`);
      responses.push(resp.status());
    }

    // At least some should be 429 (Too Many Requests)
    const rateLimited = responses.filter(s => s === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
