// e2e/52-socket-stability.spec.js — Socket stability E2E tests
// Covers: 4P disconnect recovery, host lobby disconnect, reconnect, stale banner, mobile viewport

const { test, expect } = require('@playwright/test');
const { goToLobby, makeMove, playToCompletion, BASE_URL } = require('./helpers');
const { createGameV, joinGameV, joinToWaitingRoom } = require('./wave-helpers');

test.describe('Socket Stability', () => {

  // ── Test 1: 4P disconnect recovery ──────────────────────────────────────
  test('4P game continues after P3 disconnects', async ({ browser }) => {
    test.setTimeout(180_000);

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const ctx4 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();
    const p4 = await ctx4.newPage();

    try {
      // Create 4P game
      const roomCode = await createGameV(p1, { username: 'StabP1', playerCount: 4, gridSize: '3×3' });
      expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

      // Players join
      await joinToWaitingRoom(p2, { username: 'StabP2', roomCode });
      await joinToWaitingRoom(p3, { username: 'StabP3', roomCode });
      await joinToWaitingRoom(p4, { username: 'StabP4', roomCode });

      // Host starts if button is visible
      if (p1.url().includes('/waiting/')) {
        const startBtn = p1.locator('button:has-text("Start Game")');
        if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await startBtn.click();
        }
      }

      // Wait for all players to reach /game
      await Promise.all([
        p1.waitForURL(/\/game/, { timeout: 20_000 }),
        p2.waitForURL(/\/game/, { timeout: 20_000 }),
        p3.waitForURL(/\/game/, { timeout: 20_000 }),
        p4.waitForURL(/\/game/, { timeout: 20_000 }),
      ]);

      // Wait for game to be active
      await p1.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 15_000 });

      // P3 disconnects
      await p3.close();
      await ctx3.close();

      // Wait for disconnect to be detected (8s timeout + buffer)
      await p1.waitForTimeout(12_000);

      // Check P3 is marked as left/disconnected on remaining players' screens
      const p1Body = await p1.locator('body').innerText().catch(() => '');
      const seesLeft = /left|disconnected|forfeited/i.test(p1Body);
      expect(seesLeft, 'P1 should see P3 left/disconnected').toBe(true);

      // Game should continue for remaining players
      const remainingPages = [p1, p2, p4];
      await playToCompletion(remainingPages, 80);

      // Verify game ends with a winner or game over
      let winnerDeclared = false;
      for (const page of remainingPages) {
        try {
          const text = await page.locator('body').innerText().catch(() => '');
          if (/Winner|wins!|Game Over|Rematch|forfeited/i.test(text)) {
            winnerDeclared = true;
            break;
          }
        } catch { continue; }
      }
      expect(winnerDeclared, 'Game should declare a winner or end').toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close().catch(() => {});
      await ctx3.close().catch(() => {});
      await ctx4.close();
    }
  });

  // ── Test 2: Host disconnect in lobby ────────────────────────────────────
  test('host disconnect in lobby sends room_closed to other players', async ({ browser }) => {
    test.setTimeout(60_000);

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      // P1 creates game
      const roomCode = await createGameV(p1, { username: 'HostDC', playerCount: 2, gridSize: '3×3' });
      expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

      // P2 joins waiting room
      await joinToWaitingRoom(p2, { username: 'WaitingP2', roomCode });

      // Verify P2 is in waiting room
      expect(p2.url()).toMatch(/\/(waiting|game)/);

      // P1 (host) disconnects
      await p1.close();
      await ctx1.close();

      // P2 should see room_closed or be redirected/notified
      // Wait up to 15s for the disconnect detection + room_closed
      await p2.waitForFunction(
        () => {
          const text = document.body?.innerText || '';
          return /closed|disbanded|host.*left|host.*disconnected|lobby|room.*closed/i.test(text)
            || window.location.pathname === '/';
        },
        { timeout: 20_000 }
      ).catch(() => {});

      // Verify: P2 was kicked back to lobby or sees room closed message
      const p2Body = await p2.locator('body').innerText().catch(() => '');
      const p2Url = p2.url();
      const roomClosed = /closed|disbanded|host.*left|host.*disconnected/i.test(p2Body)
        || p2Url.endsWith('/') || p2Url.includes('/lobby');
      expect(roomClosed, `P2 should see room closed or be at lobby. URL: ${p2Url}, Body: ${p2Body.slice(0, 200)}`).toBe(true);
    } finally {
      await ctx1.close().catch(() => {});
      await ctx2.close();
    }
  });

  // ── Test 3: Reconnect after disconnect ──────────────────────────────────
  test('player can reconnect after disconnect with same session token', async ({ browser }) => {
    test.setTimeout(120_000);

    const ctx1 = await browser.newContext();
    let ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    let p2 = await ctx2.newPage();

    try {
      // Create 2P game
      const roomCode = await createGameV(p1, { username: 'ReconP1', playerCount: 2, gridSize: '3×3' });
      await joinToWaitingRoom(p2, { username: 'ReconP2', roomCode });

      // Start the game if in waiting room
      if (p1.url().includes('/waiting/')) {
        const startBtn = p1.locator('button:has-text("Start Game")');
        if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await startBtn.click();
        }
      }

      await p1.waitForURL(/\/game/, { timeout: 20_000 });
      await p2.waitForURL(/\/game/, { timeout: 20_000 });
      await p1.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 15_000 });

      // Read P2's session token from localStorage before disconnecting
      const sessionData = await p2.evaluate(() => {
        const gameId = localStorage.getItem('gridlock_active_game');
        const username = localStorage.getItem('gridlock_username');
        const sessionToken = gameId && username
          ? localStorage.getItem(`gridlock:session:${gameId}:${username}`)
          : null;
        return { sessionToken, activeGame: gameId, username };
      });

      // P2 disconnects
      await p2.close();
      await ctx2.close();

      // Wait briefly (but within the 8s reconnect window)
      await p1.waitForTimeout(3_000);

      // P2 reconnects with same credentials
      ctx2 = await browser.newContext();
      p2 = await ctx2.newPage();

      // Set up the session data before navigating
      await p2.addInitScript(() => {
        localStorage.setItem('gridlock_has_played', 'true');
      });

      // Rejoin using the stored session
      if (sessionData.sessionToken && sessionData.activeGame) {
        // Navigate and attempt rejoin via the game URL directly
        await p2.addInitScript((data) => {
          localStorage.setItem('gridlock_active_game', data.activeGame);
          if (data.username) localStorage.setItem('gridlock_username', data.username);
          if (data.sessionToken && data.activeGame && data.username) {
            localStorage.setItem(`gridlock:session:${data.activeGame}:${data.username}`, data.sessionToken);
          }
        }, sessionData);
      }

      // Try to rejoin through the join flow
      await joinGameV(p2, { username: 'ReconP2', roomCode });

      // Verify game continues — P2 should be back in the game
      await p2.waitForFunction(
        () => /turn|Game Over|Rematch|forfeited/i.test(document.body.innerText),
        { timeout: 15_000 }
      );

      const p2Body = await p2.locator('body').innerText();
      expect(/turn|Game Over|Rematch|forfeited/i.test(p2Body), 'P2 should be back in game').toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close().catch(() => {});
    }
  });

  // ── Test 4: Stale rejoin banner ─────────────────────────────────────────
  test('stale rejoin banner clears for nonexistent game', async ({ browser }) => {
    test.setTimeout(30_000);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      // Inject fake active game data before navigating
      await page.addInitScript(() => {
        localStorage.setItem('gridlock_has_played', 'true');
        localStorage.setItem('gridlock_active_game', JSON.stringify({
          gameId: 'FAKEGAME999',
          sessionToken: 'fake-token-abc123',
          username: 'GhostPlayer',
        }));
      });

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });

      // Wait for the banner validation to complete
      // The lobby should emit validate_rejoin, get { valid: false }, and clear the banner
      await page.waitForTimeout(5_000);

      // Verify no active rejoin banner is shown (it should have been cleared)
      const bodyText = await page.locator('body').innerText();
      const hasRejoinBanner = /rejoin|resume.*game|return.*game/i.test(bodyText);

      // The banner should NOT be present (it was for a nonexistent game)
      // OR if it briefly appeared, localStorage should have been cleaned
      const activeGame = await page.evaluate(() => localStorage.getItem('gridlock_active_game'));

      // Either the banner is gone or localStorage was cleared
      const staleCleared = !hasRejoinBanner || !activeGame || activeGame === 'null';
      expect(staleCleared, 'Stale rejoin banner should be cleared for nonexistent game').toBe(true);
    } finally {
      await ctx.close();
    }
  });

  // ── Test 5: Mobile viewport 4P ──────────────────────────────────────────
  test('4P game works with mobile viewport (iPhone)', async ({ browser }) => {
    test.setTimeout(180_000);

    // iPhone 12 viewport
    const mobileViewport = { width: 390, height: 844, isMobile: true, hasTouch: true };

    const ctx1 = await browser.newContext({ viewport: mobileViewport, isMobile: true, hasTouch: true });
    const ctx2 = await browser.newContext({ viewport: mobileViewport, isMobile: true, hasTouch: true });
    const ctx3 = await browser.newContext({ viewport: mobileViewport, isMobile: true, hasTouch: true });
    const ctx4 = await browser.newContext({ viewport: mobileViewport, isMobile: true, hasTouch: true });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();
    const p4 = await ctx4.newPage();

    try {
      // Create 4P game on mobile
      const roomCode = await createGameV(p1, { username: 'MobP1', playerCount: 4, gridSize: '3×3' });
      expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

      // Players join
      await joinToWaitingRoom(p2, { username: 'MobP2', roomCode });
      await joinToWaitingRoom(p3, { username: 'MobP3', roomCode });
      await joinToWaitingRoom(p4, { username: 'MobP4', roomCode });

      // Host starts
      if (p1.url().includes('/waiting/')) {
        const startBtn = p1.locator('button:has-text("Start Game"), button:has-text("Start")');
        if (await startBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
          await startBtn.first().click();
        }
      }

      // Wait for all to reach game
      await Promise.all([
        p1.waitForURL(/\/game/, { timeout: 20_000 }),
        p2.waitForURL(/\/game/, { timeout: 20_000 }),
        p3.waitForURL(/\/game/, { timeout: 20_000 }),
        p4.waitForURL(/\/game/, { timeout: 20_000 }),
      ]);

      await p1.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 15_000 });

      // P3 disconnects (same as test 1 but on mobile)
      await p3.close();
      await ctx3.close();

      await p1.waitForTimeout(12_000);

      // Verify disconnect is reflected
      const p1Body = await p1.locator('body').innerText().catch(() => '');
      expect(/left|disconnected|forfeited/i.test(p1Body), 'P1 (mobile) should see P3 disconnected').toBe(true);

      // Play to completion on mobile
      const remainingPages = [p1, p2, p4];
      await playToCompletion(remainingPages, 80);

      // Verify game ended
      let gameEnded = false;
      for (const page of remainingPages) {
        try {
          const text = await page.locator('body').innerText().catch(() => '');
          if (/Winner|wins!|Game Over|Rematch|forfeited/i.test(text)) {
            gameEnded = true;
            break;
          }
        } catch { continue; }
      }
      expect(gameEnded, 'Mobile 4P game should end properly').toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
      await ctx3.close().catch(() => {});
      await ctx4.close();
    }
  });

});
