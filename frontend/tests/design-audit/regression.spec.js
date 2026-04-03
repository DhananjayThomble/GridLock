// frontend/tests/design-audit/regression.spec.js
// Layer 4: Visual regression baselines using Playwright's toHaveScreenshot()
import { test, expect } from '@playwright/test';

const PAGES = [
  { name: 'lobby', path: '/' },
  { name: 'leaderboard', path: '/leaderboard' },
  { name: 'history', path: '/history' },
  { name: 'how-to-play', path: '/how-to-play' },
  { name: 'settings', path: '/settings' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const THEMES = ['light', 'dark'];

test.describe('Design Audit — Visual Regression', () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const pageInfo of PAGES) {
        test(`regression-${pageInfo.name}-${viewport.name}-${theme}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });

          await page.addInitScript((t) => {
            localStorage.setItem('gridlock_theme', t);
          }, theme);

          await page.goto(pageInfo.path, { waitUntil: 'networkidle' });

          await page.waitForFunction(
            (t) => document.documentElement.getAttribute('data-theme') === t,
            theme,
            { timeout: 5000 }
          );

          // Wait for animations to settle
          await page.waitForTimeout(500);

          await expect(page).toHaveScreenshot(
            `${pageInfo.name}-${viewport.name}-${theme}.png`,
            {
              fullPage: true,
              maxDiffPixelRatio: 0.01,
            }
          );
        });
      }
    }
  }
});
