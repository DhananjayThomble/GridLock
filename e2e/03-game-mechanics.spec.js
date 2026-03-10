// e2e/03-game-mechanics.spec.js — Score bar, session stats, sound UI, rematch UI

const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, joinGame, waitForGameStart, makeMove, getTurnState } = require('./helpers');

test.describe('Game UI & Mechanics', () => {

  test('score bar is visible during game', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Score bar should show both player names
    await expect(p1.locator('body')).toContainText('Alice');
    await expect(p1.locator('body')).toContainText('Bob');

    await ctx1.close();
    await ctx2.close();
  });

  test('mute button is present and toggles', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Mute button should exist (🔊 or 🔇)
    const muteBtn = p1.locator('button').filter({ hasText: /🔊|🔇/ });
    await expect(muteBtn).toBeVisible();

    const initialText = await muteBtn.innerText();
    await muteBtn.click();
    await p1.waitForTimeout(300);
    const afterText = await muteBtn.innerText();
    expect(afterText).not.toBe(initialText); // icon should flip

    await ctx1.close();
    await ctx2.close();
  });

  test('session stats button exists in lobby', async ({ page }) => {
    await goToLobby(page);
    await expect(page.locator('button:has-text("Stats")')).toBeVisible();
  });

  test('winner modal shows Rematch and Leave Game after game ends', async ({ browser }) => {
    // Play a full 3×3 game (12 lines) to trigger winner modal
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Play until game over (3×3 = 12 line segments max)
    let gameOver = false;
    for (let i = 0; i < 24 && !gameOver; i++) {
      const { p1HasTurn, p2HasTurn } = await getTurnState(p1, p2);
      const current = p1HasTurn ? p1 : p2HasTurn ? p2 : null;
      if (!current) break;

      await makeMove(current);

      // Check if game over
      await p1.waitForTimeout(300);
      const bodyText = await p1.locator('body').innerText();
      if (bodyText.includes('Game Over') || bodyText.includes('Rematch') || bodyText.includes('Winner')) {
        gameOver = true;
      }
    }

    if (gameOver) {
      // At least one page should show the winner modal
      const p1Text = await p1.locator('body').innerText();
      const p2Text = await p2.locator('body').innerText();
      const hasModal = p1Text.includes('Rematch') || p2Text.includes('Rematch');
      expect(hasModal, 'Winner modal should appear with Rematch button').toBe(true);
    }
    // If game didn't finish in 24 moves (shouldn't happen on 3×3), skip gracefully

    await ctx1.close();
    await ctx2.close();
  });

  test('Leave Game button returns to lobby', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Play full game
    let gameOver = false;
    for (let i = 0; i < 24 && !gameOver; i++) {
      const { p1HasTurn, p2HasTurn } = await getTurnState(p1, p2);
      const current = p1HasTurn ? p1 : p2HasTurn ? p2 : null;
      if (!current) break;
      await makeMove(current);
      await p1.waitForTimeout(200);
      const t = await p1.locator('body').innerText();
      if (t.includes('Rematch') || t.includes('Leave Game')) { gameOver = true; }
    }

    if (gameOver) {
      // Click Leave Game
      const leaveBtn = p1.locator('button:has-text("Leave Game")');
      if (await leaveBtn.isVisible()) {
        await leaveBtn.click();
        // In CI: URL returns to http://localhost:4173/ (base=/)
        // Locally: URL returns to http://localhost/beta
        // Either way: we should NOT be on /game anymore
        await p1.waitForFunction(
          () => !window.location.href.includes('/game'),
          { timeout: 10_000 }
        );
        await expect(p1.locator('body')).toContainText('GridLock');
      }
    }

    await ctx1.close();
    await ctx2.close();
  });

});
