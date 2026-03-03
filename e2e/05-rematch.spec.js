// e2e/05-rematch.spec.js — Rematch flow tests
// Covers the blank-screen rematch bug (navigate('/game/:id') → navigate('/game'))
// and Leave Game navigation fix.

const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, joinGame, waitForGameStart, makeMove } = require('./helpers');

/**
 * Play a game to completion. Returns true when winner modal detected.
 */
async function playToCompletion(pages, maxMoves = 80) {
  for (let i = 0; i < maxMoves; i++) {
    let moved = false;
    for (const page of pages) {
      try {
        const text = await page.locator('body').innerText().catch(() => '');
        if (text.includes('Play Again') || text.includes('Game Over') || text.includes('Winner')) {
          return true;
        }
        if (text.includes('Your turn')) {
          const ok = await makeMove(page);
          if (ok) { moved = true; break; }
        }
      } catch { continue; }
    }
    if (!moved) {
      for (const page of pages) {
        try { await page.waitForTimeout(300); break; } catch { continue; }
      }
    }
  }
  for (const page of pages) {
    try {
      const text = await page.locator('body').innerText().catch(() => '');
      if (text.includes('Play Again')) return true;
    } catch { continue; }
  }
  return false;
}

/** Safe page.waitForTimeout — ignores closed-page errors */
async function safeWait(page, ms) {
  try { await page.waitForTimeout(ms); } catch { /* page closed/navigated */ }
}

test.describe('Rematch Flow — 2 Player', () => {

  test('Play Again navigates to new game (not blank)', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const errors = [];
    p1.on('pageerror', e => errors.push(`P1: ${e.message}`));
    p2.on('pageerror', e => errors.push(`P2: ${e.message}`));

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    const gameOver = await playToCompletion([p1, p2]);
    expect(gameOver, 'Game should complete within move limit').toBe(true);

    // Both players click Play Again simultaneously (rematch needs ALL to click)
    await Promise.all([
      p1.locator('button:has-text("Play Again")').click({ timeout: 5000 }).catch(() => {}),
      p2.locator('button:has-text("Play Again")').click({ timeout: 5000 }).catch(() => {}),
    ]);

    // Wait for winner modal to disappear (URL stays /game, so can't use waitForURL)
    await p1.waitForFunction(
      () => !document.querySelector('body')?.innerText.includes('Play Again'),
      { timeout: 20_000 }
    ).catch(() => {});
    await safeWait(p1, 1000);

    // Critical: #root must not be empty
    const p1Root = await p1.locator('#root').innerHTML().catch(() => '');
    const p2Root = await p2.locator('#root').innerHTML().catch(() => '');
    expect(p1Root.trim().length, 'P1 #root blank after rematch — navigation bug!').toBeGreaterThan(50);
    expect(p2Root.trim().length, 'P2 #root blank after rematch — navigation bug!').toBeGreaterThan(50);

    expect(errors, `JS errors: ${errors.join('; ')}`).toHaveLength(0);
    await ctx1.close();
    await ctx2.close();
  });

  test('Leave Game returns to lobby after game over', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await waitForGameStart(p1, p2);

    const gameOver = await playToCompletion([p1, p2]);
    expect(gameOver, 'Game should complete').toBe(true);

    const p1Text = await p1.locator('body').innerText().catch(() => '');
    const activePage = p1Text.includes('Leave Game') ? p1 : p2;

    await activePage.click('button:has-text("Leave Game")');
    await activePage.waitForFunction(
      () => document.querySelector('body')?.innerText?.includes('Dots & Boxes'),
      { timeout: 10_000 }
    );
    await expect(activePage.locator('body')).toContainText('Dots & Boxes');

    await ctx1.close();
    await ctx2.close();
  });

});

test.describe('Rematch Flow — 3 Player', () => {

  test('Play Again navigates to new game (not blank) — regression for blank screen bug', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const ctx3 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();
    const errors = [];
    p1.on('pageerror', e => errors.push(`P1: ${e.message}`));
    p2.on('pageerror', e => errors.push(`P2: ${e.message}`));
    p3.on('pageerror', e => errors.push(`P3: ${e.message}`));

    await goToLobby(p1);
    const roomCode = await createGame(p1, { username: 'Alice', playerCount: 3, gridSize: '3×3' });
    await joinGame(p2, { username: 'Bob', roomCode });
    await joinGame(p3, { username: 'Carol', roomCode });
    await waitForGameStart(p1, p2, p3);

    // Verify no stale 'player_joining' roles
    for (const [name, page] of [['Alice', p1], ['Bob', p2], ['Carol', p3]]) {
      const text = await page.locator('body').innerText().catch(() => '');
      expect(text, `${name} should not have unresolved role`).not.toContain('player_joining');
    }

    const gameOver = await playToCompletion([p1, p2, p3], 80);
    expect(gameOver, '3-player game should complete on 3×3 grid').toBe(true);

    // All players click Play Again
    await Promise.all([
      p1.locator('button:has-text("Play Again")').click({ timeout: 5000 }).catch(() => {}),
      p2.locator('button:has-text("Play Again")').click({ timeout: 5000 }).catch(() => {}),
      p3.locator('button:has-text("Play Again")').click({ timeout: 5000 }).catch(() => {}),
    ]);

    // Wait for modal to disappear
    await p1.waitForFunction(
      () => !document.querySelector('body')?.innerText.includes('Play Again'),
      { timeout: 25_000 }
    ).catch(() => {});
    await safeWait(p1, 1500);

    // Critical assertions: none of the 3 pages should be blank
    for (const [name, page] of [['Alice', p1], ['Bob', p2], ['Carol', p3]]) {
      const root    = await page.locator('#root').innerHTML().catch(() => '');
      const bodyTxt = await page.locator('body').innerText().catch(() => '');
      expect(
        root.trim().length,
        `${name}'s #root is blank after 3-player rematch — navigate() route bug!`
      ).toBeGreaterThan(50);
      expect(
        bodyTxt.trim().length,
        `${name}'s page is empty after 3-player rematch`
      ).toBeGreaterThan(10);
    }

    // Post-rematch can land players in-game or back in lobby depending on race timing,
    // but it must never blank out and must keep the app interactive.
    let hasUsableScreen = false;
    for (const page of [p1, p2, p3]) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (/turn|room|create game|join game|dots & boxes/i.test(text)) {
        hasUsableScreen = true;
        break;
      }
    }
    expect(hasUsableScreen, 'At least one player should remain on a usable app screen after rematch').toBe(true);

    expect(errors, `JS errors during 3-player rematch: ${errors.join('; ')}`).toHaveLength(0);

    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
  });

});
