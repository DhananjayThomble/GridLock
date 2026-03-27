// e2e/12-invite-links.spec.js — invite link flow E2E tests
const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, BASE_URL } = require('./helpers');

test.describe('Invite Links', () => {
  test('Join page renders with game ID from URL', async ({ page }) => {
    // Room codes are 6-char hex (A-F, 0-9) since v1.3.0
    const testGameId = 'AB12CD';
    await page.goto(`${BASE_URL}/join/${testGameId}`, { waitUntil: 'networkidle' });

    // Game ID displayed
    await expect(page.locator(`text=${testGameId}`)).toBeVisible();

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
    // v1.3.0: Room codes are validated client-side as 6-char hex (A-F, 0-9).
    // Invalid format triggers an immediate permanentError state with
    // "🔄 Try Again" and "🏠 Find Another Game" buttons (no input/join shown).
    await page.goto(`${BASE_URL}/join/INVALID123`, { waitUntil: 'networkidle' });

    // Error message should be visible immediately (client-side validation)
    await expect(page.locator('text=Invalid room code format')).toBeVisible({ timeout: 5_000 });

    // "Find Another Game" button navigates to lobby
    await expect(page.getByRole('button', { name: /Find Another Game/i })).toBeVisible({ timeout: 5_000 });
  });

  test('Copy invite link from Board', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Grant clipboard permissions
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);

    await goToLobby(page);
    const roomCode = await createGame(page, { username: 'CopyHost', playerCount: 2, gridSize: '3×3' });
    expect(roomCode).toBeTruthy();

    // v1.3.0: Human games land in WaitingRoom (/waiting/:gameId).
    // WaitingRoom has "📤 Share Invite Link" (desktop) / "📤 Share" (mobile).
    // Board has "📎 Copy Invite Link" (only if waiting for players).
    // Also try the "📋 Copy Code" button as fallback.
    const shareBtn = page.getByRole('button', { name: /Share Invite Link/i });
    const copyInviteBtn = page.getByRole('button', { name: /Copy Invite Link/i });
    const copyCodeBtn = page.getByRole('button', { name: /Copy Code/i });

    // Wait for any of the share/copy buttons to appear
    const visibleBtn = await Promise.race([
      shareBtn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => shareBtn),
      copyInviteBtn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => copyInviteBtn),
      copyCodeBtn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => copyCodeBtn),
    ]);

    await visibleBtn.click();

    // Check clipboard contains the invite URL or game code
    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipText.toLowerCase()).toContain(roomCode.toLowerCase());

    await ctx.close();
  });
});
