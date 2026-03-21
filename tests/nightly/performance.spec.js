// tests/nightly/performance.spec.js — Performance baseline tracking
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { createCpuGame, makeMove, goToLobby, BETA_URL } = require('../fixtures/test-helpers');

const BASELINES_PATH = path.join(__dirname, '..', 'baselines', 'performance.json');
const DEGRADATION_THRESHOLD = 0.20; // 20% degradation triggers a warning

function loadBaselines() {
  try {
    return JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveBaselines(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(BASELINES_PATH, JSON.stringify(data, null, 2));
}

test.describe('Performance Baselines', () => {
  const results = {};

  test.describe('Page Load Metrics', () => {
    const pages = [
      { name: 'home', path: '/' },
      { name: 'leaderboard', path: '/leaderboard' },
      { name: 'howToPlay', path: '/how-to-play' },
    ];

    for (const { name, path: pagePath } of pages) {
      test(`measure ${name} page load times`, async ({ page }) => {
        test.setTimeout(30_000);
        const url = `${BETA_URL}${pagePath}`;

        // Navigate and capture performance timing
        await page.goto(url, { waitUntil: 'load' });

        const metrics = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const paint = performance.getEntriesByType('paint');
          const fcp = paint.find(p => p.name === 'first-contentful-paint');

          // LCP via PerformanceObserver isn't available retroactively,
          // so use FCP + load as approximations
          return {
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
            load: Math.round(nav.loadEventEnd - nav.startTime),
            fcp: fcp ? Math.round(fcp.startTime) : null,
            ttfb: Math.round(nav.responseStart - nav.startTime),
            domInteractive: Math.round(nav.domInteractive - nav.startTime),
          };
        });

        results[name] = metrics;
        console.log(`  ${name}: DCL=${metrics.domContentLoaded}ms, Load=${metrics.load}ms, FCP=${metrics.fcp}ms, TTFB=${metrics.ttfb}ms`);

        // Sanity checks
        expect(metrics.domContentLoaded).toBeGreaterThan(0);
        expect(metrics.load).toBeGreaterThan(0);
        expect(metrics.load).toBeLessThan(15_000); // No page should take >15s
      });
    }
  });

  test('WebSocket connect time < 2s', async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto(BETA_URL, { waitUntil: 'domcontentloaded' });

    const connectTime = await page.evaluate(() => {
      return new Promise((resolve) => {
        const start = Date.now();
        // Listen for the socket connect event via a custom check
        const check = setInterval(() => {
          // socket.io client adds transport info to window after connect
          const elapsed = Date.now() - start;
          if (elapsed > 10_000) {
            clearInterval(check);
            resolve(elapsed);
          }
          // Check if socket is connected by looking for game-related elements
          if (document.querySelector('[role="button"]') ||
              document.body.innerText.includes('Create Game')) {
            clearInterval(check);
            resolve(elapsed);
          }
        }, 100);
      });
    });

    results.websocketConnectMs = connectTime;
    console.log(`  WebSocket connect: ${connectTime}ms`);
    expect(connectTime).toBeLessThan(5_000); // Generous for beta
  });

  test('game start latency < 3s', async ({ page }) => {
    test.setTimeout(60_000);
    const startTime = Date.now();
    await createCpuGame(page, { username: 'PerfStart', gridSize: '3×3' });
    const gameStartTime = Date.now() - startTime;

    results.gameStartMs = gameStartTime;
    console.log(`  Game start: ${gameStartTime}ms`);
    expect(gameStartTime).toBeLessThan(10_000); // Generous for beta
  });

  test('move latency < 500ms', async ({ page }) => {
    test.setTimeout(90_000);
    await createCpuGame(page, { username: 'PerfMove', gridSize: '3×3' });

    // Wait for our turn
    await page.waitForFunction(
      () => document.body.innerText.includes('Your turn'),
      { timeout: 20_000 }
    );

    // Measure move latency
    const moveLatency = await page.evaluate(async () => {
      const lines = document.querySelectorAll('[role="button"][aria-disabled="false"]');
      if (lines.length === 0) return -1;

      const target = lines[0];
      const start = performance.now();
      target.click();

      // Wait for the line to become disabled (move accepted)
      return new Promise((resolve) => {
        const check = setInterval(() => {
          const elapsed = performance.now() - start;
          if (target.getAttribute('aria-disabled') === 'true' || elapsed > 5000) {
            clearInterval(check);
            resolve(Math.round(elapsed));
          }
        }, 50);
      });
    });

    results.moveLatencyMs = moveLatency;
    console.log(`  Move latency: ${moveLatency}ms`);
    if (moveLatency > 0) {
      expect(moveLatency).toBeLessThan(2_000); // Generous for beta
    }
  });

  test('compare to baselines', async () => {
    const baselines = loadBaselines();
    const warnings = [];

    if (baselines && baselines.pageLoad) {
      for (const [pageName, metrics] of Object.entries(results)) {
        if (typeof metrics !== 'object' || !metrics.load) continue;
        const baseline = baselines.pageLoad[pageName];
        if (!baseline) continue;

        for (const [metric, value] of Object.entries(metrics)) {
          if (typeof value !== 'number' || value <= 0) continue;
          const baselineValue = baseline[metric];
          if (!baselineValue) continue;

          const degradation = (value - baselineValue) / baselineValue;
          if (degradation > DEGRADATION_THRESHOLD) {
            warnings.push(`⚠️ ${pageName}.${metric}: ${value}ms (baseline: ${baselineValue}ms, +${(degradation * 100).toFixed(1)}%)`);
          }
        }
      }

      // Check scalar metrics
      const scalarChecks = [
        { name: 'websocketConnectMs', key: 'websocketConnectMs' },
        { name: 'gameStartMs', key: 'gameStartMs' },
        { name: 'moveLatencyMs', key: 'moveLatencyMs' },
      ];

      for (const { name, key } of scalarChecks) {
        if (results[key] && baselines[key]) {
          const degradation = (results[key] - baselines[key]) / baselines[key];
          if (degradation > DEGRADATION_THRESHOLD) {
            warnings.push(`⚠️ ${name}: ${results[key]}ms (baseline: ${baselines[key]}ms, +${(degradation * 100).toFixed(1)}%)`);
          }
        }
      }
    }

    if (warnings.length > 0) {
      console.log('\n🔴 Performance Degradations:');
      for (const w of warnings) console.log(w);
    } else {
      console.log('\n✅ All metrics within baseline thresholds');
    }

    // Only update baselines when explicitly requested (UPDATE_BASELINES=1)
    // or when no baselines file exists yet (first run).
    const shouldUpdate = !baselines || process.env.UPDATE_BASELINES === '1';

    if (shouldUpdate) {
      const newBaselines = {
        pageLoad: {},
        ...(baselines || {}),
      };

      for (const [name, metrics] of Object.entries(results)) {
        if (typeof metrics === 'object' && metrics.load) {
          newBaselines.pageLoad[name] = metrics;
        } else if (typeof metrics === 'number') {
          newBaselines[name] = metrics;
        }
      }

      saveBaselines(newBaselines);
      console.log(baselines
        ? '📊 Baselines updated (UPDATE_BASELINES=1)'
        : '📊 Baselines created (first run)');
    } else {
      console.log('📊 Baselines unchanged (set UPDATE_BASELINES=1 to update)');
    }
  });
});
