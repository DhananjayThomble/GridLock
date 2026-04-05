// frontend/tests/design-audit/capture.spec.js
// Layer 1: Screenshot capture + axe-core accessibility audit
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const REPORTS_DIR = path.join(__dirname, 'reports');

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

// Interactive states to capture on the lobby page
const LOBBY_STATES = [
  { name: 'empty-name-error', description: 'Empty name validation error' },
  { name: 'join-panel', description: 'Join Game panel open' },
  { name: 'tournament-panel', description: 'Tournament panel open' },
];

test.describe('Design Audit — Screenshot Capture', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  });

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const pageInfo of PAGES) {
        test(`${pageInfo.name}-${viewport.name}-${theme}`, async ({ page }) => {
          // Set viewport
          await page.setViewportSize({ width: viewport.width, height: viewport.height });

          // Set theme via localStorage before navigating
          await page.addInitScript((t) => {
            localStorage.setItem('gridlock_theme', t);
          }, theme);

          await page.goto(pageInfo.path, { waitUntil: 'networkidle' });

          // Wait for theme to apply
          await page.waitForFunction(
            (t) => document.documentElement.getAttribute('data-theme') === t,
            theme,
            { timeout: 5000 }
          );

          // Allow animations to settle
          await page.waitForTimeout(500);

          const filename = `${pageInfo.name}-${viewport.name}-${theme}.png`;
          await page.screenshot({
            path: path.join(SCREENSHOTS_DIR, filename),
            fullPage: true,
          });
        });
      }
    }
  }

  // Lobby interactive states — capture at all viewports × themes
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const state of LOBBY_STATES) {
        test(`lobby-${state.name}-${viewport.name}-${theme}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });

          await page.addInitScript((t) => {
            localStorage.setItem('gridlock_theme', t);
          }, theme);

          await page.goto('/', { waitUntil: 'networkidle' });

          await page.waitForFunction(
            (t) => document.documentElement.getAttribute('data-theme') === t,
            theme,
            { timeout: 5000 }
          );

          await page.waitForTimeout(500);

          if (state.name === 'empty-name-error') {
            // Clear the name input and try to trigger Quick Play to get validation error
            const nameInput = page.locator('input[placeholder*="name"], input[placeholder*="Name"]');
            if (await nameInput.isVisible()) {
              await nameInput.clear();
              // Try clicking Quick Play button to trigger validation
              const quickPlayBtn = page.locator('button:has-text("Quick Play"), button:has-text("Play")').first();
              if (await quickPlayBtn.isVisible()) {
                await quickPlayBtn.click();
                await page.waitForTimeout(300);
              }
            }
          } else if (state.name === 'join-panel') {
            // Click the Join button/tab to open the join panel
            const joinBtn = page.locator('button:has-text("Join"), [aria-pressed]:has-text("Join")').first();
            if (await joinBtn.isVisible()) {
              await joinBtn.click();
              await page.waitForTimeout(300);
            }
          } else if (state.name === 'tournament-panel') {
            // Click the Tournament button/tab to open the tournament panel
            const tournamentBtn = page.locator('button:has-text("Tournament"), [aria-pressed]:has-text("Tournament")').first();
            if (await tournamentBtn.isVisible()) {
              await tournamentBtn.click();
              await page.waitForTimeout(300);
            }
          }

          const filename = `lobby-${state.name}-${viewport.name}-${theme}.png`;
          await page.screenshot({
            path: path.join(SCREENSHOTS_DIR, filename),
            fullPage: true,
          });
        });
      }
    }
  }
});

test.describe('Design Audit — Accessibility', () => {
  const accessibilityResults = [];

  for (const pageInfo of PAGES) {
    for (const theme of THEMES) {
      test(`a11y-${pageInfo.name}-${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });

        await page.addInitScript((t) => {
          localStorage.setItem('gridlock_theme', t);
        }, theme);

        await page.goto(pageInfo.path, { waitUntil: 'networkidle' });

        await page.waitForFunction(
          (t) => document.documentElement.getAttribute('data-theme') === t,
          theme,
          { timeout: 5000 }
        );

        await page.waitForTimeout(500);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        accessibilityResults.push({
          page: pageInfo.name,
          url: pageInfo.path,
          theme,
          timestamp: new Date().toISOString(),
          violations: results.violations,
          passes: results.passes.length,
          incomplete: results.incomplete.length,
          inapplicable: results.inapplicable.length,
        });

        // Write after each test so we don't lose data on failure
        const reportsDir = path.join(__dirname, 'reports');
        fs.mkdirSync(reportsDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportsDir, 'accessibility.json'),
          JSON.stringify(accessibilityResults, null, 2)
        );
      });
    }
  }
});
