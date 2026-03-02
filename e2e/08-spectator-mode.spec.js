const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, getTurnState, makeMove,
} = require('./helpers');

test.describe('Spectator mode', () => {
  test('spectator can join game and receives live updates but cannot play', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();

    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const spectator = await ctx3.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    await joinGame(spectator, { username: 'Watcher', roomCode, joinMode: 'spectator' });
    await spectator.waitForFunction(() => /Spectating|spectator/i.test(document.body.innerText), { timeout: 15_000 });

    // Spectator should not see any interactive move lines.
    await expect(spectator.locator('[class*="cursor-pointer"]')).toHaveCount(0);

    // Make a valid move as active player and confirm spectator sees update.
    const { p1HasTurn } = await getTurnState(p1, p2);
    const activePlayer = p1HasTurn ? p1 : p2;

    const moveOk = await makeMove(activePlayer);
    expect(moveOk).toBe(true);

    await spectator.waitForTimeout(500);
    const spectatorText = await spectator.locator('body').innerText();
    expect(/turn/i.test(spectatorText)).toBe(true);

    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
  });
});
