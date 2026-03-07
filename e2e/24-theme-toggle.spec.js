const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4173';

test.describe('Theme Toggle', () => {
  test('default theme is dark', async ({ page }) => {
    await page.goto(BASE);
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('dark');
  });

  test('toggle to light theme', async ({ page }) => {
    await page.goto(BASE);
    await page.click('[aria-label*="Switch to light"]');
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('light');
  });

  test('theme persists across reload', async ({ page }) => {
    await page.goto(BASE);
    await page.click('[aria-label*="Switch to light"]');
    await page.reload();
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('light');
  });

  test('toggle back to dark', async ({ page }) => {
    await page.goto(BASE);
    // Set to light first
    await page.click('[aria-label*="Switch to light"]');
    // Then back to dark
    await page.click('[aria-label*="Switch to dark"]');
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('dark');
  });
});
