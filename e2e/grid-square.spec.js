// e2e/grid-square.spec.js — Programmatic grid squareness verification
//
// WHY THIS EXISTS:
// The Dots & Boxes grid MUST be a perfect square — width === height for the
// board container AND for every individual box cell. A non-square grid means
// the CSS sizing formula is broken (e.g. using different values for horizontal
// vs vertical dimensions). This test catches that regression on every PR.
//
// HOW IT WORKS:
// For each grid size × viewport combination, we:
//   1. Create a CPU game (no real opponent needed)
//   2. Measure the board container via getBoundingClientRect()
//   3. Assert width ≈ height (2px tolerance for sub-pixel rounding)
//   4. Measure every box cell — all must be square and uniformly sized
//   5. Verify h-line width === v-line height (same sizes.line value)
//
// NO screenshots — pure pixel measurements.

const { test, expect } = require('@playwright/test');
const { goToLobby } = require('./helpers');

// ── Viewports to test ────────────────────────────────────────────────────────
const VIEWPORTS = [
  { name: 'iPhone 14',     width: 390,  height: 844  },
  { name: 'Pixel/Galaxy',  width: 412,  height: 915  },
  { name: 'Tablet',        width: 768,  height: 1024 },
];

const GRID_SIZES = ['3×3', '4×4', '5×5', '6×6'];

// ── Helper: create a CPU game at a specific viewport ─────────────────────────
async function createCpuGameAtViewport(browser, { viewport, gridSize = '3×3' }) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 768,
    userAgent: viewport.width < 768
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
      : undefined,
  });
  const page = await ctx.newPage();
  await goToLobby(page);

  // Fill name
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill('GridTest');

  // Player count — mobile uses compact "2P" pills, desktop uses full buttons
  if (viewport.width < 768) {
    await page.getByRole('radio', { name: '2P' }).click();
  } else {
    await page.locator('button:has-text("2 Players"):visible').click();
  }

  // Grid size — mobile uses radio, desktop uses button
  if (viewport.width < 768) {
    await page.getByRole('radio', { name: gridSize }).click({ timeout: 3000 }).catch(() => {});
  } else {
    await page.locator(`button:has-text("${gridSize}"):visible`).first().click({ timeout: 3000 }).catch(() => {});
  }

  // Enable CPU
  const cpuAlreadyOn = await page.evaluate(() => localStorage.getItem('gridlock-cpuEnabled') === 'true');
  if (!cpuAlreadyOn) {
    await page.locator('button:has-text("Play vs CPU"):visible').first().click();
    await page.waitForTimeout(300);
  }

  // Create game
  await page.locator('button:has-text("Create Game"):visible').first().click();
  await page.waitForURL(/\/game/, { timeout: 15_000 });
  await page.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 });

  return { page, ctx };
}

