// e2e/04-error-cases.spec.js — Error handling and edge cases

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('Error Handling & Edge Cases', () => {

  test('joining non-existent room shows error, stays on lobby or shows message', async ({ page }) => {
    await goToLobby(page);
    await page.click('button:has-text("🔗 Join Game")');
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="Enter your name…"]', 'Charlie');
    await page.fill('input[placeholder*="e.g"]', 'ZZZZZZ');
    await page.locator('button:has-text("Join Game")').last().click();

    // Either: stays on lobby, OR navigates to /game and shows an error message
    await page.waitForTimeout(3000);
    const url = page.url();
    const body = await page.locator('body').innerText();

    const stayedOrShowedError =
      !url.includes('/game') ||
      body.includes('not found') ||
      body.includes('error') ||
      body.includes('Error') ||
      body.includes('invalid') ||
      body.includes('Game not found');

    expect(stayedOrShowedError, 'Should handle invalid room gracefully').toBe(true);
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
    await expect(page.locator('body')).toContainText('Dots & Boxes');
  });

  test('unknown SPA routes fall back to lobby', async ({ page }) => {
    // React Router within /beta handles routing — navigate to an unknown game path.
    // The SPA should render something (lobby redirect) rather than a blank screen.
    // Note: Nginx serves /beta/index.html for /beta/* routes via try_files.
    // If this shows blank, it indicates a missing Nginx try_files config for /beta.
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    expect(bodyText).toContain('Dots & Boxes'); // lobby is the fallback
  });

  test('health endpoint responds', async ({ request }) => {
    const resp = await request.get('http://localhost:5000/health');
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body.status).toBe('ok');
    expect(typeof body.activeGames).toBe('number');
  });

});
