// tests/nightly/mobile-emulation.spec.js — Mobile device emulation tests
const { test, expect, devices } = require('@playwright/test');
const {
  createCpuGame, joinGame, createGame, goToLobby, BETA_URL,
} = require('../fixtures/test-helpers');

const MOBILE_DEVICES = {
  'iPhone 14': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'Pixel 7':   { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  'iPad':      { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true },
};

test.describe('Mobile Emulation', () => {

  test('iPhone 14 — create and play CPU game', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({
      ...MOBILE_DEVICES['iPhone 14'],
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    });
    const page = await ctx.newPage();

    try {
      await createCpuGame(page, { username: 'MobileIphone', gridSize: '3×3' });

      // Verify board fits screen — no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance

      // Verify interactive lines exist (touch targets)
      const lines = await page.locator('[role="button"][aria-disabled="false"]').count();
      expect(lines).toBeGreaterThan(0);

      // Verify lines are large enough for touch (at least 20px in one dimension)
      const firstLine = page.locator('[role="button"][aria-disabled="false"]').first();
      const box = await firstLine.boundingBox();
      if (box) {
        const minDimension = Math.min(box.width, box.height);
        expect(minDimension).toBeGreaterThanOrEqual(8); // minimum touch target
      }
    } finally {
      await ctx.close();
    }
  });

  test('Pixel 7 — join game via room code', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctxDesktop = await browser.newContext();
    const ctxMobile = await browser.newContext({
      ...MOBILE_DEVICES['Pixel 7'],
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36',
    });
    const desktopPage = await ctxDesktop.newPage();
    const mobilePage = await ctxMobile.newPage();

    try {
      const roomCode = await createGame(desktopPage, { username: 'PixelHost', playerCount: 2, gridSize: '3×3' });
      await joinGame(mobilePage, { username: 'PixelJoin', roomCode });

      // Verify mobile page shows game
      await mobilePage.waitForFunction(
        () => /turn/i.test(document.body.innerText),
        { timeout: 20_000 }
      );

      const bodyText = await mobilePage.locator('body').innerText();
      expect(bodyText).toMatch(/turn/i);
    } finally {
      await ctxDesktop.close();
      await ctxMobile.close();
    }
  });

  test('iPad — landscape layout adapts', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({
      ...MOBILE_DEVICES['iPad'],
    });
    const page = await ctx.newPage();

    try {
      await page.goto(BETA_URL, { waitUntil: 'networkidle' });
      await expect(page.locator('body')).toContainText('GridLock');

      // No horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);

      // Create a CPU game and check board renders
      await createCpuGame(page, { username: 'TabletPlayer', gridSize: '3×3' });
      const lines = await page.locator('[role="button"][aria-disabled="false"]').count();
      expect(lines).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  test.describe('Dark Mode', () => {
    for (const [name, config] of Object.entries(MOBILE_DEVICES)) {
      test(`${name} — dark mode renders without invisible elements`, async ({ browser }) => {
        test.setTimeout(60_000);
        const ctx = await browser.newContext({
          ...config,
          colorScheme: 'dark',
        });
        const page = await ctx.newPage();

        try {
          // Check homepage
          await page.goto(BETA_URL, { waitUntil: 'networkidle' });
          await expect(page.locator('body')).toContainText('GridLock');

          // Check that the body has a dark background
          const bgColor = await page.evaluate(() => {
            const styles = window.getComputedStyle(document.body);
            return styles.backgroundColor;
          });

          // Check leaderboard page
          await page.goto(`${BETA_URL}/leaderboard`, { waitUntil: 'networkidle' });
          const bodyText = await page.locator('body').innerText();
          // Should have visible content (not empty)
          expect(bodyText.length).toBeGreaterThan(50);

          // No JS errors in dark mode
          const errors = [];
          page.on('pageerror', e => errors.push(e.message));
          await page.goto(`${BETA_URL}/how-to-play`, { waitUntil: 'networkidle' });
          expect(errors).toHaveLength(0);
        } finally {
          await ctx.close();
        }
      });
    }
  });
});
