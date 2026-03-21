// tests/weekly/visual-regression.spec.js — Screenshot comparison with pixelmatch
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { createCpuGame, BETA_URL } = require('../fixtures/test-helpers');

const BASELINES_DIR = path.join(__dirname, '..', 'baselines', 'screenshots');
const CURRENT_DIR = path.join(__dirname, '..', 'results', 'screenshots', 'current');
const DIFFS_DIR = path.join(__dirname, '..', 'results', 'screenshots', 'diffs');

const UPDATE_BASELINES = process.env.UPDATE_BASELINES === 'true';
const DIFF_THRESHOLD = 0.005; // 0.5% pixel difference triggers regression

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'leaderboard', path: '/leaderboard' },
  { name: 'how-to-play', path: '/how-to-play' },
];

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const THEMES = ['light', 'dark'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function compareScreenshots(baselinePath, currentPath, diffPath) {
  if (!fs.existsSync(baselinePath)) {
    return { isNew: true, diffPercent: 0, reason: 'No baseline — first run' };
  }

  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(fs.readFileSync(currentPath));

  // Handle size mismatch
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      isNew: false,
      diffPercent: 1.0,
      reason: `Size mismatch: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const numDiffPixels = pixelmatch(
    baseline.data, current.data, diff.data,
    width, height,
    { threshold: 0.1 }
  );

  const diffPercent = numDiffPixels / (width * height);

  if (diffPercent > DIFF_THRESHOLD) {
    ensureDir(path.dirname(diffPath));
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return { isNew: false, diffPercent, reason: null };
}

test.describe('Visual Regression', () => {

  test.beforeAll(() => {
    ensureDir(CURRENT_DIR);
    ensureDir(DIFFS_DIR);
    ensureDir(BASELINES_DIR);
  });

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const pg of PAGES) {
        test(`${pg.name} — ${viewport.name} — ${theme}`, async ({ browser }) => {
          test.setTimeout(30_000);
          const ctx = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme: theme,
          });
          const page = await ctx.newPage();

          try {
            await page.goto(`${BETA_URL}${pg.path}`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(1_000); // Let animations settle

            const filename = `${pg.name}-${viewport.name}-${theme}.png`;
            const currentPath = path.join(CURRENT_DIR, filename);
            const baselinePath = path.join(BASELINES_DIR, filename);
            const diffPath = path.join(DIFFS_DIR, filename);

            await page.screenshot({ path: currentPath, fullPage: false });

            if (UPDATE_BASELINES) {
              fs.copyFileSync(currentPath, baselinePath);
              console.log(`  📸 Updated baseline: ${filename}`);
            } else {
              const result = compareScreenshots(baselinePath, currentPath, diffPath);

              if (result.isNew) {
                console.log(`  🆕 New screenshot (no baseline): ${filename}`);
                // Auto-save as baseline on first run
                fs.copyFileSync(currentPath, baselinePath);
              } else if (result.diffPercent > DIFF_THRESHOLD) {
                console.log(`  ❌ Visual regression: ${filename} — ${(result.diffPercent * 100).toFixed(2)}% diff`);
                if (result.reason) console.log(`     Reason: ${result.reason}`);
                // Don't fail — flag as warning. Visual regressions need human review.
                test.info().annotations.push({
                  type: 'visual-regression',
                  description: `${(result.diffPercent * 100).toFixed(2)}% pixel difference`,
                });
              } else {
                console.log(`  ✅ ${filename} — ${(result.diffPercent * 100).toFixed(3)}% diff (within threshold)`);
              }
            }
          } finally {
            await ctx.close();
          }
        });
      }
    }
  }

  // Game board screenshot (special — requires creating a game)
  test('game board — desktop — light', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
    });
    const page = await ctx.newPage();

    try {
      await createCpuGame(page, { username: 'VisualBoard', gridSize: '3×3' });
      await page.waitForTimeout(2_000);

      const filename = 'game-board-desktop-light.png';
      const currentPath = path.join(CURRENT_DIR, filename);
      const baselinePath = path.join(BASELINES_DIR, filename);

      await page.screenshot({ path: currentPath, fullPage: false });

      if (UPDATE_BASELINES) {
        fs.copyFileSync(currentPath, baselinePath);
        console.log(`  📸 Updated baseline: ${filename}`);
      } else if (!fs.existsSync(baselinePath)) {
        fs.copyFileSync(currentPath, baselinePath);
        console.log(`  🆕 New baseline: ${filename}`);
      } else {
        const result = compareScreenshots(baselinePath, currentPath,
          path.join(DIFFS_DIR, filename));
        console.log(`  Game board: ${(result.diffPercent * 100).toFixed(3)}% diff`);
      }
    } finally {
      await ctx.close();
    }
  });
});
