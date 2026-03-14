// e2e/36-prometheus-metrics.spec.js — Prometheus /metrics endpoint tests

const { test, expect } = require('@playwright/test');
const { getApiBase, goToLobby, createGame, BASE_URL } = require('./helpers');

test.describe('Prometheus /metrics endpoint', () => {

  test('GET /metrics returns 200 with prom-client format', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/metrics`);
    expect(resp.ok()).toBe(true);
    const contentType = resp.headers()['content-type'];
    expect(contentType).toMatch(/text\/plain|text\/openmetrics/);
    const body = await resp.text();
    // prom-client format uses HELP and TYPE directives
    expect(body).toContain('# HELP');
    expect(body).toContain('# TYPE');
  });

  test('contains default Node.js metrics', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/metrics`);
    const body = await resp.text();
    // Default prom-client Node.js metrics
    expect(body).toContain('process_cpu_seconds_total');
    expect(body).toContain('nodejs_heap_size_total_bytes');
  });

  test('contains custom gridlock_active_games gauge', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/metrics`);
    const body = await resp.text();
    expect(body).toContain('# HELP gridlock_active_games');
    expect(body).toContain('# TYPE gridlock_active_games gauge');
    const match = body.match(/^gridlock_active_games\s+(\d+)/m);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThanOrEqual(0);
  });

  test('contains custom gridlock_connected_sockets gauge', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/metrics`);
    const body = await resp.text();
    expect(body).toContain('# HELP gridlock_connected_sockets');
    expect(body).toContain('# TYPE gridlock_connected_sockets gauge');
    const match = body.match(/^gridlock_connected_sockets\s+(\d+)/m);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThanOrEqual(0);
  });

  test('contains custom gridlock_http_requests_total counter', async ({ request }) => {
    // Make a request first to ensure the counter has entries
    await request.get(`${getApiBase()}/health`);
    const resp = await request.get(`${getApiBase()}/metrics`);
    const body = await resp.text();
    expect(body).toContain('# HELP gridlock_http_requests_total');
    expect(body).toContain('# TYPE gridlock_http_requests_total counter');
    // Should have at least one labeled entry (from the /health request above)
    expect(body).toMatch(/gridlock_http_requests_total\{/);
  });

  test('contains gridlock_game_duration_seconds histogram with buckets', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/metrics`);
    const body = await resp.text();
    expect(body).toContain('# HELP gridlock_game_duration_seconds');
    expect(body).toContain('# TYPE gridlock_game_duration_seconds histogram');
    // Histograms expose _bucket, _sum, _count
    expect(body).toMatch(/gridlock_game_duration_seconds_bucket\{le="/);
    expect(body).toContain('gridlock_game_duration_seconds_sum');
    expect(body).toContain('gridlock_game_duration_seconds_count');
  });

  test('contains gridlock_games_completed_total counter', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/metrics`);
    const body = await resp.text();
    expect(body).toContain('# HELP gridlock_games_completed_total');
    expect(body).toContain('# TYPE gridlock_games_completed_total counter');
  });

  test('gridlock_active_games increases after creating a game', async ({ request, page }) => {
    // Get baseline
    const before = await request.get(`${getApiBase()}/metrics`);
    const beforeBody = await before.text();
    const beforeMatch = beforeBody.match(/^gridlock_active_games\s+(\d+)/m);
    const beforeCount = beforeMatch ? Number(beforeMatch[1]) : 0;

    // Create a game
    await goToLobby(page, BASE_URL);
    await createGame(page, { username: 'MetricsTest', playerCount: 2, gridSize: '3×3' });

    // Check metrics again
    const after = await request.get(`${getApiBase()}/metrics`);
    const afterBody = await after.text();
    const afterMatch = afterBody.match(/^gridlock_active_games\s+(\d+)/m);
    const afterCount = afterMatch ? Number(afterMatch[1]) : 0;

    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test('gridlock_http_requests_total increments after HTTP requests', async ({ request }) => {
    // Get baseline
    const before = await request.get(`${getApiBase()}/metrics`);
    const beforeBody = await before.text();

    // Make several requests to /health
    await request.get(`${getApiBase()}/health`);
    await request.get(`${getApiBase()}/health`);

    // Get updated metrics
    const after = await request.get(`${getApiBase()}/metrics`);
    const afterBody = await after.text();

    // Extract total count of all http_requests_total lines
    const sumEntries = (text) => {
      const matches = text.matchAll(/gridlock_http_requests_total\{[^}]*\}\s+([\d.]+)/g);
      let sum = 0;
      for (const m of matches) sum += Number(m[1]);
      return sum;
    };

    expect(sumEntries(afterBody)).toBeGreaterThan(sumEntries(beforeBody));
  });

});
