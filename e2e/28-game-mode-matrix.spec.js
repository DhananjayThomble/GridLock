// e2e/28-game-mode-matrix.spec.js — Test all 36 game mode combinations (CPU)

const { test, expect } = require('@playwright/test');
const { createCpuGame, makeMove } = require('./helpers');

const PLAYER_COUNTS = [2, 3, 4];
const GRID_SIZES = ['3×3', '4×4', '5×5', '6×6'];
const CPU_DIFFICULTIES = ['easy', 'medium', 'hard'];

function parseGridSize(gs) { return parseInt(gs.charAt(0), 10); }
function totalBoxes(gs) { const n = parseGridSize(gs); return (n - 1) * (n - 1); }

function getTimeout(gridSize) {
  switch (parseGridSize(gridSize)) {
    case 3: return 60_000;
    case 4: return 90_000;
    case 5: return 120_000;
    case 6: return 180_000;
    default: return 90_000;
  }
}

for (const playerCount of PLAYER_COUNTS) {
  test.describe(`${playerCount}-Player CPU Games`, () => {
    for (const gridSize of GRID_SIZES) {
      for (const difficulty of CPU_DIFFICULTIES) {
        const cpuCount = playerCount - 1;

        test(`${playerCount}P ${gridSize} ${difficulty}`, async ({ page }) => {
          test.setTimeout(getTimeout(gridSize));

          await createCpuGame(page, {
            username: `Tester_${playerCount}P`,
            gridSize, playerCount,
            cpuDifficulty: difficulty,
            cpuCount,
          });

          const bodyText = await page.locator('body').innerText();
          expect(bodyText).toMatch(/turn/i);

          let movesPlayed = 0;
          for (let attempt = 0; attempt < 10 && movesPlayed < 3; attempt++) {
            try {
              await page.waitForFunction(() => /your turn/i.test(document.body.innerText), { timeout: 15_000 });
            } catch {
              const text = await page.locator('body').innerText();
              if (/game over|winner|final/i.test(text)) break;
              continue;
            }
            if (await makeMove(page)) {
              movesPlayed++;
              await page.waitForFunction(() => !/your turn/i.test(document.body.innerText), { timeout: 10_000 }).catch(() => {});
            }
          }
          expect(movesPlayed).toBeGreaterThanOrEqual(1);

          await page.waitForFunction(
            () => /your turn|game over|winner|final/i.test(document.body.innerText),
            { timeout: 15_000 }
          ).catch(() => {});

          const finalText = await page.locator('body').innerText();
          expect(/turn|game over|winner|final|score/i.test(finalText), 'Game should progress or complete').toBe(true);

          if (/game over|winner|final/i.test(finalText)) {
            const scoreSum = await page.evaluate(() => {
              // TODO: add data-testid="score-bar" to the ScoreBar component
              const bar = document.querySelector('[data-testid="score-bar"]') || document.querySelector('.score-bar');
              if (!bar) return 0;
              let sum = 0;
              for (const el of bar.querySelectorAll('span')) {
                const m = el.textContent.match(/^(\d+)%$/);
                if (m) sum += parseInt(m[1], 10);
              }
              return sum;
            });
            if (scoreSum > 0) {
              expect(scoreSum).toBeGreaterThanOrEqual(95);
              expect(scoreSum).toBeLessThanOrEqual(105);
            }
          }
        });
      }
    }
  });
}
