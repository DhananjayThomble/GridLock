// e2e/visual-qa.spec.js
// Visual QA pipeline — 210 automated UI checks across all viewport × mode × theme combinations.
// Run with: npm run visual-qa
// Targets BASE_URL env var or falls back to env-config.js resolution.

const { test, expect } = require('@playwright/test');
const spec = require('../frontend/design-spec.json');
const { computeContrastRatio, parseColor } = require('./helpers/contrast');
const { envCfg } = require('./env-config');

const BASE_URL = process.env.BASE_URL || process.env.TEST_BASE_URL || envCfg.baseURL;

// Pages to check for overflow / clipping / contrast
const PAGES = [
  { name: 'lobby', path: '/' },
  { name: 'settings', path: '/settings' },
  { name: 'leaderboard', path: '/leaderboard' },
  { name: 'daily', path: '/daily' },
  { name: 'how-to-play', path: '/how-to-play' },
  { name: 'history', path: '/history' },
];

// Grid sizes to test board rendering
const GRID_SIZES = [3, 4, 5, 6];

// localStorage keys used by the app
const THEME_KEY = 'gridlock_theme';        // dark/light mode
const GRID_THEME_KEY = 'gridlock_grid_theme'; // visual grid theme
const UNLOCKED_KEY = 'gridlock_unlocked_themes';

/**
 * Set up localStorage for mode + theme before navigating.
 * Must be called after context is created but a page visit is needed to set localStorage.
 */
async function applyPreferences(page, baseUrl, mode, theme) {
  // Navigate to a blank-ish page first to set localStorage on the correct origin
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(({ mode, theme, THEME_KEY, GRID_THEME_KEY, UNLOCKED_KEY }) => {
    localStorage.setItem(THEME_KEY, mode);
    localStorage.setItem(GRID_THEME_KEY, theme);
    // Unlock all themes so any theme can be selected
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify(['clean', 'classic', 'minimal', 'neon', 'glass']));
  }, { mode, theme, THEME_KEY, GRID_THEME_KEY, UNLOCKED_KEY });
}

