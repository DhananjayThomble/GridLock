// e2e/02-multiplayer.spec.js — Full multiplayer game flow

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, getTurnState, makeMove, BASE_URL,
} = require('./helpers');

test.describe('Multiplayer Game Flow', () => {

  test('P1 creates game and sees room code', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goToLobby(page);
    const roomCode = await createGame(page, { username: 'Alice', playerCount: 2, gridSize: '3×3' });

    expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);
    expect(errors, `JS errors on game page: ${errors.join('; ')}`).toHaveLength(0);
    await ctx.close();
  });

  test('P2 can join via room code and both reach game board', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });

    await waitForGameStart(p1, p2);

    const { p1Text, p2Text } = await getTurnState(p1, p2);
    expect(p1Text).toMatch(/turn/i);
    expect(p2Text).toMatch(/turn/i);

    await ctx1.close();
    await ctx2.close();
  });

  test('P2 role is never "player_joining" after joining', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    const p2Text = await p2.locator('body').innerText();
    expect(p2Text).not.toContain('player_joining');

    await ctx1.close();
    await ctx2.close();
  });

  test('exactly one player sees "Your turn" at game start', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    const { p1HasTurn, p2HasTurn } = await getTurnState(p1, p2);
    expect(p1HasTurn || p2HasTurn, 'At least one player sees Your turn').toBe(true);
    expect(p1HasTurn && p2HasTurn, 'Both cannot have turn simultaneously').toBe(false);

    await ctx1.close();
    await ctx2.close();
  });

  test('turn switches after a move', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    const { p1HasTurn } = await getTurnState(p1, p2);
    const currentPage = p1HasTurn ? p1 : p2;
    const otherPage   = p1HasTurn ? p2 : p1;

    const moved = await makeMove(currentPage);
    expect(moved, 'Current player should be able to make a move').toBe(true);

    // Wait for turn to switch to other player
    await otherPage.waitForFunction(
      () => document.body.innerText.includes('Your turn'),
      { timeout: 10_000 }
    );

    const { p1HasTurn: p1After, p2HasTurn: p2After } = await getTurnState(p1, p2);
    const switched = p1HasTurn ? p2After : p1After;
    expect(switched, 'Turn should switch to the other player after a move').toBe(true);

    await ctx1.close();
    await ctx2.close();
  });

  test('P2 can also make a move (regression: player_joining bug)', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Make first move with whoever has the turn
    const { p1HasTurn } = await getTurnState(p1, p2);
    const first  = p1HasTurn ? p1 : p2;
    const second = p1HasTurn ? p2 : p1;

    await makeMove(first);
    await second.waitForFunction(
      () => document.body.innerText.includes('Your turn'),
      { timeout: 10_000 }
    );

    // Second player MUST now be able to make a move
    const p2Moved = await makeMove(second);
    expect(p2Moved, 'P2 must be able to click a line when it is their turn').toBe(true);

    await ctx1.close();
    await ctx2.close();
  });

  test('no JS errors during full 2-player exchange', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const errors = [];
    p1.on('pageerror', e => errors.push(`P1: ${e.message}`));
    p2.on('pageerror', e => errors.push(`P2: ${e.message}`));

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    const { p1HasTurn } = await getTurnState(p1, p2);
    const first  = p1HasTurn ? p1 : p2;
    const second = p1HasTurn ? p2 : p1;

    await makeMove(first);
    await second.waitForFunction(
      () => document.body.innerText.includes('Your turn'),
      { timeout: 10_000 }
    ).catch(() => {});
    await makeMove(second);

    expect(errors, `JS errors during game: ${errors.join('; ')}`).toHaveLength(0);

    await ctx1.close();
    await ctx2.close();
  });

});
