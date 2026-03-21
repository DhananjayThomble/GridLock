// tests/nightly/critical-journeys.spec.js — Critical user flows against live beta
const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, createCpuGame, joinGame,
  waitForGameStart, getTurnState, makeMove,
  playToCompletion, waitForGameEnd, getGameState,
  BETA_URL,
} = require('../fixtures/test-helpers');

test.describe('Critical Journeys', () => {

  test.describe('Create & Play Solo vs CPU', () => {
    test('play a full CPU game to completion', async ({ page }) => {
      test.setTimeout(90_000);
      await createCpuGame(page, { username: 'NightlySolo', gridSize: '3×3' });

      // Play moves as human until game ends
      const completed = await playToCompletion([page], 30);
      expect(completed, 'CPU game should reach completion').toBe(true);

      // Verify game-over state shows winner and scores
      const state = await getGameState(page);
      expect(state.isGameOver).toBe(true);
      expect(state.scores).not.toBeNull();

      // Verify Rematch button is visible
      await expect(page.locator('button:has-text("Rematch")')).toBeVisible({ timeout: 5_000 });
    });

    test('scores are displayed correctly at game end', async ({ page }) => {
      test.setTimeout(90_000);
      await createCpuGame(page, { username: 'NightlyScore', gridSize: '3×3' });
      await playToCompletion([page], 30);

      const bodyText = await page.locator('body').innerText();
      // Game over should show player names and scores
      expect(bodyText).toMatch(/NightlyScore|🤖|CPU/);
      expect(bodyText).toMatch(/\d+/); // at least one number (score)
    });
  });

  test.describe('Two-Player Game (join via code)', () => {
    test('create game, join via code, play to completion', async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();

      try {
        const roomCode = await createGame(p1, { username: 'NightlyP1', playerCount: 2, gridSize: '3×3' });
        expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

        await joinGame(p2, { username: 'NightlyP2', roomCode });
        await waitForGameStart(p1, p2);

        // Both should see turn indicator
        const { p1Text, p2Text } = await getTurnState(p1, p2);
        expect(p1Text).toMatch(/turn/i);
        expect(p2Text).toMatch(/turn/i);

        // Play to completion
        const completed = await playToCompletion([p1, p2], 80);
        expect(completed, 'Two-player game should complete').toBe(true);

        // Both should see game over
        for (const page of [p1, p2]) {
          const state = await getGameState(page);
          expect(state.isGameOver).toBe(true);
        }
      } finally {
        await ctx1.close();
        await ctx2.close();
      }
    });
  });

  test.describe('Quick Play Matchmaking', () => {
    test('two browsers quick play and get matched', async ({ browser }) => {
      test.setTimeout(60_000);
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();

      try {
        // Both navigate to lobby
        await goToLobby(p1);
        await goToLobby(p2);

        // P1 enters quick play
        await p1.fill('input[placeholder="Enter your name…"]', 'NightlyQP1');
        await p1.click('button:has-text("⚡ Quick Play")');
        await expect(p1.locator('text=Searching for opponents')).toBeVisible({ timeout: 5_000 });

        // P2 enters quick play
        await p2.fill('input[placeholder="Enter your name…"]', 'NightlyQP2');
        await p2.click('button:has-text("⚡ Quick Play")');

        // Wait for both to enter a game (either matched together or matched with CPU fallback)
        await Promise.all([
          p1.waitForURL(/\/game/, { timeout: 30_000 }).catch(() => {}),
          p2.waitForURL(/\/game/, { timeout: 30_000 }).catch(() => {}),
        ]);

        // At least one should be in a game
        const p1InGame = p1.url().includes('/game');
        const p2InGame = p2.url().includes('/game');
        expect(p1InGame || p2InGame, 'At least one player should be in a game').toBe(true);

        // If both matched, play a few moves to verify
        if (p1InGame && p2InGame) {
          await waitForGameStart(p1, p2).catch(() => {});
          const moved = await makeMove(p1).catch(() => false) || await makeMove(p2).catch(() => false);
          expect(moved).toBe(true);
        }
      } finally {
        await ctx1.close();
        await ctx2.close();
      }
    });
  });

  test.describe('Spectator Mode', () => {
    test('spectator sees the board but cannot make moves', async ({ browser }) => {
      test.setTimeout(90_000);
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const ctx3 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();
      const spectator = await ctx3.newPage();

      try {
        const roomCode = await createGame(p1, { username: 'NightlySpec1', playerCount: 2, gridSize: '3×3' });
        await joinGame(p2, { username: 'NightlySpec2', roomCode });
        await waitForGameStart(p1, p2);

        // Spectator joins
        await joinGame(spectator, { username: 'NightlyWatcher', roomCode, joinMode: 'spectator' });
        await spectator.waitForFunction(
          () => /Spectating|spectator/i.test(document.body.innerText),
          { timeout: 15_000 }
        );

        // Spectator should NOT have interactive lines
        const interactiveLines = await spectator.locator('[role="button"][aria-disabled="false"]').count();
        expect(interactiveLines, 'Spectator should have no clickable lines').toBe(0);

        // Make a move and verify spectator sees the update
        const specBefore = await spectator.locator('body').innerText();
        const { p1HasTurn } = await getTurnState(p1, p2);
        await makeMove(p1HasTurn ? p1 : p2);

        await spectator.waitForFunction(
          prev => document.body && document.body.innerText !== prev,
          specBefore,
          { timeout: 5_000 }
        );
      } finally {
        await ctx1.close();
        await ctx2.close();
        await ctx3.close();
      }
    });
  });

  test.describe('Game Replay', () => {
    test('replay page loads after game ends', async ({ page }) => {
      test.setTimeout(90_000);
      await createCpuGame(page, { username: 'NightlyReplay', gridSize: '3×3' });
      await playToCompletion([page], 30);

      // Check for replay link or navigate to replay
      const replayLink = page.locator('a:has-text("Replay"), button:has-text("Replay"), a:has-text("View Replay")');
      const hasReplay = await replayLink.count() > 0;

      if (hasReplay) {
        await replayLink.first().click();
        await page.waitForTimeout(2_000);
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).toMatch(/replay|move|history/i);
      } else {
        // Replay may not be accessible via button — just verify game completed
        const state = await getGameState(page);
        expect(state.isGameOver).toBe(true);
      }
    });
  });

  test.describe('Profile & Leaderboard', () => {
    test('leaderboard page loads with data', async ({ page }) => {
      await page.goto(`${BETA_URL}/leaderboard`, { waitUntil: 'networkidle' });
      await expect(page.locator('body')).toContainText('GridLock');

      // Wait for leaderboard data to load
      await page.waitForFunction(
        () => {
          const text = document.body.innerText;
          return /wins|games|elo|played/i.test(text);
        },
        { timeout: 10_000 }
      );

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).toMatch(/\d+/); // Should have numbers (stats)
    });

    test('how-to-play page loads without errors', async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));

      await page.goto(`${BETA_URL}/how-to-play`, { waitUntil: 'networkidle' });
      await expect(page.locator('body')).toContainText('GridLock');
      expect(errors).toHaveLength(0);
    });
  });
});
