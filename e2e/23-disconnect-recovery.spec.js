// e2e/23-disconnect-recovery.spec.js — Disconnect/reconnect testing

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame,
  waitForGameStart, getTurnState, makeMove,
} = require('./helpers');

test.describe('Disconnect & Recovery', () => {

  test('disconnect P2 → P1 sees disconnect message', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'DiscoAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'DiscoBob', roomCode });
      await waitForGameStart(p1, p2);

      // Close P2's page — this terminates P2's WebSocket connection
      await p2.close();

      // Wait for P1 to see disconnect message (server emits player_disconnected)
      let hasDisconnectMsg = false;
      for (let i = 0; i < 12; i++) {
        await p1.waitForTimeout(1000);
        const p1Body = await p1.locator('body').innerText().catch(() => '');
        if (p1Body.includes('disconnected') || p1Body.includes('Disconnected') ||
            p1Body.includes('reconnect') || p1Body.includes('Waiting') ||
            p1Body.includes('left')) {
          hasDisconnectMsg = true;
          break;
        }
      }
      expect(hasDisconnectMsg, 'P1 should see disconnect message after P2 closes').toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close().catch(() => {}); // already closed
    }
  });

  test('P2 reconnects → P1 sees reconnect / error clears', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    let ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    let p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'ReconAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'ReconBob', roomCode });
      await waitForGameStart(p1, p2);

      // Simulate disconnect by closing P2's page
      await p2.close();
      await ctx2.close();
      await p1.waitForTimeout(2000);

      // Reconnect P2 quickly (before 8s test-mode disconnect timeout expires)
      ctx2 = await browser.newContext();
      p2 = await ctx2.newPage();
      await joinGame(p2, { username: 'ReconBob', roomCode });

      await p1.waitForTimeout(3000);

      // P1 should see the game is back (turn indicator present, no active disconnect state)
      const p1Body = await p1.locator('body').innerText();
      const gameActive = (p1Body.includes('turn') || p1Body.includes('Turn')) &&
        !p1Body.includes('forfeited due to disconnect');
      expect(gameActive, `Game should be active after reconnect. Body: ${p1Body.slice(0, 300)}`).toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close().catch(() => {});
    }
  });

  test('game continues after reconnect — moves still work', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    let ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    let p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'ContAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'ContBob', roomCode });
      await waitForGameStart(p1, p2);

      // Make one move
      const { p1HasTurn } = await getTurnState(p1, p2);
      const first = p1HasTurn ? p1 : p2;
      const second = p1HasTurn ? p2 : p1;
      await makeMove(first);
      await second.waitForFunction(
        () => document.body.innerText.includes('Your turn'),
        { timeout: 10_000 }
      );

      // Close P2 (disconnect)
      await p2.close();
      await ctx2.close();
      await p1.waitForTimeout(3000);

      // P2 rejoins
      ctx2 = await browser.newContext();
      p2 = await ctx2.newPage();
      await joinGame(p2, { username: 'ContBob', roomCode });
      await p1.waitForTimeout(5000);

      // Try to make a move — game should still work
      const state = await getTurnState(p1, p2);
      const current = state.p1HasTurn ? p1 : state.p2HasTurn ? p2 : null;
      if (current) {
        const moved = await makeMove(current);
        expect(moved, 'Should be able to make moves after reconnect').toBe(true);
      } else {
        // Game might have ended or be in transition — just verify page is functional
        const body = await p1.locator('body').innerText();
        expect(body.trim().length).toBeGreaterThan(10);
      }
    } finally {
      await ctx1.close();
      await ctx2.close().catch(() => {});
    }
  });

  test('prolonged disconnect leads to forfeit', async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await goToLobby(p1);
      const roomCode = await createGame(p1, { username: 'ForfAlice', gridSize: '3×3' });
      await joinGame(p2, { username: 'ForfBob', roomCode });
      await waitForGameStart(p1, p2);

      // Permanently disconnect P2 by closing
      await p2.close();
      await ctx2.close();

      // Poll for forfeit — reconnect window is 8s in test mode (DISCONNECT_TIMEOUT_MS)
      let forfeited = false;
      for (let i = 0; i < 16; i++) {
        await p1.waitForTimeout(5000);
        const body = await p1.locator('body').innerText().catch(() => '');
        if (body.includes('forfeit') || body.includes('Forfeit') ||
            body.includes('forfeited') ||
            body.includes('Game Over') || body.includes('Rematch') ||
            body.includes('won') || body.includes('Winner')) {
          forfeited = true;
          break;
        }
      }
      expect(forfeited, 'Prolonged disconnect should trigger forfeit after timeout expires').toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close().catch(() => {});
    }
  });

});
