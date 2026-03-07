const { test, expect } = require('@playwright/test');
const { BASE_URL, goToLobby } = require('./helpers');

test.describe('Theme Toggle', () => {
  test('default theme is dark', async ({ page }) => {
    await goToLobby(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('toggle to light theme', async ({ page }) => {
    await goToLobby(page);
    await page.click('[aria-label*="Switch to light"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('theme persists across reload', async ({ page }) => {
    await goToLobby(page);
    await page.click('[aria-label*="Switch to light"]');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('toggle back to dark', async ({ page }) => {
    await goToLobby(page);
    // Set to light first
    await page.click('[aria-label*="Switch to light"]');
    // Then back to dark
    await page.click('[aria-label*="Switch to dark"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
