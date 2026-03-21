// tests/nightly/latency-simulation.spec.js — Network throttling tests
const { test, expect } = require('@playwright/test');
const {
  createGame, createCpuGame, joinGame, waitForGameStart,
  getTurnState, makeMove, playToCompletion, getGameState, BETA_URL,
} = require('../fixtures/test-helpers');

test.describe('Latency Simulation', () => {

  test.describe('High Latency Game', () => {
    test('two players stay in sync with 200ms RTT on one side', async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx1 = await browser.newContext();
      const ctx2 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const p2 = await ctx2.newPage();

      try {
        // Throttle P2's connection via CDP
        const cdpSession = await p2.context().newCDPSession(p2);
        await cdpSession.send('Network.emulateNetworkConditions', {
          offline: false,
          downloadThroughput: 1_000_000, // 1 MB/s
          uploadThroughput: 500_000,     // 500 KB/s
          latency: 200,                  // 200ms RTT
        });

        const roomCode = await createGame(p1, { username: 'LatP1', playerCount: 2, gridSize: '3×3' });
        await joinGame(p2, { username: 'LatP2', roomCode });
        await waitForGameStart(p1, p2);

        // Play to completion
        const completed = await playToCompletion([p1, p2], 80);
        expect(completed, 'Game should complete even with latency').toBe(true);

        // Both should see game over
        const state1 = await getGameState(p1);
        const state2 = await getGameState(p2);
        expect(state1.isGameOver).toBe(true);
        expect(state2.isGameOver).toBe(true);

        // Scores should match
        if (state1.scores && state2.scores) {
          const total1 = state1.scores[0] + state1.scores[1];
          const total2 = state2.scores[0] + state2.scores[1];
          expect(total1).toBe(total2);
        }

        // Disable throttling
        await cdpSession.send('Network.emulateNetworkConditions', {
          offline: false,
          downloadThroughput: -1,
          uploadThroughput: -1,
          latency: 0,
        });
      } finally {
        await ctx1.close();
        await ctx2.close();
      }
    });
  });

  test.describe('3G Mobile Network', () => {
    test('homepage and game load on 3G connection', async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      try {
        // Emulate 3G: 750ms latency, ~250 kbps
        const cdpSession = await page.context().newCDPSession(page);
        await cdpSession.send('Network.emulateNetworkConditions', {
          offline: false,
          downloadThroughput: 31_250,  // 250 kbps
          uploadThroughput: 31_250,
          latency: 750,
        });

        const startTime = Date.now();
        await page.goto(BETA_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        const loadTime = Date.now() - startTime;

        // Should load within 30s even on 3G
        expect(loadTime).toBeLessThan(30_000);
        await expect(page.locator('body')).toContainText('GridLock');

        // Try creating a CPU game
        await createCpuGame(page, { username: 'Nightly3G', gridSize: '3×3' });

        // Verify game renders
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).toMatch(/turn/i);

        console.log(`3G load time: ${loadTime}ms`);
      } finally {
        await ctx.close();
      }
    });
  });
});
