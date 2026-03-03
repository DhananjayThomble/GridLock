const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers');

const API_BASE = process.env.TEST_API_URL || 'http://127.0.0.1:5105';

test.describe('Leaderboard API + accessibility smoke', () => {
  test('leaderboard endpoint returns JSON payload', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/leaderboard?limit=20`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('leaderboard');
    expect(Array.isArray(body.leaderboard)).toBe(true);
  });

  test('player lookup endpoint responds with either success or not-found JSON', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/leaderboard/__nonexistent_player__`);
    expect([200, 404]).toContain(res.status());

    const body = await res.json();
    expect(body).toHaveProperty('success');
  });

  test('mobile viewport remains usable on lobby', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await expect(page.getByPlaceholder('Enter your name…')).toBeVisible();
    await expect(page.getByRole('button', { name: /create game/i }).first()).toBeVisible();
  });
});
