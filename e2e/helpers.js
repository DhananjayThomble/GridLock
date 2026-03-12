// e2e/helpers.js — shared utilities for all E2E tests

const { expect } = require('@playwright/test');

// Environment config — single source of truth in env-config.js
const { envCfg } = require('./env-config');

const BASE_URL = process.env.TEST_BASE_URL || envCfg.baseURL;

/**
 * API base resolution strategy:
 * 1) Explicit TEST_API_URL wins
 * 2) Otherwise uses env config based on TEST_ENV
 */
const getApiBase = () => {
  if (process.env.TEST_API_URL) return process.env.TEST_API_URL;
  return envCfg.apiURL;
};

/**
 * Socket URL resolution:
 * 1) Explicit SOCKET_URL wins
 * 2) Otherwise uses env config based on TEST_ENV
 */
const getSocketUrl = () => {
  if (process.env.SOCKET_URL) return process.env.SOCKET_URL;
  return envCfg.socketURL;
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
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string}  [opts.username='HumanPlayer']
 * @param {string}  [opts.gridSize='3×3']        - Board size (e.g. '3×3', '4×4', '5×5', '6×6')
 * @param {number}  [opts.playerCount=2]          - Total players (human + CPU)
 * @param {string}  [opts.cpuDifficulty]          - 'easy' | 'medium' | 'hard'
 * @param {number}  [opts.cpuCount]               - Number of CPU opponents.
 *                                                   Defaults to playerCount - 1 (fills all
 *                                                   remaining slots with CPU players).
 */
async function createCpuGame(page, {
  username = 'HumanPlayer',
  gridSize = '3×3',
  playerCount = 2,
  cpuDifficulty,
  cpuCount,
} = {}) {
  // Default cpuCount: fill all non-human slots with CPU
  const effectiveCpuCount = cpuCount ?? (playerCount - 1);
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
  if (effectiveCpuCount > 1) {
    for (let i = 1; i < effectiveCpuCount; i++) {
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

/**
 * Play a game to completion by alternating moves.
 * Returns true when game over is detected (Rematch/Game Over/Winner/wins!).
 */
async function playToCompletion(pages, maxMoves = 80) {
  for (let i = 0; i < maxMoves; i++) {
    let moved = false;
    for (const page of pages) {
      try {
        const text = await page.locator('body').innerText().catch(() => '');
        if (/Rematch|Game Over|Winner|wins!/i.test(text)) return true;
        if (text.includes('Your turn')) {
          const ok = await makeMove(page);
          if (ok) { moved = true; break; }
        }
      } catch { continue; }
    }
    if (!moved) {
      // Iterate pages for fallback wait — pages[0] may be closed
      for (const page of pages) {
        try { await page.waitForTimeout(300); break; } catch { continue; }
      }
    }
  }
  // Post-loop fallback: scan all pages for game-over text
  for (const page of pages) {
    try {
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) return true;
    } catch { continue; }
  }
  return false;
}

module.exports = { goToLobby, createGame, joinGame, waitForGameStart, getTurnState, makeMove, createCpuGame, getApiBase, getSocketUrl, BASE_URL, playToCompletion };
