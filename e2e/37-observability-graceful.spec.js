// e2e/37-observability-graceful.spec.js — Health endpoint & graceful degradation tests

const { test, expect } = require('@playwright/test');
const { getApiBase, goToLobby, BASE_URL } = require('./helpers');

test.describe('Health endpoint & observability', () => {

  test('health endpoint returns proper JSON structure', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/health`);
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body.status).toBe('ok');
    expect(typeof body.activeGames).toBe('number');
  });

  test('health endpoint includes Redis status field', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/health`);
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    // Redis adapter status should be present
    expect(body).toHaveProperty('redisAdapter');
  });

  test('health endpoint response time is reasonable', async ({ request }) => {
    const start = Date.now();
    const resp = await request.get(`${getApiBase()}/health`);
    const elapsed = Date.now() - start;
    expect(resp.ok()).toBe(true);
    // Health check should respond within 2 seconds
    expect(elapsed).toBeLessThan(2000);
  });

});

test.describe('Graceful degradation without Sentry/PostHog', () => {

  test('app loads without Sentry/PostHog env vars — no JS errors', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await goToLobby(page, BASE_URL);

    // Wait a moment for any deferred JS to execute
    await page.waitForTimeout(2000);

    // Filter out errors related to Sentry or PostHog
    const sentryPosthogErrors = jsErrors.filter(
      (msg) => /sentry|posthog/i.test(msg)
    );
    expect(sentryPosthogErrors).toHaveLength(0);
  });

  test('no console errors about missing Sentry/PostHog config', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await goToLobby(page, BASE_URL);
    await page.waitForTimeout(2000);

    const relevantErrors = consoleErrors.filter(
      (msg) => /sentry|posthog|SENTRY_DSN|POSTHOG_KEY/i.test(msg)
    );
    expect(relevantErrors).toHaveLength(0);
  });

  test('ErrorBoundary does not interfere with normal rendering', async ({ page }) => {
    await goToLobby(page, BASE_URL);

    // Verify main UI elements render correctly
    await expect(page.locator('body')).toContainText('GridLock');
    // The lobby should have the create game button
    await expect(page.locator('button:has-text("🚀 Create Game"):visible').first()).toBeVisible();
    // Join game button should be visible
    await expect(page.locator('button:has-text("🔗 Join Game"):visible').first()).toBeVisible();
  });

  test('frontend loads cleanly — core functionality works', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await goToLobby(page, BASE_URL);

    // Fill in a name and verify interaction works
    await page.fill('input[placeholder="Enter your name…"]:visible', 'GracefulTest');
    await expect(page.locator('input[placeholder="Enter your name…"]:visible')).toHaveValue('GracefulTest');

    // Click player count button to verify interactivity
    await page.locator('button:has-text("2 Players"):visible').first().click();

    // No critical JS errors
    const criticalErrors = jsErrors.filter(
      (msg) => !/ResizeObserver|favicon/i.test(msg)
    );
    expect(criticalErrors).toHaveLength(0);
  });

});
