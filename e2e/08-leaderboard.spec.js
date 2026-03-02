const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers');

async function goToLeaderboard(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.click('a:has-text("Leaderboard")');
  await page.waitForLoadState('networkidle');
}

test.describe('Leaderboard UI', () => {
  test('renders leaderboard table and player lookup', async ({ page }) => {
    await page.route('**/api/leaderboard?limit=20', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 3,
          leaderboard: [
            { rank: 1, username: 'Alice', wins: 12, losses: 2, draws: 1, winRate: 80, elo: 1250, lastPlayedAt: '2026-03-01T12:00:00.000Z' },
            { rank: 2, username: 'Bob', wins: 11, losses: 3, draws: 1, winRate: 73.33, elo: 1215, lastPlayedAt: '2026-03-01T12:00:00.000Z' },
            { rank: 3, username: 'Cara', wins: 9, losses: 4, draws: 1, winRate: 64.28, elo: 1180, lastPlayedAt: '2026-03-01T12:00:00.000Z' },
          ],
        }),
      });
    });

    await page.route('**/api/leaderboard/Alice', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          player: { rank: 1, username: 'Alice', wins: 12, losses: 2, draws: 1, winRate: 80, elo: 1250 },
        }),
      });
    });

    await goToLeaderboard(page);

    await expect(page.locator('h1')).toContainText('Leaderboard');
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('body')).toContainText('Alice');

    await page.fill('input[aria-label="Search username"]', 'Alice');
    await page.click('button:has-text("Search")');
    await expect(page.locator('body')).toContainText('#1 Alice');
  });

  test('shows error and empty states', async ({ page }) => {
    await page.route('**/api/leaderboard?limit=20', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Failed to fetch leaderboard' }),
      });
    });

    await goToLeaderboard(page);
    await expect(page.locator('body')).toContainText('Could not load leaderboard');

    await page.unroute('**/api/leaderboard?limit=20');
    await page.route('**/api/leaderboard?limit=20', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, count: 0, leaderboard: [] }),
      });
    });

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('No leaderboard data yet');
  });

  test('is usable on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route('**/api/leaderboard?limit=20', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 1,
          leaderboard: [
            { rank: 1, username: 'MobileAce', wins: 3, losses: 1, draws: 0, winRate: 75, elo: 1090, lastPlayedAt: '2026-03-01T12:00:00.000Z' },
          ],
        }),
      });
    });

    await goToLeaderboard(page);

    await expect(page.locator('input[aria-label="Search username"]')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });
});
