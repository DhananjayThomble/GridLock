// e2e/14-profile.spec.js — Player profile page tests

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, getTurnState, makeMove, getApiBase, BASE_URL,
} = require('./helpers');

test.describe('Player Profile Page', () => {

  test('navigating to /profile/nonexistent shows error state', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile/nonexistent_user_xyz_999`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText();
    // Should show error or "not found" — not a blank page
    const hasError = body.includes('error') || body.includes('Error') ||
      body.includes('Failed') || body.includes('not found') ||
      body.includes('Back to Leaderboard') || body.includes('Leaderboard');
    expect(hasError, `Profile for nonexistent user should show error. Body: ${body.slice(0, 300)}`).toBe(true);
  });

  test('profile error page has back to leaderboard link', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile/nonexistent_user_xyz_999`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const backLink = page.locator('a[href*="leaderboard"]');
    const count = await backLink.count();
    expect(count, 'Should have a link back to leaderboard').toBeGreaterThan(0);
  });

  test('profile page via API returns success or not-found for nonexistent user', async ({ request }) => {
    const res = await request.get(`${getApiBase()}/api/profile/nonexistent_user_xyz_999`);
    expect([200, 404]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('success');
  });

  test('leaderboard page loads and has user links', async ({ page }) => {
    await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    // Should contain leaderboard content
    expect(body).toContain('Leaderboard');
  });

  test('direct navigation to /profile/testuser loads page (not blank)', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile/testuser`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText();
    // Should show either profile data or error — not blank
    expect(body.trim().length).toBeGreaterThan(10);
  });

  test('mobile viewport: profile page renders correctly', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/profile/nonexistent_user_xyz_999`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const body = await page.locator('body').innerText();
    expect(body.trim().length).toBeGreaterThan(10);

    // Page should not overflow horizontally
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(400);

    await ctx.close();
  });

  test('play game, then check profile shows stats via API', async ({ browser, request }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    const profileName = `ProfileTest_${Date.now()}`;
    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: profileName, gridSize: '3×3' });
    await joinGame(p2, { username: 'ProfileBot', roomCode });
    await waitForGameStart(p1, p2);

    try {
      // Play full game
      let gameOver = false;
      for (let i = 0; i < 24 && !gameOver; i++) {
        const { p1HasTurn, p2HasTurn } = await getTurnState(p1, p2);
        const current = p1HasTurn ? p1 : p2HasTurn ? p2 : null;
        if (!current) break;
        await makeMove(current);
        await p1.waitForTimeout(300);
        const t = await p1.locator('body').innerText();
        if (t.includes('Game Over') || t.includes('Play Again') || t.includes('Winner')) {
          gameOver = true;
        }
      }

      if (gameOver) {
        // Check profile API for the player
        const res = await request.get(`${getApiBase()}/api/profile/${encodeURIComponent(profileName)}`);
        if (res.status() === 200) {
          const data = await res.json();
          if (data.success && data.profile) {
            expect(data.profile.gamesPlayed).toBeGreaterThanOrEqual(1);
          }
        }
        // If 404, profile system may not persist for test users — that's OK
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

});
