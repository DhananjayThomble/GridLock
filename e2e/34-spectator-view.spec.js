// e2e/34-spectator-view.spec.js — Spectator Mode tests

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, makeMove,
} = require('./helpers');

test.describe('Spectator View', () => {
  let ctx1, ctx2, ctx3, p1, p2, spectator, roomCode;

  test.beforeEach(async ({ browser }) => {
    ctx1 = await browser.newContext();
    ctx2 = await browser.newContext();
    ctx3 = await browser.newContext();
    p1 = await ctx1.newPage();
    p2 = await ctx2.newPage();
    spectator = await ctx3.newPage();

    await goToLobby(p1);
    roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);
    await joinGame(spectator, { username: 'Watcher', roomCode, joinMode: 'spectator' });
  });

  test.afterEach(async () => {
    await ctx1.close().catch(() => {});
    await ctx2.close().catch(() => {});
    await ctx3.close().catch(() => {});
  });

  test('join game as spectator via room code', async () => {
    await expect(spectator.locator('body')).toContainText(/Spectating|spectator|👀/i, { timeout: 15_000 });
  });

  test('spectator sees board but cannot click lines', async () => {
    await spectator.waitForFunction(
      () => /Spectating|spectator/i.test(document.body.innerText),
      { timeout: 15_000 }
    );

    // Positive control: verify that a PLAYER's board has clickable lines
    const [t1, t2] = await Promise.all([
      p1.locator('body').innerText(),
      p2.locator('body').innerText(),
    ]);
    const activePage = t1.includes('Your turn') ? p1 : p2;
    const playerClickable = await activePage.locator('[role="button"][aria-disabled="false"]').count();
    expect(playerClickable, 'Active player should have clickable lines (positive control)').toBeGreaterThan(0);

    // Now verify spectator has NO clickable lines
    const clickableLines = await spectator.locator('[role="button"][aria-disabled="false"]').count();
    expect(clickableLines, 'Spectator should have zero clickable lines').toBe(0);

    // Board dots/grid should still be visible
    const boardContainer = spectator.locator('.board-container');
    await expect(boardContainer).toBeVisible({ timeout: 5_000 });
  });

  test('spectator sees "👀 Spectating" indicator', async () => {
    await expect(spectator.locator('text=/👀.*Spectat/i')).toBeVisible({ timeout: 15_000 });
  });

  test('spectator sees real-time move updates', async () => {
    await spectator.waitForFunction(
      () => /Spectating|spectator/i.test(document.body.innerText),
      { timeout: 15_000 }
    );

    // Get initial spectator board state
    const boardBefore = await spectator.locator('.board-container').innerHTML();

    // Make a move on the active player's page
    const [t1, t2] = await Promise.all([
      p1.locator('body').innerText(),
      p2.locator('body').innerText(),
    ]);
    const activePage = t1.includes('Your turn') ? p1 : p2;
    await makeMove(activePage);

    // Wait for spectator to see the update (board HTML should change)
    await spectator.waitForFunction(
      (prevHtml) => {
        const container = document.querySelector('.board-container');
        return container && container.innerHTML !== prevHtml;
      },
      boardBefore,
      { timeout: 10_000 }
    );
  });

  test('spectator count shown to players', async () => {
    await spectator.waitForFunction(
      () => /Spectating|spectator/i.test(document.body.innerText),
      { timeout: 15_000 }
    );

    // Players should see spectator count indicator
    const hasSpectatorCount = await Promise.race([
      p1.waitForFunction(() => /👀\s*\d|spectator.*\d|\d.*spectator/i.test(document.body.innerText), { timeout: 10_000 }).then(() => true).catch(() => false),
      p2.waitForFunction(() => /👀\s*\d|spectator.*\d|\d.*spectator/i.test(document.body.innerText), { timeout: 10_000 }).then(() => true).catch(() => false),
    ]);
    expect(hasSpectatorCount).toBe(true);
  });

});
