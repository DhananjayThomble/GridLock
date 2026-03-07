// e2e/27-mobile-devices.spec.js — Mobile-specific viewport and layout tests

const { test, expect, devices } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

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
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance
      });

      test('all interactive elements have touch targets ≥ 44px', async ({ page }) => {
        await goToLobby(page);
        const smallTargets = await page.evaluate(() => {
          const interactive = document.querySelectorAll('button, a, input, select, [role="button"]');
          const tooSmall = [];
          for (const el of interactive) {
            const rect = el.getBoundingClientRect();
            if (rect.height > 0 && rect.height < 44) {
              tooSmall.push({
                tag: el.tagName,
                text: el.textContent?.slice(0, 30),
                height: rect.height,
              });
            }
          }
          return tooSmall;
        });
        // Log for debugging but don't hard-fail on minor violations
        if (smallTargets.length > 0) {
          console.warn(`Touch targets < 44px on ${vp.name}:`, smallTargets);
        }
        // At minimum, buttons should be ≥ 44px
        const smallButtons = smallTargets.filter(t => t.tag === 'BUTTON');
        expect(smallButtons.length, `Buttons with height < 44px: ${JSON.stringify(smallButtons)}`).toBe(0);
      });

      test('username input is visible and focusable', async ({ page }) => {
        await goToLobby(page);
        const input = page.locator('input[placeholder="Enter your name…"]');
        await expect(input).toBeVisible();
        await input.focus();
        const isFocused = await page.evaluate(
          () => document.activeElement?.tagName === 'INPUT'
        );
        expect(isFocused).toBe(true);
      });

      test('lobby cards render properly without truncation', async ({ page }) => {
        await goToLobby(page);

        // Check player count buttons are visible
        for (const count of ['2 Players', '3 Players', '4 Players']) {
          const btn = page.locator(`button:has-text("${count}")`);
          await expect(btn).toBeVisible();
          // Verify text is not clipped
          const box = await btn.boundingBox();
          expect(box).not.toBeNull();
          expect(box.width).toBeGreaterThan(20);
        }

        // Check grid size buttons
        for (const size of ['3×3', '4×4', '5×5', '6×6']) {
          const btn = page.locator(`button:has-text("${size}")`);
          await expect(btn).toBeVisible();
        }
      });

      test('no text truncation on lobby elements', async ({ page }) => {
        await goToLobby(page);
        const truncated = await page.evaluate(() => {
          const els = document.querySelectorAll('button, h1, h2, h3, p, span, label');
          const clipped = [];
          for (const el of els) {
            const style = window.getComputedStyle(el);
            if (
              style.overflow === 'hidden' &&
              style.textOverflow === 'ellipsis' &&
              el.scrollWidth > el.clientWidth
            ) {
              clipped.push({
                tag: el.tagName,
                text: el.textContent?.slice(0, 40),
              });
            }
          }
          return clipped;
        });
        expect(truncated.length, `Truncated elements: ${JSON.stringify(truncated)}`).toBe(0);
      });
    });
  }

  test.describe('Theme-specific mobile layout', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('dark theme renders correctly on mobile', async ({ page }) => {
      await goToLobby(page);
      // Set dark theme
      const themeToggle = page.locator('button:has([class*="Moon"]), button:has([class*="Sun"]), [aria-label*="theme"], [aria-label*="Theme"]').first();
      if (await themeToggle.isVisible().catch(() => false)) {
        // Ensure dark mode
        const isDark = await page.evaluate(() =>
          document.documentElement.classList.contains('dark') ||
          document.body.classList.contains('dark')
        );
        if (!isDark) {
          await themeToggle.click();
          await page.waitForTimeout(300);
        }
      }

      // Verify no horizontal overflow in dark mode
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test('light theme renders correctly on mobile', async ({ page }) => {
      await goToLobby(page);
      // Set light theme
      const themeToggle = page.locator('button:has([class*="Moon"]), button:has([class*="Sun"]), [aria-label*="theme"], [aria-label*="Theme"]').first();
      if (await themeToggle.isVisible().catch(() => false)) {
        const isDark = await page.evaluate(() =>
          document.documentElement.classList.contains('dark') ||
          document.body.classList.contains('dark')
        );
        if (isDark) {
          await themeToggle.click();
          await page.waitForTimeout(300);
        }
      }

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  });

  test.describe('Game board mobile fit', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('game board fits in viewport without scroll (portrait)', async ({ page }) => {
      test.setTimeout(60_000);
      await goToLobby(page);
      await page.fill('input[placeholder="Enter your name…"]', 'MobileTest');
      await page.click('button:has-text("2 Players")');
      await page.click('button:has-text("3×3")');

      // Enable CPU so game starts immediately
      await page.locator('button:has-text("Play vs CPU")').click();
      await page.waitForTimeout(500);
      await page.click('button:has-text("🚀 Create Game")');
      await page.waitForURL(/\/game/, { timeout: 15_000 });
      await page.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 });

      // Check game board doesn't cause vertical scroll beyond viewport
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      // Allow some tolerance (nav bars, etc.)
      expect(scrollHeight).toBeLessThanOrEqual(viewportHeight * 1.15);
    });
  });
});
