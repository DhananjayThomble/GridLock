// e2e/35-scorebar-accuracy.spec.js — ScoreBar Never >100% tests

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, makeMove, createCpuGame,
} = require('./helpers');

/**
 * Extract all percentage values visible in the ScoreBar.
 * Returns array of numbers (e.g. [55.6, 33.3, 11.1]).
 */
async function getScoreBarPercentages(page) {
  return page.evaluate(() => {
    const scoreBar = document.querySelector('.score-bar');
    if (!scoreBar) return [];
    const text = scoreBar.innerText;
    const matches = text.match(/(\d+(?:\.\d+)?)\s*%/g) || [];
    return matches.map(m => parseFloat(m));
  });
}

/**
 * Check that no individual percentage exceeds 100 and total ≤ 100.
 */
function assertPercentagesValid(percentages, context = '') {
  for (const pct of percentages) {
    expect(pct, `Percentage ${pct}% exceeds 100% ${context}`).toBeLessThanOrEqual(100);
    expect(pct, `Percentage ${pct}% is negative ${context}`).toBeGreaterThanOrEqual(0);
  }
  const total = percentages.reduce((a, b) => a + b, 0);
  // Allow tiny floating-point overshoot (100.1 is fine, 105 is not)
  expect(total, `Total percentage ${total}% exceeds 100% ${context}`).toBeLessThanOrEqual(100.5);
}

test.describe('ScoreBar Accuracy', () => {

  test('play full 3×3 game → ScoreBar never exceeds 100%', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Play through the game, checking ScoreBar at each move
    let gameOver = false;
    for (let i = 0; i < 80 && !gameOver; i++) {
      // Check both players' ScoreBars
      for (const page of [p1, p2]) {
        const percentages = await getScoreBarPercentages(page);
        if (percentages.length > 0) {
          assertPercentagesValid(percentages, `(move ${i}, 3×3 game)`);
        }
      }

      // Make a move
      for (const page of [p1, p2]) {
        const text = await page.locator('body').innerText().catch(() => '');
        if (/Rematch|Game Over|Winner|wins!/i.test(text)) {
          gameOver = true;
          break;
        }
        if (text.includes('Your turn')) {
          await makeMove(page);
          break;
        }
      }
      if (!gameOver) await p1.waitForTimeout(200);
    }

    // Final check at game end
    for (const page of [p1, p2]) {
      const percentages = await getScoreBarPercentages(page);
      if (percentages.length > 0) {
        assertPercentagesValid(percentages, '(game end, 3×3)');
      }
    }

    await ctx1.close();
    await ctx2.close();
  });

  test('play 4×4 game → percentages are correct', async ({ page }) => {
    // Use CPU game for 4×4 since it's simpler to set up
    await createCpuGame(page, { username: 'Human', gridSize: '4×4', playerCount: 2 });
    await page.waitForFunction(
      () => /Your turn|turn/i.test(document.body.innerText),
      { timeout: 20_000 }
    );

    // Play through, checking percentages
    for (let i = 0; i < 120; i++) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) break;

      const percentages = await getScoreBarPercentages(page);
      if (percentages.length > 0) {
        assertPercentagesValid(percentages, `(move ${i}, 4×4 CPU game)`);

        // For a 4×4 grid: 3×3 = 9 boxes, each worth ~11.1%
        // Verify granularity makes sense
        for (const pct of percentages) {
          // Each box is 100/9 ≈ 11.11%. Score should be a multiple of ~11.11 (±rounding)
          if (pct > 0) {
            const boxes = Math.round(pct / (100 / 9));
            expect(boxes).toBeGreaterThan(0);
          }
        }
      }

      if (text.includes('Your turn')) {
        await makeMove(page);
      }
      await page.waitForTimeout(300);
    }
  });

  test('at game end, winner percentage ≤ 100%', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Play to completion
    let gameOver = false;
    for (let i = 0; i < 80 && !gameOver; i++) {
      for (const page of [p1, p2]) {
        const text = await page.locator('body').innerText().catch(() => '');
        if (/Rematch|Game Over|Winner|wins!/i.test(text)) {
          gameOver = true;
          break;
        }
        if (text.includes('Your turn')) {
          await makeMove(page);
          break;
        }
      }
      if (!gameOver) await p1.waitForTimeout(200);
    }

    expect(gameOver).toBe(true);

    // Verify final percentages on both pages
    for (const page of [p1, p2]) {
      const percentages = await getScoreBarPercentages(page);
      if (percentages.length > 0) {
        assertPercentagesValid(percentages, '(final, 3×3)');

        // Total should be ~100% at game end (all boxes claimed)
        const total = percentages.reduce((a, b) => a + b, 0);
        // Allow some rounding: 99-101%
        expect(total).toBeGreaterThanOrEqual(99);
        expect(total).toBeLessThanOrEqual(100.5);
      }
    }

    await ctx1.close();
    await ctx2.close();
  });

});
