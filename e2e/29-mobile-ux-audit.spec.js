// e2e/29-mobile-ux-audit.spec.js — UX quality checks with screenshots
// No viewport override — uses project device profile or chromium default.
// NOTE: Theme toggle covered by 24-theme-toggle.spec.js — not duplicated.
// NOTE: PWA manifest covered by 13-pwa.spec.js — not duplicated.

const { test, expect } = require('@playwright/test');
const { goToLobby, createCpuGame, BASE_URL } = require('./helpers');

test.describe('Mobile UX Audit', () => {

  test('screenshot lobby in dark mode', async ({ page }) => {
    await goToLobby(page);
    const toggle = page.locator('[aria-label*="Switch to"]').first();
    if (await toggle.isVisible().catch(() => false)) {
      if (await page.getAttribute('html', 'data-theme') !== 'dark') {
        await toggle.click();
        await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 3000 });
      }
    }
    await page.screenshot({ path: 'e2e/screenshots/lobby-dark-mobile.png', fullPage: true });
  });

  test('screenshot lobby in light mode', async ({ page }) => {
    await goToLobby(page);
    const toggle = page.locator('[aria-label*="Switch to"]').first();
    if (await toggle.isVisible().catch(() => false)) {
      if (await page.getAttribute('html', 'data-theme') !== 'light') {
        await toggle.click();
        await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', { timeout: 3000 });
      }
    }
    await page.screenshot({ path: 'e2e/screenshots/lobby-light-mobile.png', fullPage: true });
  });

  test('screenshot mid-game on mobile', async ({ page }) => {
    test.setTimeout(90_000);
    await createCpuGame(page, { username: 'ScreenshotUser', gridSize: '4×4', playerCount: 2 });
    for (let i = 0; i < 3; i++) {
      try {
        await page.waitForFunction(() => /your turn/i.test(document.body.innerText), { timeout: 10_000 });
        const lines = await page.locator('[role="button"][aria-disabled="false"]').all();
        if (lines.length > 0) {
          await lines[0].click({ timeout: 2000, force: true });
          await page.waitForFunction(() => !/your turn/i.test(document.body.innerText), { timeout: 10_000 }).catch(() => {});
        }
      } catch { break; }
    }
    await page.screenshot({ path: 'e2e/screenshots/mid-game-mobile.png', fullPage: true });
  });

  test('screenshot game over on mobile', async ({ page }) => {
    test.setTimeout(60_000);
    await createCpuGame(page, { username: 'GameOverUser', gridSize: '3×3', playerCount: 2 });
    for (let i = 0; i < 30; i++) {
      const text = await page.locator('body').innerText();
      if (/game over|winner|final/i.test(text)) break;
      try {
        await page.waitForFunction(() => /your turn/i.test(document.body.innerText), { timeout: 10_000 });
        const lines = await page.locator('[role="button"][aria-disabled="false"]').all();
        if (lines.length > 0) {
          await lines[0].click({ timeout: 2000, force: true });
          await page.waitForFunction(() => !/your turn/i.test(document.body.innerText), { timeout: 10_000 }).catch(() => {});
        }
      } catch {
        await page.waitForFunction(
          () => /your turn|game over|winner|final/i.test(document.body.innerText),
          { timeout: 5_000 }
        ).catch(() => {});
      }
    }
    await page.screenshot({ path: 'e2e/screenshots/game-over-mobile.png', fullPage: true });
  });

  test('no hardcoded text colors bypass CSS variables', async ({ page }) => {
    await goToLobby(page);
    const issues = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      const found = [];
      const classPatterns = [
        /\btext-white\b/, /\btext-black\b/,
        /\bbg-white\b/, /\bbg-black\b/,
        /\btext-gray-\d+\b/, /\btext-slate-\d+\b/,
        /\bbg-gray-\d+\b/, /\bbg-slate-\d+\b/,
      ];
      // Inline style patterns for hardcoded hex colors (N7)
      const inlineColorRe = /(?:^|;\s*)color\s*:\s*#[0-9a-f]{3,8}/i;
      const inlineBgRe    = /(?:^|;\s*)background(?:-color)?\s*:\s*#[0-9a-f]{3,8}/i;
      for (const el of all) {
        if (el.offsetParent === null) continue;

        // Check class-based hardcoded colors
        const cls = el.className;
        if (typeof cls === 'string' && !cls.includes('dark:')) {
          for (const p of classPatterns) {
            if (p.test(cls)) {
              const cs = window.getComputedStyle(el);
              if (cs.color === 'rgb(255, 255, 255)' && cs.backgroundColor.includes('255, 255, 255'))
                found.push({ tag: el.tagName, text: el.textContent?.slice(0, 30), issue: 'white-on-white' });
              if (cs.color === 'rgb(0, 0, 0)' && cs.backgroundColor === 'rgb(0, 0, 0)')
                found.push({ tag: el.tagName, text: el.textContent?.slice(0, 30), issue: 'black-on-black' });
            }
          }
        }

        // Check inline style hardcoded colors
        const style = el.getAttribute('style');
        if (style) {
          if (inlineColorRe.test(style))
            found.push({ tag: el.tagName, text: el.textContent?.slice(0, 30), issue: 'inline-color-hex', style: style.slice(0, 60) });
          if (inlineBgRe.test(style))
            found.push({ tag: el.tagName, text: el.textContent?.slice(0, 30), issue: 'inline-bg-hex', style: style.slice(0, 60) });
        }
      }
      return found;
    });
    expect(issues.length, `Invisible text or hardcoded inline colors: ${JSON.stringify(issues)}`).toBe(0);
  });
});
