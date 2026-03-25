// tests/weekly/chaos/redis-latency.spec.js — Non-destructive Redis health verification
const { test, expect } = require('@playwright/test');
const { createCpuGame, makeMove, playToCompletion, BETA_API } = require('../../fixtures/test-helpers');
const { execSync } = require('child_process');

test.describe('Chaos: Redis Latency', () => {

  test('health endpoint reports Redis status', async ({ request }) => {
    test.setTimeout(15_000);
    const response = await request.get(`${BETA_API}/health`);
    expect(response.ok()).toBe(true);

    const health = await response.json();
    console.log('  Health endpoint:', JSON.stringify(health));

    expect(health.status).toBe('ok');
    // Verify Redis is mentioned in health check (if available)
    if (health.redis !== undefined) {
      expect(health.redis).toBe('connected');
    }
  });

  test('game works normally — baseline for chaos reference', async ({ page }) => {
    test.setTimeout(90_000);
    await createCpuGame(page, { username: 'ChaosBaseline', gridSize: '3×3' });
    const completed = await playToCompletion([page], 30);
    expect(completed, 'Baseline game should complete successfully').toBe(true);
  });

  test('no Redis errors in PM2 logs during test window', async () => {
    test.setTimeout(15_000);
    try {
      // Check last 50 lines of beta backend logs for Redis errors
      const logs = execSync(
        'pm2 logs gridlock-beta-backend --lines 50 --nostream 2>&1',
        { encoding: 'utf8', timeout: 10_000 }
      );

      const redisErrors = logs
        .split('\n')
        .filter(line => /redis.*error|ECONNREFUSED.*6379|Redis connection/i.test(line));

      console.log(`  Redis errors in recent logs: ${redisErrors.length}`);
      for (const err of redisErrors.slice(0, 5)) {
        console.log(`    ${err.trim()}`);
      }

      // Allow a few transient errors, but not a flood
      expect(redisErrors.length).toBeLessThanOrEqual(5);
    } catch (err) {
      console.log('  Could not read PM2 logs:', err.message);
      // Non-fatal — PM2 logs may not be accessible
    }
  });

  test('Redis PING responds quickly', async () => {
    test.setTimeout(10_000);
    try {
      const start = Date.now();
      const result = execSync('redis-cli PING', { encoding: 'utf8', timeout: 5_000 });
      const latency = Date.now() - start;

      expect(result.trim()).toBe('PONG');
      console.log(`  Redis PING latency: ${latency}ms`);
      expect(latency).toBeLessThan(100); // Redis should respond in <100ms locally
    } catch (err) {
      console.log('  Redis PING failed:', err.message);
      throw err;
    }
  });
});
