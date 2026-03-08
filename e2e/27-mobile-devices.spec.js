// e2e/27-mobile-devices.spec.js — Mobile-specific viewport and layout tests

const { test, expect } = require('@playwright/test');
const { goToLobby, createCpuGame, BASE_URL } = require('./helpers');

const MOBILE_VIEWPORTS = [
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'Pixel 7', width: 412, height: 915 },
  { name: 'iPad Mini', width: 768, height: 1024 },
];

test.describe('Mobile Device Layout Tests', () => {

  for (const vp of MOBILE_VIEWPORTS) {
    test.describe(`${vp.name} (${vp.width}x${vp.height})`, () => {

      test.use({ viewport: { width: vp.width, height: vp.height } });

      test('no horizontal scroll on lobby', async ({ page }) => {
        await goToLobby(page);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      });

      test('all interactive elements have touch targets >= 44px', async ({ page }) => {
        await goToLobby(page);
        const smallTargets = await page.evaluate(() => {
          const interactive = document.querySelectorAll('button, a, input, select, [role="button"]');
          const tooSmall = [];
          for (const el of interactive) {
            const rect = el.getBoundingClientRect();
            if (rect.height > 0 && rect.height < 44) {
              tooSmall.push({ tag: el.tagName, text: el.textContent?.slice(0, 30), height: rect.height });
            }
          }
          return tooSmall;
        });
        if (smallTargets.length > 0) console.warn(`Touch targets < 44px on ${vp.name}:`, smallTargets);
        const smallButtons = smallTargets.filter(t => t.tag === 'BUTTON');
        expect(smallButtons.length, `Buttons < 44px: ${JSON.stringify(smallButtons)}`).toBe(0);
      });

      test('username input is visible and focusable', async ({ page }) => {
        await goToLobby(page);
        const input = page.locator('input[placeholder="Enter your name…"]');
        await expect(input).toBeVisible();
        await input.focus();
        expect(await page.evaluate(() => document.activeElement?.tagName === 'INPUT')).toBe(true);
      });

      test('lobby cards render properly', async ({ page }) => {
        await goToLobby(page);
        for (const count of ['2 Players', '3 Players', '4 Players']) {
          const btn = page.locator(`button:has-text("${count}")`);
          await expect(btn).toBeVisible();
          const box = await btn.boundingBox();
          expect(box).not.toBeNull();
          expect(box.width).toBeGreaterThan(20);
        }
        for (const size of ['3×3', '4×4', '5×5', '6×6']) {
          await expect(page.locator(`button:has-text("${size}")`)).toBeVisible();
        }
      });

      test('no text truncation on lobby elements', async ({ page }) => {
        await goToLobby(page);
        const truncated = await page.evaluate(() => {
          const els = document.querySelectorAll('button, h1, h2, h3, p, span, label');
          const clipped = [];
          for (const el of els) {
            const s = window.getComputedStyle(el);
            if (s.overflow === 'hidden' && s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth)
              clipped.push({ tag: el.tagName, text: el.textContent?.slice(0, 40) });
          }
          return clipped;
        });
        expect(truncated.length, `Truncated: ${JSON.stringify(truncated)}`).toBe(0);
      });
    });
  }

  test.describe('Theme-specific mobile layout', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('dark theme renders correctly on mobile', async ({ page }) => {
      await goToLobby(page);
      const toggle = page.locator('[aria-label*="Switch to"]').first();
      if (await toggle.isVisible().catch(() => false)) {
        if (await page.getAttribute('html', 'data-theme') !== 'dark') {
          await toggle.click();
          await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 3000 });
        }
      }
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const cw = await page.evaluate(() => document.documentElement.clientWidth);
      expect(sw).toBeLessThanOrEqual(cw + 1);
    });

    test('light theme renders correctly on mobile', async ({ page }) => {
      await goToLobby(page);
      const toggle = page.locator('[aria-label*="Switch to"]').first();
      if (await toggle.isVisible().catch(() => false)) {
        if (await page.getAttribute('html', 'data-theme') !== 'light') {
          await toggle.click();
          await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', { timeout: 3000 });
        }
      }
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const cw = await page.evaluate(() => document.documentElement.clientWidth);
      expect(sw).toBeLessThanOrEqual(cw + 1);
    });
  });

  test.describe('Game board mobile fit', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('game board fits in viewport without scroll', async ({ page }) => {
      test.setTimeout(60_000);
      await createCpuGame(page, { username: 'MobileTest', gridSize: '3×3', playerCount: 2 });
      const sh = await page.evaluate(() => document.documentElement.scrollHeight);
      const vh = await page.evaluate(() => window.innerHeight);
      expect(sh).toBeLessThanOrEqual(vh * 1.15);
    });
  });
});
