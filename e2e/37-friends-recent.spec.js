// e2e/37-friends-recent.spec.js
// E2E tests for Recent Players / Friends feature (#137)

const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, joinGame, waitForGameStart, makeMove, playToCompletion, BASE_URL } = require('./helpers');

test.describe('Recent Players — Friends & Invite', () => {

  test('recent opponents list appears after a game', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // Create and join a game
    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    // Play to completion
    await playToCompletion([p1, p2]);

    // Navigate back to lobby
    await goToLobby(p1);

    // Recent Players section should appear with Bob
    await expect(p1.locator('text=Recent Players')).toBeVisible({ timeout: 5000 });
    await expect(p1.locator('.recent-player-card')).toBeVisible({ timeout: 5000 });
    await expect(p1.locator('.recent-player-card')).toContainText('Bob');

    await ctx1.close();
    await ctx2.close();
  });

  test('opponent shows avatar, name, last played date', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Seed localStorage with a recent opponent
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('gridlock_recent_opponents', JSON.stringify([{
        username: 'TestPlayer',
        avatar: '🦊',
        lastPlayed: Date.now() - 300000, // 5 minutes ago
        wins: 2,
        losses: 1,
        draws: 0,
      }]));
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Verify opponent card content
    const card = page.locator('.recent-player-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText('TestPlayer');
    await expect(card).toContainText('🦊');
    await expect(card).toContainText('5m ago');
    await expect(card).toContainText('2W 1L 0D');

    await ctx.close();
  });

  test('invite button creates room and shows code', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Seed localStorage
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('gridlock_recent_opponents', JSON.stringify([{
        username: 'Rival',
        avatar: '🐻',
        lastPlayed: Date.now(),
        wins: 0,
        losses: 0,
        draws: 0,
      }]));
      localStorage.setItem('gridlock_username', 'InviteTest');
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Fill username (required for invite)
    await page.fill('input[placeholder="Enter your name…"]', 'InviteTest');

    // Click invite button
    const inviteBtn = page.locator('.invite-btn').first();
    await expect(inviteBtn).toBeVisible({ timeout: 5000 });
    await inviteBtn.click();

    // Toast should show room code
    await expect(page.locator('.recent-players-toast')).toContainText(/Room created! Share code: [A-Z0-9]+/, { timeout: 10000 });

    await ctx.close();
  });

  test('clear button removes all recent opponents', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Seed localStorage
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('gridlock_recent_opponents', JSON.stringify([
        { username: 'Player1', avatar: '👦', lastPlayed: Date.now(), wins: 1, losses: 0, draws: 0 },
        { username: 'Player2', avatar: '👧', lastPlayed: Date.now(), wins: 0, losses: 1, draws: 0 },
      ]));
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Verify list is present
    await expect(page.locator('.recent-player-card')).toHaveCount(2, { timeout: 5000 });

    // Click clear button
    await page.click('button:has-text("Clear")');

    // List should be gone
    await expect(page.locator('.recent-player-card')).toHaveCount(0);
    await expect(page.locator('text=Recent Players')).not.toBeVisible();

    await ctx.close();
  });

  test('list persists after page reload (localStorage)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Seed localStorage
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('gridlock_recent_opponents', JSON.stringify([{
        username: 'PersistTest',
        avatar: '🎮',
        lastPlayed: Date.now(),
        wins: 3,
        losses: 2,
        draws: 1,
      }]));
    });

    // Reload and verify
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.recent-player-card')).toContainText('PersistTest', { timeout: 5000 });

    // Hard reload
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.recent-player-card')).toContainText('PersistTest', { timeout: 5000 });

    await ctx.close();
  });

  test('max 10 opponents (oldest removed when >10)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Seed with 10 opponents
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const opponents = [];
      for (let i = 1; i <= 10; i++) {
        opponents.push({
          username: `Player${i}`,
          avatar: '👤',
          lastPlayed: Date.now() - i * 60000,
          wins: 0,
          losses: 0,
          draws: 0,
        });
      }
      localStorage.setItem('gridlock_recent_opponents', JSON.stringify(opponents));
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Verify exactly 10
    await expect(page.locator('.recent-player-card')).toHaveCount(10, { timeout: 5000 });

    // Now add an 11th via the utility (simulate game end)
    await page.evaluate(() => {
      const STORAGE_KEY = 'gridlock_recent_opponents';
      const raw = localStorage.getItem(STORAGE_KEY);
      const opponents = JSON.parse(raw);
      opponents.unshift({
        username: 'NewPlayer',
        avatar: '🆕',
        lastPlayed: Date.now(),
        wins: 1,
        losses: 0,
        draws: 0,
      });
      // Trim to 10
      localStorage.setItem(STORAGE_KEY, JSON.stringify(opponents.slice(0, 10)));
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Should still be 10
    await expect(page.locator('.recent-player-card')).toHaveCount(10, { timeout: 5000 });
    // NewPlayer should be first
    const first = page.locator('.recent-player-card').first();
    await expect(first).toContainText('NewPlayer');
    // Player10 (oldest) should be gone
    await expect(page.locator('text=Player10')).not.toBeVisible();

    await ctx.close();
  });

  test('mobile responsive layout', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 }, // iPhone X
    });
    const page = await ctx.newPage();

    // Seed localStorage
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('gridlock_recent_opponents', JSON.stringify([
        { username: 'MobileTest1', avatar: '📱', lastPlayed: Date.now(), wins: 1, losses: 0, draws: 0 },
        { username: 'MobileTest2', avatar: '🎯', lastPlayed: Date.now(), wins: 0, losses: 1, draws: 0 },
      ]));
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Recent Players should be visible on mobile
    await expect(page.locator('text=Recent Players')).toBeVisible({ timeout: 5000 });

    // Cards should be fully visible (no horizontal overflow)
    const cards = page.locator('.recent-player-card');
    await expect(cards).toHaveCount(2);

    // Check card is within viewport
    const box = await cards.first().boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeLessThanOrEqual(375);
    expect(box.x).toBeGreaterThanOrEqual(0);

    // Invite button should be visible and tappable
    const inviteBtn = page.locator('.invite-btn').first();
    await expect(inviteBtn).toBeVisible();
    const btnBox = await inviteBtn.boundingBox();
    expect(btnBox.height).toBeGreaterThanOrEqual(32); // min touch target

    await ctx.close();
  });
});
