// e2e/helpers.js — shared utilities for all E2E tests

const { expect } = require('@playwright/test');

const BASE_URL = process.env.TEST_BASE_URL
  || (process.env.CI ? 'http://localhost:4173' : 'http://localhost/beta');

/**
 * Navigate to the lobby and wait for it to be ready.
 */
async function goToLobby(page, baseUrl = BASE_URL) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('Dots & Boxes');
}

/**
 * Fill lobby form and create a game. Returns the room code.
 */
async function createGame(page, { username = 'Alice', playerCount = 2, gridSize = '3×3' } = {}) {
  await page.fill('input[placeholder="Enter your name…"]', username);
  await page.click(`button:has-text("${playerCount} Players")`);
  await page.click(`button:has-text("${gridSize}")`);
  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/game/, { timeout: 15_000 });

  // Wait for room code
  await page.waitForFunction(
    () => /ROOM|room code/i.test(document.body.innerText),
    { timeout: 15_000 }
  );

  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/(?:ROOM|room code)[:\s\n]+([A-Z0-9]{4,8})/i)
    || bodyText.match(/Share the room code:\s*([A-Z0-9]{4,8})/i);
  if (!match) throw new Error(`Could not extract room code from: ${bodyText.slice(0, 200)}`);
  return match[1].trim();
}

/**
 * Join an existing game using its room code.
 */
async function joinGame(page, { username = 'Bob', roomCode, baseUrl = BASE_URL } = {}) {
  await goToLobby(page, baseUrl);
  await page.click('button:has-text("🔗 Join Game")');
  await page.waitForTimeout(200);
  await page.fill('input[placeholder="Enter your name…"]', username);
  await page.fill('input[placeholder*="e.g"]', roomCode);
  await page.locator('button:has-text("Join Game")').last().click();
  await page.waitForURL(/\/game/, { timeout: 15_000 });
}

/**
 * Wait until both pages show a turn indicator.
 */
async function waitForGameStart(...pages) {
  await Promise.all(
    pages.map(p =>
      p.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 })
    )
  );
}

/**
 * Returns which page has "Your turn" and which has the waiting message.
 */
async function getTurnState(p1, p2) {
  const [t1, t2] = await Promise.all([
    p1.locator('body').innerText(),
    p2.locator('body').innerText(),
  ]);
  return {
    p1HasTurn: t1.includes('Your turn'),
    p2HasTurn: t2.includes('Your turn'),
    p1Text: t1,
    p2Text: t2,
  };
}

/**
 * Click the first interactive line for the active player.
 * Returns true if a click succeeded.
 */
async function makeMove(page) {
  const lines = await page.locator('[class*="cursor-pointer"]').all();
  for (const line of lines.slice(0, 10)) {
    try {
      await line.click({ timeout: 2000, force: true });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

module.exports = { goToLobby, createGame, joinGame, waitForGameStart, getTurnState, makeMove, BASE_URL };
