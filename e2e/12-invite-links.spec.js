// e2e/12-invite-links.spec.js — invite link flow E2E tests
const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, BASE_URL } = require('./helpers');

test.describe('Invite Links', () => {
  test('Join page renders with game ID from URL', async ({ page }) => {
    await page.goto(`${BASE_URL}/join/TESTGAME`, { waitUntil: 'networkidle' });

    // Game ID displayed
    await expect(page.locator('text=TESTGAME')).toBeVisible();

    // Username input visible
    await expect(page.locator('input[placeholder="Enter your name…"]:visible')).toBeVisible();

    // Join Game button visible
    await expect(page.getByRole('button', { name: /Join Game/i })).toBeVisible();
  });

  test('Can join a game via invite link', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    // Player 1: create game via Lobby
    await goToLobby(page1);
    const roomCode = await createGame(page1, { username: 'InviteHost', playerCount: 2, gridSize: '3×3' });
    expect(roomCode).toBeTruthy();

    // Player 2: join via invite link
    await page2.goto(`${BASE_URL}/join/${roomCode}`, { waitUntil: 'networkidle' });
    await expect(page2.locator(`text=${roomCode}`)).toBeVisible();
    await page2.fill('input[placeholder="Enter your name…"]:visible', 'InviteGuest');
    await page2.getByRole('button', { name: /Join Game/i }).click();

    // Player 2 should navigate to /game
    await page2.waitForURL(/\/game/, { timeout: 15_000 });

    // Both players should see the game board
    await Promise.all([
      page1.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 }),
      page2.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 }),
    ]);

    await ctx1.close();
    await ctx2.close();
  });

  test('Error handling for invalid game ID', async ({ page }) => {
    await page.goto(`${BASE_URL}/join/INVALID123`, { waitUntil: 'networkidle' });
    await page.fill('input[placeholder="Enter your name…"]:visible', 'ErrorTest');
    await page.getByRole('button', { name: /Join Game/i }).click();

    // Should show an error — the error container uses inline styles with --danger CSS var
    // Match by the "Go to Lobby" button that appears in the error block
    await expect(page.getByRole('button', { name: 'Go to Lobby', exact: true })).toBeVisible({ timeout: 12_000 });
  });

  test('Copy invite link from Board', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Grant clipboard permissions
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);

    await goToLobby(page);
    const roomCode = await createGame(page, { username: 'CopyHost', playerCount: 2, gridSize: '3×3' });
    expect(roomCode).toBeTruthy();

    // With waiting room flow, non-CPU games land on /waiting/:gameId
    // Look for Share Invite Link (waiting room) or Copy Invite Link (board)
    const shareBtn = page.getByRole('button', { name: /Share Invite Link/i });
    const copyBtn = page.getByRole('button', { name: /Copy Invite Link/i });
    const isWaitingRoom = await shareBtn.isVisible().catch(() => false);
    const inviteBtn = isWaitingRoom ? shareBtn : copyBtn;
    await expect(inviteBtn).toBeVisible({ timeout: 10_000 });

    // Click the share/copy button
    await inviteBtn.click();

    // Check clipboard contains the invite URL or game code
    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipText.toLowerCase()).toContain(roomCode.toLowerCase());

    await ctx.close();
  });
});
