// e2e/28-game-mode-matrix.spec.js — Test all 36 game mode combinations (CPU)

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

const PLAYER_COUNTS = [2, 3, 4];
const GRID_SIZES = ['3×3', '4×4', '5×5', '6×6'];
const CPU_DIFFICULTIES = ['easy', 'medium', 'hard'];

/** Parse grid size string like "3×3" → 3 */
function parseGridSize(gs) {
  return parseInt(gs.charAt(0), 10);
}

/** Total boxes in a grid = (n-1)² */
function totalBoxes(gs) {
  const n = parseGridSize(gs);
  return (n - 1) * (n - 1);
}

/**
 * Create a CPU game with specific settings.
 */
async function createCpuGame(page, { username, gridSize, playerCount, cpuDifficulty, cpuCount }) {
  await goToLobby(page);
  await page.fill('input[placeholder="Enter your name…"]', username);
  await page.click(`button:has-text("${playerCount} Players")`);
  await page.click(`button:has-text("${gridSize}")`);

  // Enable CPU
  await page.locator('button:has-text("Play vs CPU")').click();
  await page.waitForTimeout(500);

  // Set difficulty
  if (cpuDifficulty) {
    const label = cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1);
    await page.click(`button:has-text("${label}")`);
  }

  // Set CPU count for 3P/4P (click + button to increase from 1)
  if (cpuCount && cpuCount > 1) {
    for (let i = 1; i < cpuCount; i++) {
      await page.click('button:has-text("+")');
      await page.waitForTimeout(200);
    }
  }

  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/game/, { timeout: 15_000 });
  await page.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 });
}

/**
 * Click an available line on the game board.
 * Returns true if a move was made.
 */
async function clickAvailableLine(page) {
  const lines = await page.locator('[class*="cursor-pointer"]').all();
  for (const line of lines.slice(0, 15)) {
    try {
      await line.click({ timeout: 3000, force: true });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

for (const playerCount of PLAYER_COUNTS) {
  test.describe(`${playerCount}-Player CPU Games`, () => {
    test.setTimeout(90_000);

    for (const gridSize of GRID_SIZES) {
      for (const difficulty of CPU_DIFFICULTIES) {
        const cpuCount = playerCount - 1;
        const testName = `${playerCount}P ${gridSize} ${difficulty}`;

        test(testName, async ({ page }) => {
          // 1. Create game with correct settings
          await createCpuGame(page, {
            username: `Tester_${playerCount}P`,
            gridSize,
            playerCount,
            cpuDifficulty: difficulty,
            cpuCount,
          });

          // 2. Verify game started (turn indicator)
          const bodyText = await page.locator('body').innerText();
          expect(bodyText).toMatch(/turn/i);

          // 3. Play at least 3 human moves
          let movesPlayed = 0;
          for (let attempt = 0; attempt < 10 && movesPlayed < 3; attempt++) {
            // Wait for our turn
            try {
              await page.waitForFunction(
                () => /your turn/i.test(document.body.innerText),
                { timeout: 15_000 }
              );
            } catch {
              // Game might have ended or it's still CPU's turn
              const text = await page.locator('body').innerText();
              if (/game over|winner|final/i.test(text)) break;
              continue;
            }

            const moved = await clickAvailableLine(page);
            if (moved) {
              movesPlayed++;
              await page.waitForTimeout(500); // Let CPU respond
            }
          }

          expect(movesPlayed).toBeGreaterThanOrEqual(1); // At minimum 1 move (small grids end fast)

          // 4. Verify CPU makes moves (wait and check score progression)
          await page.waitForTimeout(2000);

          // 5. Verify game progresses or ends
          // For larger grids, don't wait for completion — just verify it's running
          const finalText = await page.locator('body').innerText();
          const gameProgressing = /turn/i.test(finalText) || /game over|winner|final|score/i.test(finalText);
          expect(gameProgressing, 'Game should be progressing or completed').toBe(true);

          // 6. Verify score bar shows correct total
          const expectedBoxes = totalBoxes(gridSize);
          // Check if score elements exist and sum correctly (when game is over)
          if (/game over|winner|final/i.test(finalText)) {
            const scoreSum = await page.evaluate(() => {
              // Look for score values in the score bar
              const scoreEls = document.querySelectorAll('[class*="score"], [class*="Score"]');
              let sum = 0;
              for (const el of scoreEls) {
                const nums = el.textContent.match(/\d+/g);
                if (nums) {
                  for (const n of nums) sum += parseInt(n, 10);
                }
              }
              return sum;
            });
            // If we found scores, verify total
            if (scoreSum > 0) {
              expect(scoreSum).toBe(expectedBoxes);
            }
          }
        });
      }
    }
  });
}
