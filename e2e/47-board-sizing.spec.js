// e2e/47-board-sizing.spec.js — Board fills viewport on mobile (#365)

const { test, expect } = require('@playwright/test');
const { goToLobby } = require('./helpers');

/**
 * Create a CPU game at mobile viewport.
 * At mobile widths the lobby uses compact pill buttons: "2P", "3P", "4P"
 * and radio-style grid buttons: "3×3", "4×4", etc.
 */
async function createCpuGameMobile(page, { username = 'MobileUser', gridSize = '3×3', playerCount = 2 } = {}) {
  await goToLobby(page);

  // Fill the name input (mobile has only one visible input)
  const nameInput = page.locator('input[placeholder="Enter your name…"]:visible').first();
  await nameInput.fill(username);

  // Mobile uses compact pill buttons: "2P" / "3P" / "4P"
  await page.getByRole('radio', { name: `${playerCount}P` }).click();

  // Grid size — use the radio button
  await page.getByRole('radio', { name: gridSize }).click({ timeout: 3000 }).catch(() => {});

  // Toggle CPU on — check if already enabled via localStorage
  const cpuAlreadyOn = await page.evaluate(() => localStorage.getItem('gridlock-cpuEnabled') === 'true');
  if (!cpuAlreadyOn) {
    await page.locator('button:has-text("Play vs CPU")').click();
    await page.waitForTimeout(300);
  }

  // Create the game
  await page.click('button:has-text("Create Game")');
  await page.waitForURL(/\/game/, { timeout: 15_000 });
  await page.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 });
}

test.describe('Board Sizing on Mobile', () => {

  test('6×6 board fills mobile viewport (375px)', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    });
    const page = await ctx.newPage();

    await createCpuGameMobile(page, { username: 'Mobile6', gridSize: '6×6' });

    const boardContainer = page.locator('.board-container');
    await expect(boardContainer).toBeVisible({ timeout: 10_000 });

    const box = await boardContainer.boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeGreaterThanOrEqual(300);

    const hasHScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHScroll).toBe(false);

    await ctx.close();
  });

  test('4×4 board fills mobile viewport', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    });
    const page = await ctx.newPage();

    await createCpuGameMobile(page, { username: 'Mobile4', gridSize: '4×4' });

    const boardContainer = page.locator('.board-container');
    await expect(boardContainer).toBeVisible({ timeout: 10_000 });

    const box = await boardContainer.boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeGreaterThanOrEqual(300);

    const hasHScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHScroll).toBe(false);

    await ctx.close();
  });

  test('3×3 board fills mobile viewport', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    });
    const page = await ctx.newPage();

    await createCpuGameMobile(page, { username: 'Mobile3', gridSize: '3×3' });

    const boardContainer = page.locator('.board-container');
    await expect(boardContainer).toBeVisible({ timeout: 10_000 });

    const box = await boardContainer.boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeGreaterThanOrEqual(300);

    const hasHScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHScroll).toBe(false);

    await ctx.close();
  });

});
