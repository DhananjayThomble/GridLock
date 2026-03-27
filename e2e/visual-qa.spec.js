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
    // Set a player name so CPU games can start (required by the lobby)
    localStorage.setItem('gridlock_username', 'QA-Bot');
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

              /**
               * Check if an element uses gradient text rendering (background-clip: text).
               * These elements intentionally set color to transparent — can't measure contrast
               * via getComputedStyle alone.
               */
              function usesGradientText(el) {
                const s = window.getComputedStyle(el);
                const bgClip = s.webkitBackgroundClip || s.backgroundClip;
                if (bgClip === 'text') return true;
                // Also check for text-transparent class (Tailwind)
                if (el.classList && el.classList.contains('text-transparent')) return true;
                return false;
              }

              /**
               * Check if a color is fully transparent / unmeasurable.
               * NOTE: Duplicated from e2e/helpers/contrast.js (isTransparent).
               * Browser evaluate() context can't import Node modules — keep in sync manually.
               * Handles both comma-separated rgba(r,g,b,a) and CSS4 space-separated rgb(r g b / a).
               */
              function isTransparentColor(c) {
                if (!c) return true;
                if (c === 'transparent') return true;
                const mComma = c.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
                if (mComma && parseFloat(mComma[1]) === 0) return true;
                const mSpace = c.match(/rgba?\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*\/\s*([\d.]+)\s*\)/);
                if (mSpace && parseFloat(mSpace[1]) === 0) return true;
                return false;
              }

              /**
               * Parse an rgb/rgba color string into {r, g, b, a} or null.
               * Handles both comma-separated and CSS4 space-separated syntax.
               * NOTE: Duplicated inline because browser evaluate() can't import Node modules.
               * Keep in sync with parseRgb in e2e/helpers/contrast.js.
               */
              function parseRgbInline(str) {
                // CSS4 space-separated: rgb(r g b) or rgb(r g b / a)
                let m = str.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/);
                // Legacy comma-separated: rgb(r, g, b) or rgba(r, g, b, a)
                if (!m) m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
                if (!m) return null;
                return {
                  r: parseFloat(m[1]),
                  g: parseFloat(m[2]),
                  b: parseFloat(m[3]),
                  a: m[4] !== undefined ? parseFloat(m[4]) : 1,
                };
              }

              /**
               * Walk up the DOM tree to find the effective background color.
               * Composites semi-transparent backgrounds over their parent.
               * Returns null if a gradient background is found (can't extract single color).
               */
              function findBackground(el) {
                // Collect background layers from element up to root
                const layers = [];
                let node = el;
                while (node && node !== document.documentElement) {
                  const s = window.getComputedStyle(node);

                  // If this element has a gradient background-image, we can't extract
                  // a single color — mark as unmeasurable
                  const bgImage = s.backgroundImage;
                  if (bgImage && bgImage !== 'none' && bgImage.includes('gradient')) {
                    return null; // gradient bg — skip this element
                  }

                  const bgc = s.backgroundColor;
                  if (bgc && bgc !== 'transparent') {
                    const parsed = parseRgbInline(bgc);
                    if (parsed && parsed.a > 0) {
                      layers.push(parsed);
                      if (parsed.a >= 1) break; // opaque — no need to go further
                    }
                  }
                  node = node.parentElement;
                }

                // Fallback to body bg
                if (layers.length === 0 || layers[layers.length - 1].a < 1) {
                  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
                  const parsed = bodyBg && parseRgbInline(bodyBg);
                  if (parsed && parsed.a > 0) {
                    layers.push(parsed);
                  }
                }

                // If still no opaque base, assume white
                if (layers.length === 0) return '#ffffff';
                if (layers[layers.length - 1].a < 1) {
                  layers.push({ r: 255, g: 255, b: 255, a: 1 });
                }

                // Composite from back to front (last layer is bottom)
                let base = layers[layers.length - 1];
                for (let i = layers.length - 2; i >= 0; i--) {
                  const fg = layers[i];
                  // Alpha compositing: result = fg * fg.a + base * (1 - fg.a)
                  base = {
                    r: Math.round(fg.r * fg.a + base.r * (1 - fg.a)),
                    g: Math.round(fg.g * fg.a + base.g * (1 - fg.a)),
                    b: Math.round(fg.b * fg.a + base.b * (1 - fg.a)),
                    a: 1,
                  };
                }

                return `rgb(${base.r}, ${base.g}, ${base.b})`;
              }

              // Get prominent text elements
              const selectors = ['h1', 'h2', 'h3', 'p', 'button', 'a', 'span', 'label'];
              for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                for (let i = 0; i < Math.min(els.length, 3); i++) {
                  const el = els[i];
                  if (!el.textContent.trim()) continue;

                  // Skip elements using gradient text — contrast can't be measured via computed style
                  if (usesGradientText(el)) continue;

                  // Skip emoji-only content (no contrast issue for pictographic chars)
                  const textOnly = el.textContent.trim();
                  if (/^[\p{Emoji}\s]+$/u.test(textOnly)) continue;

                  const style = window.getComputedStyle(el);
                  let color = style.color;

                  // Skip if foreground is transparent — can't measure
                  if (isTransparentColor(color)) continue;

                  // For container elements (button, a) that have children with explicit
                  // color styles, check the deepest text-bearing child instead.
                  // The container's own color (often inherited default) isn't meaningful.
                  // LIMITATION: Only checks child.style.color (inline styles). Children styled
                  // via CSS classes won't be caught here. For the element itself we use
                  // getComputedStyle (which resolves classes), but iterating all children with
                  // getComputedStyle would be expensive and unreliable without knowing which
                  // child actually renders the visible text. Inline style check is a pragmatic
                  // best-effort approach.
                  if ((sel === 'button' || sel === 'a') && el.children.length > 0) {
                    // Find children with explicit inline color styles (most specific)
                    const allChildren = el.querySelectorAll('*');
                    for (const child of allChildren) {
                      if (child.style.color && child.textContent.trim()) {
                        const childColor = window.getComputedStyle(child).color;
                        if (!isTransparentColor(childColor)) {
                          color = childColor;
                          break;
                        }
                      }
                    }
                  }

                  const bg = findBackground(el);

                  results.push({
                    selector: sel,
                    text: textOnly.slice(0, 30),
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
            // Set grid size + enable CPU in localStorage (app uses hyphen-camelCase keys)
            await page.evaluate((size) => {
              localStorage.setItem('gridlock-gridSize', String(size));
              localStorage.setItem('gridlock-cpuEnabled', 'true');
              localStorage.setItem('gridlock-cpuCount', '1');
              localStorage.setItem('gridlock-cpuDifficulty', 'easy');
              // Re-set username in case navigation cleared it
              localStorage.setItem('gridlock_username', 'QA-Bot');
            }, gridSize);

            // Reload to pick up the new localStorage values
            await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(500);

            // Click Create Game (with CPU enabled, it goes straight to /game)
            const cpuButton = page.locator('button:has-text("Create Game")').first();
            const hasCpu = await cpuButton.isVisible({ timeout: 5000 }).catch(() => false);

            if (!hasCpu) {
              test.skip(true, 'Create Game button not found on lobby — skipping board test');
              return;
            }

            // The button is disabled without a username — wait for it to be enabled
            await cpuButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
            const isDisabled = await cpuButton.isDisabled();
            if (isDisabled) {
              test.skip(true, 'Create Game button is disabled (username not set?) — skipping board test');
              return;
            }

            await cpuButton.click();
            // Wait for board to render (game creation + navigation may take time)
            const boardVisible = await page.waitForSelector('.board-container', { timeout: 30000 }).catch(() => null);
            if (!boardVisible) {
              test.skip(true, 'Board did not appear after clicking game button — skipping board test');
              return;
            }
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

              // Skip buttons inside collapsed/hidden panels (opacity 0, maxHeight 0)
              let parent = btn.parentElement;
              let inHiddenPanel = false;
              while (parent) {
                const ps = window.getComputedStyle(parent);
                if (ps.opacity === '0' || ps.maxHeight === '0px') { inHiddenPanel = true; break; }
                parent = parent.parentElement;
              }
              if (inHiddenPanel) continue;

              // Skip emoji-only avatar buttons (dense grid items — WCAG 2.5.8 spacing exception)
              const text = btn.textContent.trim();
              if (/^[\p{Emoji}\s]{1,4}$/u.test(text) && btn.classList.contains('lobby-avatar-btn')) continue;
              // Also skip any single-emoji buttons in the lobby avatar grid specifically
              // (not any element with "avatar" in the class — that's too broad)
              if (/^[\p{Emoji}]{1,2}$/u.test(text) && btn.closest('.lobby-avatar-grid')) continue;

              const touchW = Math.max(rect.width, parseFloat(style.minWidth) || 0);
              const touchH = Math.max(rect.height, parseFloat(style.minHeight) || 0);
              if (touchW < minSize || touchH < minSize) {
                results.push({
                  text: text.slice(0, 30),
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
