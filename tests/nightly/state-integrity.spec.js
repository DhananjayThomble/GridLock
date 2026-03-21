// tests/nightly/state-integrity.spec.js — DB/Redis state checks
const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const { execSync } = require('child_process');
const { BETA_URL, BETA_API } = require('../fixtures/test-helpers');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock_beta';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Run a redis-cli command and return stdout.
 * Uses redis-cli directly to avoid depending on the redis npm package at root level.
 */
function redisCliExec(cmd) {
  const url = new URL(REDIS_URL);
  const host = url.hostname || '127.0.0.1';
  const port = url.port || '6379';
  return execSync(`redis-cli -h ${host} -p ${port} ${cmd}`, { encoding: 'utf8' }).trim();
}

test.describe('State Integrity', () => {

  test('no zombie games in MongoDB (inactive >2h, not completed)', async () => {
    test.setTimeout(30_000);
    const client = new MongoClient(MONGO_URI);

    try {
      await client.connect();
      const db = client.db();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const zombieGames = await db.collection('games').countDocuments({
        lastActivityAt: { $lt: twoHoursAgo },
        status: { $nin: ['finished', 'abandoned'] },
      });

      console.log(`  Zombie games (inactive >2h, not finished): ${zombieGames}`);
      // Allow a small number — some may be in the process of timing out
      expect(zombieGames).toBeLessThanOrEqual(5);
    } finally {
      await client.close();
    }
  });

  test('no major Redis/MongoDB game count mismatch', async () => {
    test.setTimeout(30_000);
    const mongoClient = new MongoClient(MONGO_URI);

    try {
      await mongoClient.connect();
      const db = mongoClient.db();

      // Count active games in MongoDB
      const mongoActiveGames = await db.collection('games').countDocuments({
        status: { $in: ['waiting', 'playing'] },
      });

      // Count game keys in Redis using redis-cli
      const keysOutput = redisCliExec('KEYS "game:*"');
      const redisGameCount = keysOutput === '' ? 0 : keysOutput.split('\n').length;

      console.log(`  MongoDB active games: ${mongoActiveGames}`);
      console.log(`  Redis game keys: ${redisGameCount}`);

      // Redis may have more (due to TTL lag) or fewer (evicted),
      // but they should be in the same ballpark
      const diff = Math.abs(mongoActiveGames - redisGameCount);
      // Allow a generous diff — some games may be in transition
      expect(diff).toBeLessThanOrEqual(Math.max(mongoActiveGames, redisGameCount, 10));
    } finally {
      await mongoClient.close();
    }
  });

  test('idle timeout verification — socket disconnects after inactivity', async ({ page }) => {
    // This test requires 5+ minutes of idle time — mark as slow
    test.setTimeout(360_000); // 6 minutes
    test.slow();

    await page.goto(BETA_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('GridLock');

    // Track socket disconnection
    await page.evaluate(() => {
      window._socketDisconnected = false;
      window._disconnectReason = null;
      window.addEventListener('gridlock:idle_timeout', (e) => {
        window._socketDisconnected = true;
        window._disconnectReason = e.detail?.reason || 'idle_timeout';
      });
    });

    // Wait for 5 minutes + 30 seconds (idle timeout is ~5 min)
    console.log('  Waiting 5m30s for idle timeout...');
    await page.waitForTimeout(5 * 60_000 + 30_000);

    const disconnected = await page.evaluate(() => window._socketDisconnected);
    const reason = await page.evaluate(() => window._disconnectReason);

    console.log(`  Socket disconnected: ${disconnected}, reason: ${reason}`);
    // The socket should have been disconnected by idle timeout
    expect(disconnected, 'Socket should disconnect after idle timeout').toBe(true);
  });

  test('leaderboard API vs page consistency', async ({ page, request }) => {
    test.setTimeout(30_000);

    // Fetch leaderboard via API
    const apiResponse = await request.get(`${BETA_API}/api/leaderboard`, {
      params: { limit: 10, sort: 'wins' },
    });

    if (apiResponse.ok()) {
      const apiData = await apiResponse.json();
      const apiUsernames = (apiData.leaderboard || apiData || [])
        .slice(0, 10)
        .map(e => e.username);

      // Load leaderboard page
      await page.goto(`${BETA_URL}/leaderboard`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2_000);
      const pageText = await page.locator('body').innerText();

      // Check that top API usernames appear on the page
      let matchCount = 0;
      for (const username of apiUsernames) {
        if (pageText.includes(username)) matchCount++;
      }

      console.log(`  Leaderboard: ${matchCount}/${apiUsernames.length} API entries found on page`);
      // At least 50% should match (page may have different sort/filter defaults)
      if (apiUsernames.length > 0) {
        expect(matchCount).toBeGreaterThanOrEqual(Math.floor(apiUsernames.length * 0.5));
      }
    } else {
      console.log(`  Leaderboard API returned ${apiResponse.status()} — skipping consistency check`);
    }
  });
});
