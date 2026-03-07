// e2e/21-navigation-edge.spec.js — Navigation edge cases

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('Navigation Edge Cases', () => {

  test('direct /game without state redirects to lobby or shows non-blank', async ({ page }) => {
    await page.goto(`${BASE_URL}/game`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const url = page.url();
    const body = await page.locator('body').innerText();

    // Should either redirect away from /game, or show a meaningful state
    const handled = !url.includes('/game') || body.trim().length > 20;
    expect(handled, `Direct /game should redirect or show content. URL: ${url}`).toBe(true);
  });

  test('direct /profile/testuser loads (may show not found)', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile/testuser`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const body = await page.locator('body').innerText();
    expect(body.trim().length).toBeGreaterThan(10);
    // Should show either profile data, loading state, or error
    const hasContent = body.includes('profile') || body.includes('Profile') ||
      body.includes('Loading') || body.includes('error') || body.includes('Error') ||
      body.includes('Failed') || body.includes('Leaderboard') || body.includes('testuser');
    expect(hasContent, `Profile page should show content: ${body.slice(0, 200)}`).toBe(true);
  });

  test('direct /leaderboard loads successfully', async ({ page }) => {
    await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const body = await page.locator('body').innerText();
    expect(body).toContain('Leaderboard');
  });

  test('direct /join/INVALID shows error or handles gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/join/INVALIDCODE`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const body = await page.locator('body').innerText();
    // Should show either error, lobby, or join form — not blank
    expect(body.trim().length).toBeGreaterThan(10);
  });

  test('page refresh on lobby keeps you on lobby', async ({ page }) => {
    await goToLobby(page);
    const bodyBefore = await page.locator('body').innerText();
    expect(bodyBefore).toContain('GridLock');

    await page.reload({ waitUntil: 'networkidle' });
    const bodyAfter = await page.locator('body').innerText();
    expect(bodyAfter).toContain('GridLock');
  });

  test('unknown route /xyz falls back to lobby', async ({ page }) => {
    await page.goto(`${BASE_URL}/xyz`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const body = await page.locator('body').innerText();
    // SPA should render the lobby as fallback
    expect(body).toContain('Lobby');
  });

  test('no JS errors on various direct navigations', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const routes = ['/game', '/leaderboard', '/profile/test', '/join/ABC', '/'];
    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
    }

    expect(errors, `JS errors during navigation: ${errors.join('; ')}`).toHaveLength(0);
  });

});
