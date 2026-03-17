const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers');

test.describe('Nav pill renders in headless chromium', () => {
  test('Lobby + Leaderboard links are visible and navigation works', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const nav = page.locator('nav.app-nav');
    await expect(nav).toBeVisible();

    const lobbyLink = page.getByRole('link', { name: /^Lobby$/ });
    const leaderboardLink = page.getByRole('link', { name: /^Leaderboard$/ });

    await expect(lobbyLink).toBeVisible();
    await expect(leaderboardLink).toBeVisible();

    await leaderboardLink.click();
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible();

    await page.getByRole('link', { name: /^Lobby$/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByPlaceholder('Enter your name…')).toBeVisible();
  });

  test('nav remains visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // On mobile (≤640px), top nav hides Lobby/Leaderboard links via .top-nav-hide-mobile
    // Bottom nav provides navigation instead
    await expect(page.locator('nav.bottom-nav')).toBeVisible();
    await expect(page.locator('nav.bottom-nav').getByText('Lobby')).toBeVisible();
    await expect(page.locator('nav.bottom-nav').getByText('Leaderboard')).toBeVisible();
  });
});
