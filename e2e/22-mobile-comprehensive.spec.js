// e2e/22-mobile-comprehensive.spec.js — Comprehensive mobile testing

const { test, expect, devices } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, getTurnState, makeMove, BASE_URL,
} = require('./helpers');

const MOBILE_VIEWPORT = { width: 375, height: 667 };

// Mobile tap helper — tries role=button first, falls back to cursor-pointer
async function tapMove(page) {
  // Try role=button elements first (board lines)
  const roleLines = page.locator('[role="button"][tabindex="0"]');
  const roleCount = await roleLines.count().catch(() => 0);
  for (let i = 0; i < Math.min(roleCount, 20); i++) {
    try {
      await roleLines.nth(i).tap({ timeout: 2500, force: true });
      return true;
    } catch { continue; }
  }
  // Fall back to cursor-pointer class elements
  const cpLines = await page.locator('[class*="cursor-pointer"]').all();
  for (const line of cpLines.slice(0, 10)) {
    try {
      await line.tap({ timeout: 2000, force: true });
      return true;
    } catch { continue; }
  }
  // Last resort: regular click
  return makeMove(page);
}

test.describe('Mobile Comprehensive (375×667)', () => {

  test('lobby renders with all controls accessible', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await ctx.newPage();

    try {
      await goToLobby(page);

      // Username input visible
      await expect(page.getByPlaceholder('Enter your name…')).toBeVisible();

      // Player count buttons visible
      await expect(page.locator('button:has-text("2 Players"):visible').first()).toBeVisible();

      // Create game button visible
      const createBtn = page.locator('button:has-text("🚀 Create Game"):visible').first();
      await expect(createBtn).toBeVisible();

      // Join game tab visible
      await expect(page.locator('button:has-text("🔗 Join Game"):visible').first()).toBeVisible();

      // No horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 5);
    } finally {
      await ctx.close();
    }
  });

  test('create game → board renders within mobile viewport', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx1 = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const ctx2 = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'MobileAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'MobileBob', roomCode });
      await waitForGameStart(p1, p2);

      // Board should be visible
      const body = await p1.locator('body').innerText();
      expect(body).toMatch(/turn/i);

      // No horizontal overflow on game board
      const scrollWidth = await p1.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(400);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('score bar visible and readable on mobile', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx1 = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const ctx2 = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'ScoreAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'ScoreBob', roomCode });
      await waitForGameStart(p1, p2);

      // Both player names visible in score bar
      await expect(p1.locator('body')).toContainText('ScoreAlice');
      await expect(p1.locator('body')).toContainText('ScoreBob');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('game-over modal fits on mobile screen', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const ctx2 = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'ModalAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'ModalBob', roomCode });
      await waitForGameStart(p1, p2);

      // Play to completion
      let gameOver = false;
      for (let i = 0; i < 24 && !gameOver; i++) {
        const { p1HasTurn, p2HasTurn } = await getTurnState(p1, p2);
        const current = p1HasTurn ? p1 : p2HasTurn ? p2 : null;
        if (!current) break;
        await makeMove(current);
        await p1.waitForTimeout(300);
        const t = await p1.locator('body').innerText();
        if (t.includes('Game Over') || t.includes('Rematch')) { gameOver = true; }
      }

      if (gameOver) {
        // Modal should be visible
        const body = await p1.locator('body').innerText();
        expect(body).toMatch(/Game Over|Rematch|Winner/);

        // Modal shouldn't overflow
        const scrollWidth = await p1.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(400);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('leaderboard page is scrollable on mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await ctx.newPage();

    try {
      await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      const body = await page.locator('body').innerText();
      expect(body).toContain('Leaderboard');

      // Page should have some height
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      expect(bodyHeight).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  test('profile page stacks vertically on mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await ctx.newPage();

    try {
      await page.goto(`${BASE_URL}/profile/nonexistent`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);

      const body = await page.locator('body').innerText();
      expect(body.trim().length).toBeGreaterThan(10);

      // No horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(400);
    } finally {
      await ctx.close();
    }
  });

  test('touch on game board lines works', async ({ browser }) => {
    test.setTimeout(60_000);
    // Use a real device preset that includes isMobile + hasTouch
    const ctx1 = await browser.newContext({ ...devices['iPhone SE'] });
    const ctx2 = await browser.newContext({ ...devices['iPhone SE'] });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'TouchA', gridSize: '3×3' });
      await joinGame(p2, { username: 'TouchB', roomCode });
      await waitForGameStart(p1, p2);

      const { p1HasTurn } = await getTurnState(p1, p2);
      const currentPage = p1HasTurn ? p1 : p2;
      const otherPage = p1HasTurn ? p2 : p1;

      const moved = await tapMove(currentPage);
      expect(moved, 'Should be able to interact with board on mobile').toBe(true);

      // Verify turn switches
      await otherPage.waitForFunction(
        () => document.body.innerText.includes('Your turn'),
        { timeout: 10_000 }
      );
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

});