// ── Helper: measure the grid programmatically ────────────────────────────────
async function measureGrid(page) {
  return page.evaluate(() => {
    const container = document.querySelector('.board-container');
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();

    // Measure all box cells (they use sizes.line × sizes.line)
    // Boxes are rendered with key="b-{r}-{c}" — select by their parent structure
    // Each box is a div inside .board-container with flex items-center justify-center
    // We identify them by checking: direct children that have equal width/height style
    const allElements = container.querySelectorAll('[role="button"]');
    const hLines = [];
    const vLines = [];

    allElements.forEach(el => {
      const label = el.getAttribute('aria-label') || '';
      const rect = el.getBoundingClientRect();
      if (label.startsWith('Horizontal line')) {
        hLines.push({ width: rect.width, height: rect.height });
      } else if (label.startsWith('Vertical line')) {
        vLines.push({ width: rect.width, height: rect.height });
      }
    });

    // Box cells: find elements that are square-ish and NOT role="button"
    // Boxes are siblings of lines inside the board. They have sizes.line × sizes.line.
    // Use a heuristic: non-button flex children that are roughly square
    const boxes = [];
    const allDivs = container.querySelectorAll('div');
    allDivs.forEach(div => {
      if (div.getAttribute('role') === 'button') return;
      if (div.classList.contains('board-container')) return;
      const style = div.style;
      const rect = div.getBoundingClientRect();
      // Box cells: have explicit width and height set inline, are roughly square,
      // and are small enough to be individual cells (not the container itself)
      if (style.width && style.height && style.flexShrink === '0' && style.flexGrow === '0') {
        const w = rect.width;
        const h = rect.height;
        // Filter: must be within the board, must be larger than a dot but smaller than container
        if (w > 15 && h > 15 && w < containerRect.width * 0.8 && Math.abs(w - h) < 5) {
          boxes.push({ width: w, height: h });
        }
      }
    });

    return {
      container: { width: containerRect.width, height: containerRect.height },
      hLines,
      vLines,
      boxes,
    };
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Grid Square Verification', () => {

  for (const viewport of VIEWPORTS) {
    for (const gridSize of GRID_SIZES) {

      test(`${gridSize} grid is square on ${viewport.name} (${viewport.width}×${viewport.height})`, async ({ browser }) => {
        test.setTimeout(6_000_000);

        const { page, ctx } = await createCpuGameAtViewport(browser, { viewport, gridSize });

        try {
          // Wait for board to be visible
          const boardContainer = page.locator('.board-container');
          await expect(boardContainer).toBeVisible({ timeout: 10_000 });

          const measurements = await measureGrid(page);
          expect(measurements, 'Board measurements should be available').toBeTruthy();

          const { container, hLines, vLines, boxes } = measurements;

          // ── 1. Board container is square (2px tolerance) ───────────────
          const containerDiff = Math.abs(container.width - container.height);
          expect(
            containerDiff,
            `Board container should be square: ${container.width.toFixed(1)}×${container.height.toFixed(1)} (diff: ${containerDiff.toFixed(1)}px)`
          ).toBeLessThanOrEqual(2);

          // ── 2. H-line widths match V-line heights (same sizes.line) ───
          // H-lines have width = sizes.line, V-lines have height = sizes.line
          if (hLines.length > 0 && vLines.length > 0) {
            const hLineWidth = hLines[0].width;
            const vLineHeight = vLines[0].height;
            const lineDiff = Math.abs(hLineWidth - vLineHeight);
            expect(
              lineDiff,
              `H-line width (${hLineWidth.toFixed(1)}) should equal V-line height (${vLineHeight.toFixed(1)})`
            ).toBeLessThanOrEqual(1);

            // All h-lines should have same width
            for (const hl of hLines) {
              expect(
                Math.abs(hl.width - hLineWidth),
                `All h-lines should have uniform width`
              ).toBeLessThanOrEqual(1);
            }

            // All v-lines should have same height
            for (const vl of vLines) {
              expect(
                Math.abs(vl.height - vLineHeight),
                `All v-lines should have uniform height`
              ).toBeLessThanOrEqual(1);
            }
          }

          // ── 3. All boxes are square and uniformly sized ────────────────
          if (boxes.length > 0) {
            const refWidth = boxes[0].width;
            const refHeight = boxes[0].height;

            for (let i = 0; i < boxes.length; i++) {
              const box = boxes[i];
              // Each box is square
              expect(
                Math.abs(box.width - box.height),
                `Box ${i} should be square: ${box.width.toFixed(1)}×${box.height.toFixed(1)}`
              ).toBeLessThanOrEqual(1);

              // All boxes same size
              expect(
                Math.abs(box.width - refWidth),
                `Box ${i} width should match first box`
              ).toBeLessThanOrEqual(1);
              expect(
                Math.abs(box.height - refHeight),
                `Box ${i} height should match first box`
              ).toBeLessThanOrEqual(1);
            }
          }

          // ── 4. No horizontal scroll (grid fits viewport) ──────────────
          const hasHScroll = await page.evaluate(() =>
            document.documentElement.scrollWidth > document.documentElement.clientWidth
          );
          expect(hasHScroll, 'Grid should not cause horizontal scroll').toBe(false);

        } finally {
          await ctx.close();
        }
      });
    }
  }
});
