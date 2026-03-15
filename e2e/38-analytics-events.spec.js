// e2e/38-analytics-events.spec.js — Verify app works without PostHog analytics config

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, makeMove, playToCompletion,
  createCpuGame, BASE_URL,
} = require('./helpers');

test.describe('Analytics graceful degradation — no PostHog configured', () => {

  test('gameplay flow works end-to-end without analytics config', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await goToLobby(page1, BASE_URL);
      const roomCode = await createGame(page1, { username: 'AnalyticsP1', playerCount: 2, gridSize: '3×3' });

      await joinGame(page2, { username: 'AnalyticsP2', roomCode, baseUrl: BASE_URL });
      await waitForGameStart(page1, page2);

      // Play a few moves — verify no crashes
      for (let i = 0; i < 3; i++) {
        for (const page of [page1, page2]) {
          const text = await page.locator('body').innerText();
          if (text.includes('Your turn')) {
            await makeMove(page);
            break;
          }
        }
        await page1.waitForTimeout(500);
      }

      // Verify game is still running — no errors or crashes
      const p1Text = await page1.locator('body').innerText();
      const p2Text = await page2.locator('body').innerText();
      // Should show game content (turn info, board, etc.)
      expect(p1Text.length).toBeGreaterThan(50);
      expect(p2Text.length).toBeGreaterThan(50);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('spectator join works without analytics config', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctxSpec = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const spectator = await ctxSpec.newPage();

    try {
      await goToLobby(page1, BASE_URL);
      const roomCode = await createGame(page1, { username: 'Host', playerCount: 2, gridSize: '3×3' });

      await joinGame(page2, { username: 'Player2', roomCode, baseUrl: BASE_URL });
      await waitForGameStart(page1, page2);

      // Join as spectator
      await joinGame(spectator, { username: 'Watcher', roomCode, baseUrl: BASE_URL, joinMode: 'spectator' });

      // Spectator should see the game board
      await spectator.waitForTimeout(2000);
      const specText = await spectator.locator('body').innerText();
      expect(specText).toMatch(/spectating|watching|turn/i);
    } finally {
      await ctx1.close();
      await ctx2.close();
      await ctxSpec.close();
    }
  });

  test('CPU game works without analytics config (covers game_started event path)', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await createCpuGame(page, { username: 'AnalyticsCPU', gridSize: '3×3', playerCount: 2 });

    // Make a few moves
    for (let i = 0; i < 5; i++) {
      const text = await page.locator('body').innerText();
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) break;
      if (text.includes('Your turn')) {
        await makeMove(page);
      }
      await page.waitForTimeout(500);
    }

    // No PostHog-related errors
    const posthogErrors = jsErrors.filter((msg) => /posthog/i.test(msg));
    expect(posthogErrors).toHaveLength(0);
  });

  test('tournament lobby renders without analytics config', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto(`${BASE_URL}/tournament`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Page should render something (may show "no tournaments" or the lobby)
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);

    // No PostHog-related errors
    const posthogErrors = jsErrors.filter((msg) => /posthog/i.test(msg));
    expect(posthogErrors).toHaveLength(0);
  });

  test('rematch flow works without analytics config', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await goToLobby(page1, BASE_URL);
      const roomCode = await createGame(page1, { username: 'RematchP1', playerCount: 2, gridSize: '3×3' });

      await joinGame(page2, { username: 'RematchP2', roomCode, baseUrl: BASE_URL });
      await waitForGameStart(page1, page2);

      // Play to completion
      const completed = await playToCompletion([page1, page2], 80);
      expect(completed).toBe(true);

      // Look for rematch button on either page
      let rematchPage = null;
      for (const p of [page1, page2]) {
        const rematchBtn = p.locator('button:has-text("Rematch")');
        if (await rematchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          rematchPage = p;
          break;
        }
      }

      if (rematchPage) {
        // Click rematch — should not crash
        await rematchPage.click('button:has-text("Rematch")');
        await rematchPage.waitForTimeout(2000);
        const text = await rematchPage.locator('body').innerText();
        // Should show waiting for rematch or new game started
        expect(text.length).toBeGreaterThan(20);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

});
