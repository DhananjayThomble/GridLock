// e2e/25-post-game-stats.spec.js — Post-Game Stats Card tests

const { test, expect } = require('@playwright/test');
const { goToLobby } = require('./helpers');

/**
 * Create a CPU game on a small grid and play to completion.
 */
async function playCpuGameToCompletion(page, { username = 'StatsPlayer' } = {}) {
  await goToLobby(page);
  await page.fill('input[placeholder="Enter your name…"]', username);
  await page.click('button:has-text("2 Players")');

  // Enable CPU toggle
  const cpuToggle = page.locator('button:has-text("Play vs CPU")');
  await cpuToggle.click();
  await page.waitForTimeout(500);

  // Create game
  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/game/, { timeout: 30_000 });

  // Wait for game to start
  await page.waitForFunction(
    () => /turn/i.test(document.body.innerText),
    { timeout: 20_000 }
  );

  // Play moves until game over — use aria-disabled="false" to target clickable lines
  for (let i = 0; i < 80; i++) {
    const body = await page.locator('body').innerText();
    if (body.includes('Game Over') || body.includes('Play Again') || body.includes('Wins!') || body.includes('Draw')) {
      break;
    }

    if (body.includes('Your turn')) {
      // Click the first available (non-taken) line button
      const availableLines = page.locator('[role="button"][aria-disabled="false"]');
      const count = await availableLines.count();
      if (count > 0) {
        try {
          await availableLines.first().click({ timeout: 2000 });
        } catch { /* move on */ }
      }
    }
    await page.waitForTimeout(800);
  }

  // Wait for game-over modal with stats
  await page.waitForSelector('[data-testid="post-game-stats"]', { timeout: 30_000 });
}

test.describe('Post-Game Stats Card', () => {

  test('stats card appears with all expected data after CPU game', async ({ page }) => {
    test.setTimeout(120_000);
    await playCpuGameToCompletion(page);

    // 1. Stats card visible
    const statsCard = page.locator('[data-testid="post-game-stats"]');
    await expect(statsCard).toBeVisible();
    await expect(statsCard).toContainText('Game Stats');

    // 2. Territory percentages add up to ~100%
    const p1Pct = await page.locator('[data-testid="territory-pct-player1"]').innerText();
    const p2Pct = await page.locator('[data-testid="territory-pct-player2"]').innerText();
    const p1Val = parseInt(p1Pct.replace('%', ''), 10);
    const p2Val = parseInt(p2Pct.replace('%', ''), 10);
    expect(p1Val).toBeGreaterThanOrEqual(0);
    expect(p2Val).toBeGreaterThanOrEqual(0);
    const total = p1Val + p2Val;
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);

    // 3. Move counts are non-zero
    const p1Moves = await page.locator('[data-testid="move-count-player1"]').innerText();
    const p2Moves = await page.locator('[data-testid="move-count-player2"]').innerText();
    expect(parseInt(p1Moves, 10)).toBeGreaterThan(0);
    expect(parseInt(p2Moves, 10)).toBeGreaterThan(0);

    // 4. Duration is shown
    const duration = page.locator('[data-testid="game-duration"]');
    await expect(duration).toBeVisible();
    const durationText = await duration.innerText();
    expect(durationText).toMatch(/\d+[sm]/);

    // 5. Profile link for human player only (CPU should not have one)
    const profileLink = page.locator('[data-testid="profile-link-player1"]');
    await expect(profileLink).toBeVisible();
    const href = await profileLink.getAttribute('href');
    expect(href).toContain('/profile/');

    // 6. CPU player should NOT have a profile link
    const cpuProfileLink = page.locator('[data-testid="profile-link-player2"]');
    await expect(cpuProfileLink).toHaveCount(0);
  });

  test('ELO section is hidden for CPU games (no ELO row shown)', async ({ page }) => {
    test.setTimeout(120_000);
    await playCpuGameToCompletion(page);

    const statsCard = page.locator('[data-testid="post-game-stats"]');
    await expect(statsCard).toBeVisible();

    // In a vs CPU game, the ELO change row should not appear (bothHuman = false)
    const eloChange = page.locator('[data-testid="elo-change"]');
    await expect(eloChange).toHaveCount(0);
  });

});
