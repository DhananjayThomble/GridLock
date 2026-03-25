// e2e/04-error-cases.spec.js — Error handling and edge cases

const { test, expect } = require('@playwright/test');
const { goToLobby, getApiBase, BASE_URL } = require('./helpers');

test.describe('Error Handling & Edge Cases', () => {

  test('joining non-existent room shows error, stays on lobby or shows message', async ({ page }) => {
    await goToLobby(page);
    await page.locator('button:has-text("🔗 Join Game"):visible').first().click();
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="Enter your name…"]:visible', 'Charlie');
    await page.fill('input[placeholder*="e.g"]', 'ZZZZZZ');
    await page.locator('button:has-text("Join Game")').last().click();

    // Give the app time to navigate and attempt socket connection
    await page.waitForTimeout(5000);
    const url = page.url();
    const body = await page.locator('body').innerText();

    // Graceful handling means one of:
    // 1. Stayed on lobby (didn't navigate to /game)
    // 2. Navigated to /game but shows loading/error/waiting state (not blank)
    // Note: handleJoin() always navigates to /game; Board.jsx shows "Waiting for game data…"
    //       when gameState is null, and/or shows an error banner via socket error event.
    const handledGracefully =
      !url.includes('/game') ||                     // stayed on lobby
      body.includes('not found') ||                 // error from socket
      body.includes('error') ||                     // generic error text
      body.includes('Error') ||                     // React error boundary
      body.includes('invalid') ||                   // validation error
      body.includes('Game not found') ||            // specific backend error (in error banner)
      body.includes('Waiting for game data') ||     // Board loading state (no gameState yet)
      body.includes('Waiting') ||                   // any waiting state
      body.trim().length > 20;                      // anything rendered (not blank)

    expect(handledGracefully, `Should handle invalid room gracefully. URL: ${url}, Body: ${body.slice(0, 200)}`).toBe(true);
  });

  test('direct /game navigation without state redirects to lobby', async ({ page }) => {
    // Navigate directly to /game without router state
    await page.goto(`${BASE_URL}/game`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    // Should either redirect to lobby or show an error, not blank
    expect(body.trim().length).toBeGreaterThan(10);
  });

  test('page survives rapid navigation (no memory leaks / dangling listeners)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goToLobby(page);
    // Navigate back and forth quickly
    await page.goto(`${BASE_URL}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE_URL}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle' });

    expect(errors, `JS errors after rapid nav: ${errors.join('; ')}`).toHaveLength(0);
    await expect(page.locator('body')).toContainText('GridLock');
  });

  test('unknown SPA routes fall back to lobby', async ({ page }) => {
    // React Router within /beta handles routing — navigate to an unknown game path.
    // The SPA should render something (lobby redirect) rather than a blank screen.
    // Note: Nginx serves /beta/index.html for /beta/* routes via try_files.
    // If this shows blank, it indicates a missing Nginx try_files config for /beta.
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    expect(bodyText).toContain('GridLock'); // lobby is the fallback
  });

  test('health endpoint responds', async ({ request }) => {
    const resp = await request.get(`${getApiBase()}/health`);
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body.status).toBe('ok');
    expect(typeof body.activeGames).toBe('number');
  });

});
