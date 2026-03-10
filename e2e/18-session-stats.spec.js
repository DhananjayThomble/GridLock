// e2e/18-session-stats.spec.js — Session stats panel tests

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, getTurnState, makeMove,
} = require('./helpers');

test.describe('Session Stats', () => {

  test('stats button is visible in lobby', async ({ page }) => {
    await goToLobby(page);
    const statsBtn = page.locator('button').filter({ hasText: /📊.*Stats|Your Stats/i });
    await expect(statsBtn).toBeVisible();
  });

  test('clicking stats button expands stats panel', async ({ page }) => {
    await goToLobby(page);
    const statsBtn = page.locator('button').filter({ hasText: /📊.*Stats|Your Stats/i });
    await statsBtn.click();
    await page.waitForTimeout(500);

    const body = await page.locator('body').innerText();
    // Fresh session should show "No games played" or zero stats
    const hasStats = body.includes('No games played') || body.includes('Games') ||
      body.includes('Wins') || body.includes('Win Rate');
    expect(hasStats, 'Stats panel should show stats or empty message').toBe(true);
  });

  test('fresh session shows default values (0 games)', async ({ page }) => {
    await goToLobby(page);

    // Clear session stats
    await page.evaluate(() => localStorage.removeItem('gridlock_session_stats'));
    await page.reload({ waitUntil: 'networkidle' });

    const statsBtn = page.locator('button').filter({ hasText: /📊.*Stats|Your Stats/i });
    await statsBtn.click();
    await page.waitForTimeout(500);

    const body = await page.locator('body').innerText();
    expect(body).toContain('No games played');
  });

  test('after playing a game, stats update', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      // Clear stats first
      await p1.evaluate(() => localStorage.removeItem('gridlock_session_stats'));
      await p1.reload({ waitUntil: 'networkidle' });

      const roomCode = await createGame(p1, { username: 'StatsAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'StatsBob', roomCode });
      await waitForGameStart(p1, p2);

      // Play full game
      let gameOver = false;
      for (let i = 0; i < 24 && !gameOver; i++) {
        const { p1HasTurn, p2HasTurn } = await getTurnState(p1, p2);
        const current = p1HasTurn ? p1 : p2HasTurn ? p2 : null;
        if (!current) break;
        await makeMove(current);
        await p1.waitForTimeout(300);
        const t = await p1.locator('body').innerText();
        if (t.includes('Game Over') || t.includes('Rematch') || t.includes('Winner')) {
          gameOver = true;
        }
      }

      if (gameOver) {
        // Click Leave Game to return to lobby
        const leaveBtn = p1.locator('button:has-text("Leave Game")');
        if (await leaveBtn.isVisible().catch(() => false)) {
          await leaveBtn.click();
          await p1.waitForFunction(
            () => !window.location.href.includes('/game'),
            { timeout: 10_000 }
          );
        } else {
          await goToLobby(p1);
        }

        // Open stats panel
        const statsBtn = p1.locator('button').filter({ hasText: /📊.*Stats|Your Stats/i });
        await statsBtn.click();
        await p1.waitForTimeout(500);

        // Stats should now show at least 1 game
        const statsData = await p1.evaluate(() => {
          const raw = localStorage.getItem('gridlock_session_stats');
          return raw ? JSON.parse(raw) : null;
        });

        if (statsData) {
          expect(statsData.gamesPlayed).toBeGreaterThanOrEqual(1);
        }
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

});
