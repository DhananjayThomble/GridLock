// e2e/07-mobile-touch.spec.js — Mobile touch interaction regression checks

const { test, expect, devices } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, getTurnState,
} = require('./helpers');

async function tapMove(page) {
  const lines = page.locator('[role="button"][tabindex="0"]');
  const count = await lines.count();

  for (let i = 0; i < Math.min(count, 20); i++) {
    try {
      await lines.nth(i).tap({ timeout: 2500, force: true });
      return true;
    } catch {
      // Try next candidate line
    }
  }

  return false;
}

test.describe('Mobile touch controls', () => {
  test('player can tap a line on mobile and turn switches', async ({ browser }) => {
    const ctx1 = await browser.newContext({ ...devices['iPhone 13'] });
    const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'AliceM', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'BobM', roomCode });
    await waitForGameStart(p1, p2);

    const { p1HasTurn } = await getTurnState(p1, p2);
    const currentPage = p1HasTurn ? p1 : p2;
    const otherPage = p1HasTurn ? p2 : p1;

    const moved = await tapMove(currentPage);
    expect(moved, 'Current mobile player should be able to tap a line').toBe(true);

    await otherPage.waitForFunction(
      () => document.body.innerText.includes('Your turn'),
      { timeout: 10000 }
    );

    const { p1HasTurn: p1After, p2HasTurn: p2After } = await getTurnState(p1, p2);
    const switched = p1HasTurn ? p2After : p1After;
    expect(switched, 'Turn should switch after a valid mobile tap').toBe(true);

    await ctx1.close();
    await ctx2.close();
  });
});
