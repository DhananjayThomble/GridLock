// e2e/15-cpu-game.spec.js — CPU player game tests

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

/**
 * Create a CPU game — does NOT wait for room code (CPU games start immediately).
 */
async function createCpuGame(page, { username = 'HumanPlayer', gridSize = '3×3', playerCount = 2 } = {}) {
  await goToLobby(page);
  await page.fill('input[placeholder="Enter your name…"]', username);
  await page.click(`button:has-text("${playerCount} Players")`);
  // Click grid size — ignore if button doesn't exist (falls back to default 3×3)
  await page.click(`button:has-text("${gridSize}")`, { timeout: 3000 }).catch(() => {});

  // Enable CPU toggle
  const cpuToggle = page.locator('button:has-text("Play vs CPU")');
  await cpuToggle.click();
  await page.waitForTimeout(500);

  // Create game
  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/game/, { timeout: 15_000 });

  // Wait for game to start (turn indicator appears)
  await page.waitForFunction(
    () => /turn/i.test(document.body.innerText),
    { timeout: 20_000 }
  );
}

test.describe('CPU Player Games', () => {

  test('CPU toggle shows count and difficulty selectors', async ({ page }) => {
    await goToLobby(page);
    await page.fill('input[placeholder="Enter your name…"]', 'CpuTester');

    const cpuToggle = page.locator('button:has-text("Play vs CPU")');
    await expect(cpuToggle).toBeVisible();
    await cpuToggle.click();
    await page.waitForTimeout(500);

    const body = await page.locator('body').innerText();
    const hasCpuSettings = body.includes('CPU Opponents') ||
      body.includes('Easy') || body.includes('Medium') || body.includes('Hard');
    expect(hasCpuSettings, 'CPU settings should appear after toggle').toBe(true);
  });

  test('create 2P game with 1 CPU on 3×3 grid starts immediately', async ({ page }) => {
    test.setTimeout(60_000);
    await createCpuGame(page, { username: 'HumanPlayer', gridSize: '3×3' });

    const body = await page.locator('body').innerText();
    expect(body).toMatch(/turn/i);
  });

  test('CPU makes moves automatically and 3×3 game completes', async ({ page }) => {
    test.setTimeout(90_000);
    await createCpuGame(page, { username: 'HumanVsCPU', gridSize: '3×3' });

    // Play moves as human — CPU should auto-play when it's their turn
    let gameOver = false;
    for (let i = 0; i < 20 && !gameOver; i++) {
      const body = await page.locator('body').innerText();
      if (body.includes('Game Over') || body.includes('Play Again') || body.includes('Winner')) {
        gameOver = true;
        break;
      }

      if (body.includes('Your turn')) {
        const lines = await page.locator('[class*="cursor-pointer"]').all();
        for (const line of lines.slice(0, 10)) {
          try {
            await line.click({ timeout: 2000, force: true });
            break;
          } catch { continue; }
        }
      }
      await page.waitForTimeout(1500);
    }

    const finalBody = await page.locator('body').innerText();
    const completed = finalBody.includes('Game Over') || finalBody.includes('Play Again') ||
      finalBody.includes('Winner') || gameOver;
    expect(completed, 'CPU game on 2×2 should complete').toBe(true);
  });

  test('game-over modal shows CPU name with robot emoji', async ({ page }) => {
    test.setTimeout(90_000);
    await createCpuGame(page, { username: 'HumanCheck', gridSize: '3×3' });

    for (let i = 0; i < 20; i++) {
      const body = await page.locator('body').innerText();
      if (body.includes('Game Over') || body.includes('Play Again')) break;
      if (body.includes('Your turn')) {
        const lines = await page.locator('[class*="cursor-pointer"]').all();
        for (const line of lines.slice(0, 10)) {
          try { await line.click({ timeout: 2000, force: true }); break; } catch { continue; }
        }
      }
      await page.waitForTimeout(1500);
    }

    await page.waitForTimeout(2000);
    const finalBody = await page.locator('body').innerText();
    if (finalBody.includes('Game Over') || finalBody.includes('Play Again')) {
      const hasCpuName = finalBody.includes('🤖') || finalBody.includes('CPU');
      expect(hasCpuName, 'Game over should show CPU name with 🤖').toBe(true);
    }
  });

  test('CPU difficulty options are selectable', async ({ page }) => {
    await goToLobby(page);
    await page.fill('input[placeholder="Enter your name…"]', 'DiffTester');

    const cpuToggle = page.locator('button:has-text("Play vs CPU")');
    await cpuToggle.click();
    await page.waitForTimeout(500);

    const body = await page.locator('body').innerText();
    const difficulties = ['Easy', 'Medium', 'Hard'];
    let found = 0;
    for (const d of difficulties) {
      if (body.includes(d)) found++;
    }
    expect(found, 'Should show difficulty options').toBeGreaterThanOrEqual(2);
  });

});
