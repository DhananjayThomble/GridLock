// e2e/29-mobile-ux-audit.spec.js — UX quality checks with screenshots

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe('Mobile UX Audit', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('screenshot lobby in dark mode', async ({ page }) => {
    await goToLobby(page);

    // Ensure dark mode
    const themeToggle = page.locator('button:has([class*="Moon"]), button:has([class*="Sun"]), [aria-label*="theme"], [aria-label*="Theme"]').first();
    if (await themeToggle.isVisible().catch(() => false)) {
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark') ||
        document.body.classList.contains('dark')
      );
      if (!isDark) {
        await themeToggle.click();
        await page.waitForTimeout(300);
      }
    }

    await page.screenshot({
      path: 'e2e/screenshots/lobby-dark-mobile.png',
      fullPage: true,
    });
  });

  test('screenshot lobby in light mode', async ({ page }) => {
    await goToLobby(page);

    // Ensure light mode
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

    await page.screenshot({
      path: 'e2e/screenshots/lobby-light-mobile.png',
      fullPage: true,
    });
  });

  test('screenshot mid-game on mobile', async ({ page }) => {
    test.setTimeout(60_000);
    await goToLobby(page);
    await page.fill('input[placeholder="Enter your name…"]', 'ScreenshotUser');
    await page.click('button:has-text("2 Players")');
    await page.click('button:has-text("4×4")');

    // Enable CPU
    await page.locator('button:has-text("Play vs CPU")').click();
    await page.waitForTimeout(500);
    await page.click('button:has-text("🚀 Create Game")');
    await page.waitForURL(/\/game/, { timeout: 15_000 });
    await page.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 });

    // Make a couple of moves to get mid-game state
    for (let i = 0; i < 3; i++) {
      try {
        await page.waitForFunction(
          () => /your turn/i.test(document.body.innerText),
          { timeout: 10_000 }
        );
        const lines = await page.locator('[class*="cursor-pointer"]').all();
        if (lines.length > 0) {
          await lines[0].click({ timeout: 2000, force: true });
          await page.waitForTimeout(1000);
        }
      } catch {
        break;
      }
    }

    await page.screenshot({
      path: 'e2e/screenshots/mid-game-mobile.png',
      fullPage: true,
    });
  });

  test('screenshot game over on mobile', async ({ page }) => {
    test.setTimeout(90_000);
    await goToLobby(page);
    await page.fill('input[placeholder="Enter your name…"]', 'GameOverUser');
    await page.click('button:has-text("2 Players")');
    await page.click('button:has-text("3×3")'); // Small grid for faster completion

    // Enable CPU
    await page.locator('button:has-text("Play vs CPU")').click();
    await page.waitForTimeout(500);
    await page.click('button:has-text("🚀 Create Game")');
    await page.waitForURL(/\/game/, { timeout: 15_000 });
    await page.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 });

    // Play until game over
    for (let i = 0; i < 30; i++) {
      const text = await page.locator('body').innerText();
      if (/game over|winner|final/i.test(text)) break;

      try {
        await page.waitForFunction(
          () => /your turn/i.test(document.body.innerText),
          { timeout: 10_000 }
        );
        const lines = await page.locator('[class*="cursor-pointer"]').all();
        if (lines.length > 0) {
          await lines[0].click({ timeout: 2000, force: true });
          await page.waitForTimeout(500);
        }
      } catch {
        // CPU might be playing or game over
        await page.waitForTimeout(1000);
      }
    }

    await page.screenshot({
      path: 'e2e/screenshots/game-over-mobile.png',
      fullPage: true,
    });
  });

  test('no hardcoded text-white visible as wrong color', async ({ page }) => {
    await goToLobby(page);

    // Check for elements using hardcoded color classes that bypass CSS variables
    const hardcodedColors = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const issues = [];
      for (const el of allElements) {
        const classes = el.className;
        if (typeof classes === 'string') {
          // Check for hardcoded Tailwind color classes that should use CSS vars
          if (
            classes.includes('text-white') &&
            !classes.includes('dark:') &&
            el.offsetParent !== null // visible element
          ) {
            const computed = window.getComputedStyle(el);
            const bgColor = computed.backgroundColor;
            const textColor = computed.color;
            // White text on white/light background = problem
            if (textColor === 'rgb(255, 255, 255)' && bgColor.includes('255, 255, 255')) {
              issues.push({
                tag: el.tagName,
                text: el.textContent?.slice(0, 30),
                classes: classes.slice(0, 60),
              });
            }
          }
        }
      }
      return issues;
    });

    expect(
      hardcodedColors.length,
      `Elements with invisible white-on-white text: ${JSON.stringify(hardcodedColors)}`
    ).toBe(0);
  });

  test('theme toggle works', async ({ page }) => {
    await goToLobby(page);

    // Find theme toggle
    const themeToggle = page.locator('button:has([class*="Moon"]), button:has([class*="Sun"]), [aria-label*="theme"], [aria-label*="Theme"]').first();

    if (await themeToggle.isVisible().catch(() => false)) {
      const wasDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark') ||
        document.body.classList.contains('dark')
      );

      await themeToggle.click();
      await page.waitForTimeout(300);

      const isNowDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark') ||
        document.body.classList.contains('dark')
      );

      expect(isNowDark).not.toBe(wasDark);

      // Toggle back
      await themeToggle.click();
      await page.waitForTimeout(300);

      const isBack = await page.evaluate(() =>
        document.documentElement.classList.contains('dark') ||
        document.body.classList.contains('dark')
      );

      expect(isBack).toBe(wasDark);
    }
  });

  test('PWA manifest is valid', async ({ page }) => {
    await goToLobby(page);

    // Check for manifest link
    const manifestUrl = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      return link ? link.href : null;
    });

    if (manifestUrl) {
      const response = await page.request.get(manifestUrl);
      expect(response.ok()).toBe(true);

      const manifest = await response.json();
      expect(manifest.name).toBeTruthy();
      expect(manifest.icons).toBeTruthy();
      expect(manifest.icons.length).toBeGreaterThan(0);
      expect(manifest.start_url).toBeTruthy();
      expect(manifest.display).toBeTruthy();
    } else {
      // No manifest — skip but warn
      console.warn('No PWA manifest found — skipping validation');
    }
  });
});