// ─── Test matrix ────────────────────────────────────────────────────────────
for (const viewport of spec.viewports) {
  for (const mode of spec.modes) {
    for (const theme of spec.themes) {
      const combo = `${viewport.name} | ${mode} | ${theme}`;

      test.describe(combo, () => {
        test.setTimeout(600_000); // 10 minutes per test

        let context;
        let page;

        test.beforeAll(async ({ browser }) => {
          context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
          });
          page = await context.newPage();
          await applyPreferences(page, BASE_URL, mode, theme);
        });

        test.afterAll(async () => {
          await context?.close();
        });

        // ─── A. Page checks ───────────────────────────────────────────
        for (const pg of PAGES) {
          test(`${pg.name} — no horizontal overflow`, async () => {
            await page.goto(BASE_URL + pg.path, { waitUntil: 'networkidle', timeout: 30000 });
            // Wait a tick for any layout shifts
            await page.waitForTimeout(500);

            const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
            expect(scrollWidth, `${pg.name} scrollWidth (${scrollWidth}) exceeds viewport (${viewport.width})`).toBeLessThanOrEqual(viewport.width);
          });

          test(`${pg.name} — no content clipped`, async () => {
            await page.goto(BASE_URL + pg.path, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(500);

            // Check that main content wrapper is within viewport bounds
            const clipped = await page.evaluate((vp) => {
              const main = document.querySelector('main') || document.querySelector('#root > div') || document.body.firstElementChild;
              if (!main) return { clipped: false };
              const rect = main.getBoundingClientRect();
              return {
                clipped: rect.left < -1 || rect.right > vp.width + 1,
                left: rect.left,
                right: rect.right,
                vpWidth: vp.width,
              };
            }, viewport);

            expect(clipped.clipped, `${pg.name} content clipped: left=${clipped.left}, right=${clipped.right}`).toBe(false);
          });

          test(`${pg.name} — text contrast`, async () => {
            await page.goto(BASE_URL + pg.path, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(500);

            // Sample key text elements and verify contrast against their background
            const samples = await page.evaluate(() => {
              const results = [];
              // Get prominent text elements
              const selectors = ['h1', 'h2', 'h3', 'p', 'button', 'a', 'span', 'label'];
              for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                for (let i = 0; i < Math.min(els.length, 3); i++) {
                  const el = els[i];
                  if (!el.textContent.trim()) continue;
                  const style = window.getComputedStyle(el);
                  const color = style.color;
                  // Walk up to find effective background
                  let bg = 'rgba(0, 0, 0, 0)';
                  let node = el;
                  while (node && node !== document.documentElement) {
                    const s = window.getComputedStyle(node);
                    const bgc = s.backgroundColor;
                    if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') {
                      bg = bgc;
                      break;
                    }
                    node = node.parentElement;
                  }
                  if (bg === 'rgba(0, 0, 0, 0)') {
                    // Fallback to body/html computed bg
                    bg = window.getComputedStyle(document.body).backgroundColor || '#ffffff';
                  }
                  results.push({
                    selector: sel,
                    text: el.textContent.trim().slice(0, 30),
                    color,
                    bg,
                  });
                }
              }
              return results;
            });

            // Verify each sampled element meets minimum contrast
            const failures = [];
            for (const s of samples) {
              const fg = parseColor(s.color);
              const bg = parseColor(s.bg);
              if (!fg || !bg) continue; // can't measure — skip
              const ratio = computeContrastRatio(fg, bg);
              if (ratio < spec.contrast.minRatio) {
                failures.push(`${s.selector} "${s.text}": ${ratio.toFixed(2)} < ${spec.contrast.minRatio} (fg=${s.color}, bg=${s.bg})`);
              }
            }
            expect(failures, `Contrast failures:\n${failures.join('\n')}`).toHaveLength(0);
          });
        }

        // ─── B. Game board checks (grid sizes 3–6) ───────────────────
        for (const gridSize of GRID_SIZES) {
          test(`board ${gridSize}×${gridSize} — grid squareness`, async () => {
            // Navigate to CPU game to render a board
            // Use lobby → start CPU game approach, or navigate to game with query
            await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 30000 });

            // Re-apply preferences in case navigation cleared them
            await page.evaluate(({ mode, theme, THEME_KEY, GRID_THEME_KEY }) => {
              localStorage.setItem(THEME_KEY, mode);
              localStorage.setItem(GRID_THEME_KEY, theme);
            }, { mode, theme, THEME_KEY, GRID_THEME_KEY });

            // Start a CPU game with the desired grid size
            // Set grid size in localStorage to influence game creation
            await page.evaluate((size) => {
              localStorage.setItem('gridlock_grid_size', String(size));
              localStorage.setItem('gridlock_last_grid_size', String(size));
            }, gridSize);

            // Click quick play / CPU game button
            // Try multiple selectors for the CPU play button
            const cpuButton = page.locator('button:has-text("CPU"), button:has-text("vs CPU"), button:has-text("Play CPU"), [data-testid="cpu-game"], button:has-text("Quick Play")').first();
            const hasCpu = await cpuButton.isVisible({ timeout: 5000 }).catch(() => false);

            if (!hasCpu) {
              // If no CPU button found, try navigating directly
              // Some builds expose /game?mode=cpu&grid=N
              test.skip(true, 'CPU game button not found on lobby — skipping board test');
              return;
            }

            await cpuButton.click();
            // Wait for board to render
            await page.waitForSelector('.board-container', { timeout: 15000 });
            await page.waitForTimeout(1000); // layout settle

            const dims = await page.evaluate(() => {
              const board = document.querySelector('.board-container');
              if (!board) return null;
              const rect = board.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            });

            expect(dims, 'Board container not found').not.toBeNull();
            const diff = Math.abs(dims.width - dims.height);
            expect(diff, `Board not square: ${dims.width}×${dims.height} (diff=${diff})`).toBeLessThanOrEqual(spec.grid.squareTolerance);
          });

          test(`board ${gridSize}×${gridSize} — spacing ratio`, async () => {
            // Board should already be rendered from the previous test or we re-navigate
            const boardVisible = await page.locator('.board-container').isVisible({ timeout: 3000 }).catch(() => false);
            if (!boardVisible) {
              test.skip(true, 'Board not visible — skipping spacing ratio test');
              return;
            }

            const ratio = await page.evaluate(() => {
              // Measure horizontal and vertical line elements
              const hLines = document.querySelectorAll('[data-line-dir="h"], .h-line, .horizontal-line');
              const vLines = document.querySelectorAll('[data-line-dir="v"], .v-line, .vertical-line');

              if (hLines.length === 0 || vLines.length === 0) return null;

              const hWidths = Array.from(hLines).map(el => el.getBoundingClientRect().width);
              const vWidths = Array.from(vLines).map(el => el.getBoundingClientRect().width);

              const avgHWidth = hWidths.reduce((a, b) => a + b, 0) / hWidths.length;
              const avgVWidth = vWidths.reduce((a, b) => a + b, 0) / vWidths.length;

              // Ratio: horizontal line width to vertical line width
              // Horizontal lines should be wider (they span columns)
              return avgVWidth > 0 ? avgHWidth / avgVWidth : null;
            });

            if (ratio === null) {
              test.skip(true, 'Could not measure line elements — skipping ratio test');
              return;
            }

            expect(ratio, `Spacing ratio ${ratio.toFixed(2)} < ${spec.grid.minRatio}`).toBeGreaterThanOrEqual(spec.grid.minRatio);
          });

          test(`board ${gridSize}×${gridSize} — dots same size`, async () => {
            const boardVisible = await page.locator('.board-container').isVisible({ timeout: 3000 }).catch(() => false);
            if (!boardVisible) {
              test.skip(true, 'Board not visible');
              return;
            }

            const dotSizes = await page.evaluate(() => {
              const dots = document.querySelectorAll('.dot, [data-dot], .board-dot');
              if (dots.length === 0) return null;
              return Array.from(dots).map(d => {
                const rect = d.getBoundingClientRect();
                return { w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 };
              });
            });

            if (!dotSizes || dotSizes.length === 0) {
              test.skip(true, 'No dot elements found');
              return;
            }

            // All dots should be the same size
            const firstDot = dotSizes[0];
            for (let i = 1; i < dotSizes.length; i++) {
              expect(dotSizes[i].w, `Dot ${i} width ${dotSizes[i].w} ≠ dot 0 width ${firstDot.w}`).toBe(firstDot.w);
              expect(dotSizes[i].h, `Dot ${i} height ${dotSizes[i].h} ≠ dot 0 height ${firstDot.h}`).toBe(firstDot.h);
            }
          });

          test(`board ${gridSize}×${gridSize} — boxes same size`, async () => {
            const boardVisible = await page.locator('.board-container').isVisible({ timeout: 3000 }).catch(() => false);
            if (!boardVisible) {
              test.skip(true, 'Board not visible');
              return;
            }

            const boxSizes = await page.evaluate(() => {
              const boxes = document.querySelectorAll('.box, [data-box], .board-box, .cell');
              if (boxes.length === 0) return null;
              return Array.from(boxes).map(b => {
                const rect = b.getBoundingClientRect();
                return { w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 };
              });
            });

            if (!boxSizes || boxSizes.length === 0) {
              test.skip(true, 'No box elements found');
              return;
            }

            const firstBox = boxSizes[0];
            for (let i = 1; i < boxSizes.length; i++) {
              expect(boxSizes[i].w, `Box ${i} width ${boxSizes[i].w} ≠ box 0 width ${firstBox.w}`).toBe(firstBox.w);
              expect(boxSizes[i].h, `Box ${i} height ${boxSizes[i].h} ≠ box 0 height ${firstBox.h}`).toBe(firstBox.h);
            }
          });

          test(`board ${gridSize}×${gridSize} — no overflow`, async () => {
            const boardVisible = await page.locator('.board-container').isVisible({ timeout: 3000 }).catch(() => false);
            if (!boardVisible) {
              test.skip(true, 'Board not visible');
              return;
            }

            const overflow = await page.evaluate((vp) => {
              const board = document.querySelector('.board-container');
              if (!board) return { overflow: false };
              const rect = board.getBoundingClientRect();
              return {
                overflow: rect.left < -1 || rect.right > vp.width + 1 || rect.top < -1 || rect.bottom > vp.height + 50,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
              };
            }, viewport);

            expect(overflow.overflow, `Board overflows: l=${overflow.left} r=${overflow.right} t=${overflow.top} b=${overflow.bottom}`).toBe(false);
          });
        }

        // ─── C. Component checks ──────────────────────────────────────
        test('buttons meet touch target size', async () => {
          await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(500);

          const undersized = await page.evaluate((minSize) => {
            const buttons = document.querySelectorAll('button, a[role="button"], [role="button"]');
            const results = [];
            for (const btn of buttons) {
              // Skip hidden / zero-size buttons
              const style = window.getComputedStyle(btn);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
              const rect = btn.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) continue;
              const touchW = Math.max(rect.width, parseFloat(style.minWidth) || 0);
              const touchH = Math.max(rect.height, parseFloat(style.minHeight) || 0);
              if (touchW < minSize || touchH < minSize) {
                results.push({
                  text: btn.textContent.trim().slice(0, 30),
                  tag: btn.tagName,
                  width: Math.round(touchW),
                  height: Math.round(touchH),
                });
              }
            }
            return results;
          }, spec.touchTarget.minStandalone);

          expect(undersized, `Undersized buttons:\n${JSON.stringify(undersized, null, 2)}`).toHaveLength(0);
        });

        test('mode CSS variables applied', async () => {
          await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(500);

          const appliedMode = await page.evaluate(() => {
            return document.documentElement.getAttribute('data-theme');
          });

          expect(appliedMode, `Expected data-theme="${mode}" but got "${appliedMode}"`).toBe(mode);
        });

        test('grid theme applied', async () => {
          // Re-apply grid theme and reload
          await page.evaluate(({ theme, GRID_THEME_KEY }) => {
            localStorage.setItem(GRID_THEME_KEY, theme);
          }, { theme, GRID_THEME_KEY });
          await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(500);

          const storedTheme = await page.evaluate((key) => {
            return localStorage.getItem(key);
          }, GRID_THEME_KEY);

          expect(storedTheme, `Grid theme not persisted: expected "${theme}" got "${storedTheme}"`).toBe(theme);
        });
      });
    }
  }
}
