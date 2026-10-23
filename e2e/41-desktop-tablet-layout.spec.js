// e2e/41-desktop-tablet-layout.spec.js
// Layout checks on laptop, desktop and tablet screens (#599). They measure the page rather than
// compare screenshots, so they stay stable: nothing scrolls during a game, the primary button
// is on screen, and touch targets on tablets are big enough.

const { test, expect, devices } = require('@playwright/test');
const { BASE_URL } = require('./helpers');

const SCREENS = [
  ['laptop 1280x720', { viewport: { width: 1280, height: 720 } }],
  ['laptop 1366x768', { viewport: { width: 1366, height: 768 } }],
  ['desktop 1440x900', { viewport: { width: 1440, height: 900 } }],
  ['full HD 1920x1080', { viewport: { width: 1920, height: 1080 } }],
  ['iPad 810x1080', { ...devices['iPad (gen 7)'] }],
  ['iPad landscape 1080x810', { ...devices['iPad (gen 7) landscape'] }],
  ['iPad Mini 768x1024', { ...devices['iPad Mini'] }],
];

async function open(browser, profile) {
  const ctx = await browser.newContext({ ...profile });
  await ctx.addInitScript(() => {
    localStorage.setItem('gridlock_has_played', 'true');
    localStorage.setItem('gridlock_username', 'LayoutQA');
  });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  return { ctx, page };
}

test.describe('Desktop and tablet layout', () => {
  test.setTimeout(90_000);

  for (const [name, profile] of SCREENS) {
    test(`${name}: Create Game is on screen and a game does not scroll`, async ({ browser }) => {
      const { ctx, page } = await open(browser, profile);
      try {
        const vh = page.viewportSize().height;
        const createBox = await page.locator('button:visible', { hasText: /Create Game/ }).first().boundingBox();
        expect(createBox.y + createBox.height, 'Create Game must be reachable without scrolling').toBeLessThanOrEqual(vh);

        // 4 players vs CPU on a 6x6 grid: the tallest header and the biggest board
        await page.locator('button:visible', { hasText: /(^4P$|4 Players)/ }).first().click();
        await page.locator('button:visible', { hasText: /6×6/ }).first().click();
        await page.locator('button[role="switch"][aria-label="Add CPU opponents"]:visible').click();
        await page.locator('button:visible', { hasText: /3 🤖/ }).first().click();
        await page.locator('button:visible', { hasText: /Create Game/ }).first().click();
        await expect(page.getByTestId('board-container')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(600);

        const m = await page.evaluate(() => {
          const leave = [...document.querySelectorAll('button')].find((b) => /Leave Game/.test(b.innerText));
          const board = document.querySelector('[data-testid=board-container]').getBoundingClientRect();
          return {
            scrolls: document.documentElement.scrollHeight > innerHeight + 2,
            leaveBottom: leave ? leave.getBoundingClientRect().bottom : null,
            vh: innerHeight, boardW: board.width, boardRight: board.right, vw: innerWidth,
          };
        });
        expect(m.scrolls, 'the game page should fit the window').toBe(false);
        expect(m.leaveBottom, 'Leave Game visible').toBeLessThanOrEqual(m.vh);
        expect(m.boardRight).toBeLessThanOrEqual(m.vw);
        expect(m.boardW).toBeGreaterThan(300);
      } finally { await ctx.close(); }
    });
  }

  test('resizing the window mid-game keeps the board fitted', async ({ browser }) => {
    const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
    try {
      await page.locator('button[role="switch"][aria-label="Add CPU opponents"]:visible').click();
      await page.locator('button:visible', { hasText: /Create Game/ }).first().click();
      await expect(page.getByTestId('board-container')).toBeVisible({ timeout: 20_000 });
      for (const [w, h] of [[1000, 700], [700, 900], [1440, 900]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(400);
        const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2
          || document.documentElement.scrollWidth > innerWidth);
        expect(scrolls, `${w}x${h}`).toBe(false);
      }
    } finally { await ctx.close(); }
  });

  test('the active player\'s score card does not overlap the next one', async ({ browser }) => {
    const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
    try {
      await page.locator('button[role="switch"][aria-label="Add CPU opponents"]:visible').click();
      await page.locator('button:visible', { hasText: /Create Game/ }).first().click();
      await expect(page.getByTestId('board-container')).toBeVisible({ timeout: 20_000 });
      const cards = await page.locator('.scoreboard-cards > *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right]));
      expect(cards.length).toBeGreaterThanOrEqual(2);
      expect(cards[0][1], 'first card ends before the second starts').toBeLessThanOrEqual(cards[1][0] + 0.5);
    } finally { await ctx.close(); }
  });

  test('tablet: tappable controls on History are at least 40px tall', async ({ browser }) => {
    const { ctx, page } = await open(browser, { ...devices['iPad (gen 7)'] });
    try {
      await page.goto(`${BASE_URL}/history?player=LayoutQA`, { waitUntil: 'networkidle' });
      const heights = await page.locator('select:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThan(0);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    } finally { await ctx.close(); }
  });
});
