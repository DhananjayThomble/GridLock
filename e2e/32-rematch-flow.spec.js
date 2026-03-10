// e2e/32-rematch-flow.spec.js — Instant Rematch tests

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, makeMove, createCpuGame,
  playToCompletion, BASE_URL,
} = require('./helpers');

test.describe('Rematch Flow', () => {

  test('after game ends, "Rematch" button is visible', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    const completed = await playToCompletion([p1, p2]);
    expect(completed).toBe(true);

    // At least one page should show the Rematch button
    const hasRematch = await Promise.race([
      p1.locator('button:has-text("Rematch")').waitFor({ timeout: 10_000 }).then(() => true).catch(() => false),
      p2.locator('button:has-text("Rematch")').waitFor({ timeout: 10_000 }).then(() => true).catch(() => false),
    ]);
    expect(hasRematch).toBe(true);

    await ctx1.close();
    await ctx2.close();
  });

  test('clicking rematch shows vote count', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);
    await playToCompletion([p1, p2]);

    // Click rematch on p1
    const rematchBtn = p1.locator('button:has-text("Rematch")');
    await rematchBtn.waitFor({ timeout: 10_000 });
    await rematchBtn.click();

    // Should show waiting state with vote count
    await expect(p1.locator('text=/Waiting.*1\\/2|\\(1\\/2\\)/i')).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });

  test('both players click rematch → new game starts', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);
    await playToCompletion([p1, p2]);

    // Both players click rematch
    const rematch1 = p1.locator('button:has-text("Rematch")');
    const rematch2 = p2.locator('button:has-text("Rematch")');
    await rematch1.waitFor({ timeout: 10_000 });
    await rematch2.waitFor({ timeout: 10_000 });
    await rematch1.click();
    await rematch2.click();

    // New game should start — look for turn indicators
    await Promise.race([
      p1.waitForFunction(() => /Your turn|turn/i.test(document.body.innerText), { timeout: 20_000 }),
      p2.waitForFunction(() => /Your turn|turn/i.test(document.body.innerText), { timeout: 20_000 }),
    ]);

    await ctx1.close();
    await ctx2.close();
  });

  test('only one player clicks → shows waiting state', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);
    await playToCompletion([p1, p2]);

    // Only p1 clicks rematch
    const rematch1 = p1.locator('button:has-text("Rematch")');
    await rematch1.waitFor({ timeout: 10_000 });
    await rematch1.click();

    // p1 should show waiting, p2 should still see Rematch option
    await expect(p1.locator('text=/Waiting|Cancel/i')).toBeVisible({ timeout: 10_000 });
    await expect(p2.locator('button:has-text("Rematch")')).toBeVisible({ timeout: 5_000 });

    await ctx1.close();
    await ctx2.close();
  });

  test('CPU game rematch → instant reset (no voting)', async ({ page }) => {
    await createCpuGame(page, { username: 'Human', gridSize: '3×3', playerCount: 2 });
    await page.waitForFunction(() => /Your turn|turn/i.test(document.body.innerText), { timeout: 20_000 });

    // Play the CPU game to completion
    for (let i = 0; i < 80; i++) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) break;
      if (text.includes('Your turn')) {
        await makeMove(page);
      }
      await page.waitForTimeout(400);
    }

    // Click rematch — should start immediately (no voting UI)
    const rematchBtn = page.locator('button:has-text("Rematch")');
    await rematchBtn.waitFor({ timeout: 15_000 });
    await rematchBtn.click();

    // Should see "Starting rematch" or go straight to game
    await page.waitForFunction(
      () => /Your turn|Starting rematch|turn/i.test(document.body.innerText),
      { timeout: 20_000 }
    );
  });

  // TODO: "tournament game → no rematch button shown" — removed because it was a no-op.
  // Board.jsx guards Rematch on `!tournamentId` (line ~817), but Playwright cannot
  // intercept/modify WebSocket frames. The previous test resorted to DOM manipulation
  // (hiding the button via JS), which tested nothing real.
  // Proper coverage options:
  //   1. Unit/integration test for the Board component with tournamentId prop
  //   2. A test-only server route that creates a tournament-context game
  // The positive case (Rematch IS shown for normal games) is covered by the other
  // tests in this file.

});
