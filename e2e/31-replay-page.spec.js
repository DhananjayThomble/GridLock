// e2e/31-replay-page.spec.js — Game Replay page tests

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

const BASE = process.env.TEST_BASE_URL
  || (process.env.CI ? 'http://localhost:4173' : 'http://localhost/beta');

/**
 * Mock the replay API at route level so we can test the ReplayPage component
 * without needing a real completed game in the database.
 */
function mockReplayData(page, gameId, data) {
  return page.route(`**/api/games/${gameId}/replay`, (route) => {
    route.fulfill({
      status: data ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(
        data || { error: 'Game not found' }
      ),
    });
  });
}

const VALID_REPLAY = {
  gameId: 'TEST01',
  gridSize: 3,
  playerCount: 2,
  players: {
    player1: { username: 'Alice', avatar: '👩', color: '#e74c3c', isCPU: false },
    player2: { username: 'Bob', avatar: '👨', color: '#3498db', isCPU: false },
  },
  moveHistory: [
    { player: 'player1', type: 'h', row: 0, col: 0, timestamp: Date.now() },
    { player: 'player2', type: 'h', row: 0, col: 1, timestamp: Date.now() + 500 },
    { player: 'player1', type: 'v', row: 0, col: 0, timestamp: Date.now() + 1000 },
    { player: 'player2', type: 'v', row: 0, col: 1, timestamp: Date.now() + 1500 },
    { player: 'player1', type: 'h', row: 1, col: 0, timestamp: Date.now() + 2000 },
    // player1 completes a box, gets extra turn
    { player: 'player1', type: 'v', row: 0, col: 2, timestamp: Date.now() + 2500 },
    { player: 'player2', type: 'h', row: 1, col: 1, timestamp: Date.now() + 3000 },
    { player: 'player1', type: 'h', row: 0, col: 2, timestamp: Date.now() + 3500 },
    { player: 'player2', type: 'v', row: 0, col: 3, timestamp: Date.now() + 4000 },
    { player: 'player1', type: 'h', row: 1, col: 2, timestamp: Date.now() + 4500 },
    { player: 'player2', type: 'v', row: 1, col: 0, timestamp: Date.now() + 5000 },
    { player: 'player1', type: 'v', row: 1, col: 1, timestamp: Date.now() + 5500 },
    { player: 'player2', type: 'h', row: 2, col: 0, timestamp: Date.now() + 6000 },
    { player: 'player1', type: 'h', row: 2, col: 1, timestamp: Date.now() + 6500 },
    { player: 'player2', type: 'v', row: 1, col: 2, timestamp: Date.now() + 7000 },
    { player: 'player1', type: 'v', row: 1, col: 3, timestamp: Date.now() + 7500 },
    { player: 'player2', type: 'h', row: 2, col: 2, timestamp: Date.now() + 8000 },
  ],
  scores: { player1: 5, player2: 4 },
  winner: 'player1',
  status: 'completed',
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
};

test.describe('Replay Page', () => {

  test('renders replay page with valid game data', async ({ page }) => {
    await mockReplayData(page, 'TEST01', VALID_REPLAY);
    await page.goto(`${BASE}/replay/TEST01`, { waitUntil: 'networkidle' });

    // Should show "Game Replay" header
    await expect(page.locator('text=Game Replay')).toBeVisible({ timeout: 10_000 });

    // Should show player names
    await expect(page.locator('text=Alice')).toBeVisible();
    await expect(page.locator('text=Bob')).toBeVisible();

    // Should show move counter
    await expect(page.locator(`text=/ ${VALID_REPLAY.moveHistory.length}`)).toBeVisible();
  });

  test('play/pause controls work', async ({ page }) => {
    await mockReplayData(page, 'TEST01', VALID_REPLAY);
    await page.goto(`${BASE}/replay/TEST01`, { waitUntil: 'networkidle' });
    await expect(page.locator('text=Game Replay')).toBeVisible({ timeout: 10_000 });

    // Auto-play starts, so Pause should be visible
    const pauseBtn = page.locator('button[aria-label="Pause"]');
    const playBtn = page.locator('button[aria-label="Play"]');

    // Wait for auto-play to start
    await expect(pauseBtn).toBeVisible({ timeout: 5_000 });

    // Click pause
    await pauseBtn.click();
    await expect(playBtn).toBeVisible({ timeout: 3_000 });

    // Verify move counter is frozen
    const moveText1 = await page.locator('text=/Move \\d+/').innerText();
    await page.waitForTimeout(600);
    const moveText2 = await page.locator('text=/Move \\d+/').innerText();
    expect(moveText1).toBe(moveText2);

    // Click play to resume
    await playBtn.click();
    await expect(pauseBtn).toBeVisible({ timeout: 3_000 });
  });

  test('speed selector cycles through 1x/2x/4x', async ({ page }) => {
    await mockReplayData(page, 'TEST01', VALID_REPLAY);
    await page.goto(`${BASE}/replay/TEST01`, { waitUntil: 'networkidle' });
    await expect(page.locator('text=Game Replay')).toBeVisible({ timeout: 10_000 });

    // Pause first so we can inspect speed buttons
    const pauseBtn = page.locator('button[aria-label="Pause"]');
    await expect(pauseBtn).toBeVisible({ timeout: 5_000 });
    await pauseBtn.click();

    // Default speed is 1x
    const speedBtn = page.locator('button[aria-label*="Speed"]');
    await expect(speedBtn).toContainText('1x');

    // Click to cycle to 2x
    await speedBtn.click();
    await expect(speedBtn).toContainText('2x');

    // Click to cycle to 4x
    await speedBtn.click();
    await expect(speedBtn).toContainText('4x');

    // Click again wraps to 1x
    await speedBtn.click();
    await expect(speedBtn).toContainText('1x');
  });

  test('move counter updates as replay progresses', async ({ page }) => {
    await mockReplayData(page, 'TEST01', VALID_REPLAY);
    await page.goto(`${BASE}/replay/TEST01`, { waitUntil: 'networkidle' });
    await expect(page.locator('text=Game Replay')).toBeVisible({ timeout: 10_000 });

    // Wait for a few moves to play
    await page.waitForTimeout(2000);

    // Move counter should be > 0
    const moveText = await page.locator('text=/Move \\d+/').innerText();
    const match = moveText.match(/Move (\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match[1])).toBeGreaterThan(0);
  });

  test('"Play GridLock" CTA button links to lobby', async ({ page }) => {
    await mockReplayData(page, 'TEST01', VALID_REPLAY);
    await page.goto(`${BASE}/replay/TEST01`, { waitUntil: 'networkidle' });
    await expect(page.locator('text=Game Replay')).toBeVisible({ timeout: 10_000 });

    const ctaBtn = page.locator('button:has-text("Play GridLock")');
    await expect(ctaBtn).toBeVisible();

    await ctaBtn.click();
    await page.waitForURL(/\/$/, { timeout: 10_000 });
    // Should land on lobby
    await expect(page.locator('body')).toContainText('GridLock');
  });

  test('invalid replay ID shows error/404 state', async ({ page }) => {
    await mockReplayData(page, 'INVALID', null);
    await page.goto(`${BASE}/replay/INVALID`, { waitUntil: 'networkidle' });

    // Should show error state
    await expect(page.locator('text=/Game Not Found|not found|Something went wrong/i')).toBeVisible({ timeout: 10_000 });

    // Should show "Play GridLock" button to navigate away
    const ctaBtn = page.locator('button:has-text("Play GridLock")');
    await expect(ctaBtn).toBeVisible();
  });

});
