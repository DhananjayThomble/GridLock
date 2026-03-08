// e2e/helpers.js — shared utilities for all E2E tests

const { expect } = require('@playwright/test');

const BASE_URL = process.env.TEST_BASE_URL
  || (process.env.CI ? 'http://localhost:4173' : 'http://localhost/beta');

/**
 * API base resolution strategy:
 * 1) Explicit TEST_API_URL wins
 * 2) In CI, default backend is 5000 (see .github/workflows/ci.yml)
 * 3) Local e2e helper script backend is 5105
 */
const getApiBase = () => {
  if (process.env.TEST_API_URL) return process.env.TEST_API_URL;
  if (process.env.CI) return 'http://127.0.0.1:5000';
  return 'http://127.0.0.1:5105';
};

/**
 * Navigate to the lobby and wait for it to be ready.
 */
async function goToLobby(page, baseUrl = BASE_URL) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('GridLock');
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
async function joinGame(page, { username = 'Bob', roomCode, baseUrl = BASE_URL, joinMode = 'player' } = {}) {
  await goToLobby(page, baseUrl);
  await page.click('button:has-text("🔗 Join Game")');
  await page.waitForTimeout(200);
  await page.fill('input[placeholder="Enter your name…"]', username);
  await page.fill('input[placeholder*="e.g"]', roomCode);
  if (joinMode === 'spectator') {
    await page.click('button:has-text("Join as Spectator")');
  } else {
    await page.click('button:has-text("Join as Player")');
  }
  if (joinMode === 'spectator') {
    await page.getByRole('button', { name: /Spectate Game/i }).click();
  } else {
    await page.getByRole('button', { name: /Join Game/i }).last().click();
  }
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
 * Click the first interactive (unowned) line for the active player.
 * Uses role="button" + aria-disabled="false" — stable attributes from Board.jsx.
 * Returns true if a click succeeded.
 */
async function makeMove(page) {
  const lines = await page.locator('[role="button"][aria-disabled="false"]').all();
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

/**
 * Create a CPU game — does NOT wait for room code (CPU games start immediately).
 * Shared by 15-cpu-game.spec.js and 28-game-mode-matrix.spec.js.
 */
async function createCpuGame(page, {
  username = 'HumanPlayer',
  gridSize = '3×3',
  playerCount = 2,
  cpuDifficulty,
  cpuCount,
} = {}) {
  await goToLobby(page);
  await page.fill('input[placeholder="Enter your name…"]', username);
  await page.click(`button:has-text("${playerCount} Players")`);
  await page.click(`button:has-text("${gridSize}")`, { timeout: 3000 }).catch(() => {});

  // Enable CPU toggle
  await page.locator('button:has-text("Play vs CPU")').click();
  await page.waitForSelector('text=/Easy|Medium|Hard/i', { timeout: 3000 });

  // Set difficulty if specified
  if (cpuDifficulty) {
    const label = cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1);
    await page.click(`button:has-text("${label}")`);
  }

  // Set CPU count for 3P/4P
  if (cpuCount && cpuCount > 1) {
    for (let i = 1; i < cpuCount; i++) {
      await page.click('button:has-text("+")');
    }
  }

  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/game/, { timeout: 15_000 });
  await page.waitForFunction(
    () => /turn/i.test(document.body.innerText),
    { timeout: 20_000 }
  );
}

module.exports = { goToLobby, createGame, joinGame, waitForGameStart, getTurnState, makeMove, createCpuGame, getApiBase, BASE_URL };
