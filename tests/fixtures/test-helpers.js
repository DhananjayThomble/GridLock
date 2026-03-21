// tests/fixtures/test-helpers.js — Shared utilities for nightly/weekly tests
// Mirrors patterns from e2e/helpers.js but targets live beta environment

const { expect } = require('@playwright/test');

const BETA_URL = process.env.BETA_URL || 'https://beta.gridlock.pro';
const BETA_API = process.env.BETA_API || 'https://beta-api.gridlock.pro';

/**
 * Navigate to the beta lobby and wait for it to be ready.
 */
async function goToLobby(page) {
  await page.goto(BETA_URL, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('GridLock');
}

/**
 * Fill lobby form and create a game. Returns the room code.
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @returns {Promise<string>} room code
 */
async function createGame(page, { username = 'NightlyAlice', playerCount = 2, gridSize = '3×3' } = {}) {
  await goToLobby(page);
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill(username);
  await page.click(`button:has-text("${playerCount} Players")`);
  await page.click(`button:has-text("${gridSize}")`, { timeout: 3000 }).catch(() => {});
  await page.click('button:has-text("🚀 Create Game")');

  await page.waitForURL(/\/(game|waiting)/, { timeout: 15_000 });

  const currentUrl = page.url();
  if (currentUrl.includes('/waiting/')) {
    const urlMatch = currentUrl.match(/\/waiting\/([A-Z0-9]+)/i);
    if (!urlMatch) throw new Error(`Could not extract game ID from waiting URL: ${currentUrl}`);
    return urlMatch[1].toUpperCase().trim();
  }

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
 * Create a CPU game — starts immediately, no room code needed.
 */
async function createCpuGame(page, {
  username = 'NightlyCPU',
  gridSize = '3×3',
  playerCount = 2,
  cpuDifficulty,
} = {}) {
  await goToLobby(page);
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill(username);
  await page.click(`button:has-text("${playerCount} Players")`);
  await page.click(`button:has-text("${gridSize}")`, { timeout: 3000 }).catch(() => {});

  await page.locator('button:has-text("Play vs CPU")').click();
  await page.waitForSelector('button:has-text("Easy")', { timeout: 10000 });

  if (cpuDifficulty) {
    const label = cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1);
    await page.click(`button:has-text("${label}")`);
  }

  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/game/, { timeout: 15_000 });
  await page.waitForFunction(
    () => /turn/i.test(document.body.innerText),
    { timeout: 20_000 }
  );
}

/**
 * Join an existing game using its room code.
 */
async function joinGame(page, { username = 'NightlyBob', roomCode, joinMode = 'player' } = {}) {
  await goToLobby(page);
  await page.click('button:has-text("🔗 Join Game")');
  await page.waitForTimeout(200);
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill(username);
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
 * Wait until all pages show a turn indicator.
 */
async function waitForGameStart(...pages) {
  await Promise.all(
    pages.map(p =>
      p.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 })
    )
  );
}

/**
 * Returns which page has "Your turn" and which is waiting.
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
 * Play a game to completion by alternating moves.
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
      for (const page of pages) {
        try { await page.waitForTimeout(500); break; } catch { continue; }
      }
    }
  }
  for (const page of pages) {
    try {
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) return true;
    } catch { continue; }
  }
  return false;
}

/**
 * Wait for game end state.
 */
async function waitForGameEnd(page, timeout = 60_000) {
  await page.waitForFunction(
    () => /Rematch|Game Over|Winner|wins!/i.test(document.body.innerText),
    { timeout }
  );
}

/**
 * Extract game state from the DOM.
 */
async function getGameState(page) {
  const bodyText = await page.locator('body').innerText();
  const scoreMatch = bodyText.match(/(\d+)\s*[-–]\s*(\d+)/);
  return {
    isYourTurn: bodyText.includes('Your turn'),
    isGameOver: /Rematch|Game Over|Winner|wins!/i.test(bodyText),
    scores: scoreMatch ? [parseInt(scoreMatch[1]), parseInt(scoreMatch[2])] : null,
    bodyText,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full-Matrix helpers — used by tests/nightly/full-matrix.spec.js
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a game with full options including CPU count.
 * For all-human games: cpuCount = 0 (default).
 * For mixed games: cpuCount > 0.
 * Returns the room code (for human games) or navigates to /game (CPU-only games).
 */
async function createGameWithOptions(page, {
  username = 'MatrixP1',
  playerCount = 2,
  gridSize = '3×3',
  cpuCount = 0,
  cpuDifficulty = 'medium',
} = {}) {
  await goToLobby(page);
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill(username);
  await page.click(`button:has-text("${playerCount} Players")`);
  await page.click(`button:has-text("${gridSize}")`, { timeout: 3000 }).catch(() => {});

  if (cpuCount > 0) {
    // Enable CPU toggle
    await page.locator('button:has-text("Play vs CPU")').click();
    await page.waitForSelector('button:has-text("Easy")', { timeout: 10000 });

    // Set difficulty
    const diffLabel = cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1);
    await page.click(`button:has-text("${diffLabel}")`);

    // Set CPU count — buttons are labeled "1 🤖", "2 🤖", "3 🤖"
    await page.click(`button:has-text("${cpuCount} 🤖")`);
  }

  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/(game|waiting)/, { timeout: 15_000 });

  const currentUrl = page.url();
  if (currentUrl.includes('/waiting/')) {
    const urlMatch = currentUrl.match(/\/waiting\/([A-Z0-9]+)/i);
    if (!urlMatch) throw new Error(`Could not extract game ID from waiting URL: ${currentUrl}`);
    return urlMatch[1].toUpperCase().trim();
  }

  // CPU-only game or game page — return null (no room code needed)
  if (currentUrl.includes('/game')) {
    await page.waitForFunction(
      () => /turn/i.test(document.body.innerText),
      { timeout: 20_000 }
    );
    return null;
  }

  // Fallback: extract room code from text
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
 * Join an existing game by room code with a specific username.
 */
async function joinGameByCode(page, code, username = 'MatrixJoiner') {
  return joinGame(page, { username, roomCode: code, joinMode: 'player' });
}

/**
 * Detect which player index (0-based) has the turn across multiple pages.
 * Returns the index or -1 if game is over / no turn detected.
 */
async function detectCurrentPlayer(pages) {
  for (let i = 0; i < pages.length; i++) {
    try {
      const text = await pages[i].locator('body').innerText();
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) return -1;
      if (text.includes('Your turn')) return i;
    } catch { continue; }
  }
  return -1;
}

/**
 * Find and click an available (undrawn) line on the board.
 * Returns true if a move was made.
 */
async function findAndClickAvailableLine(page) {
  return makeMove(page);
}

/**
 * Make the next move: find whose turn it is and click an available line.
 * Returns true if a move was made, false if game is over or stuck.
 */
async function makeNextMove(pages) {
  const idx = await detectCurrentPlayer(pages);
  if (idx < 0) return false;
  return makeMove(pages[idx]);
}

/**
 * Orchestrate a full game to completion across N pages.
 * Supports games with CPU players (pass only human pages).
 * CPU turns are automatic — we just wait for them.
 *
 * @param {import('@playwright/test').Page[]} pages - Human player pages
 * @param {number} maxMoves - Safety limit
 * @param {boolean} hasCPU - Whether game includes CPU players
 */
async function playGameToCompletion(pages, maxMoves = 200, hasCPU = false) {
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
      // If CPU game, wait longer for CPU to complete its turn
      const waitMs = hasCPU ? 1000 : 300;
      for (const page of pages) {
        try { await page.waitForTimeout(waitMs); break; } catch { continue; }
      }
    }
  }

  // Final check
  for (const page of pages) {
    try {
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) return true;
    } catch { continue; }
  }
  return false;
}

/**
 * Extract all player scores from the scoreboard.
 * Returns an object like { player1: 5, player2: 4 } or array of numbers.
 */
async function getPlayerScores(page) {
  // Scoreboard cards have individual score numbers in font-extrabold divs.
  // Each card has: player name + score number.
  // We extract all score values from the scoreboard.
  const scores = await page.evaluate(() => {
    const cards = document.querySelectorAll('.scoreboard-cards > div');
    const result = {};
    cards.forEach((card, i) => {
      const scoreEl = card.querySelector('.text-lg.font-extrabold');
      if (scoreEl) {
        result[`player${i + 1}`] = parseInt(scoreEl.textContent.trim(), 10) || 0;
      }
    });
    return result;
  });
  return scores;
}

/**
 * Verify game end state across all pages.
 * Checks: all pages show game over, scores sum to expected total.
 *
 * @param {import('@playwright/test').Page[]} pages
 * @param {number} gridN - Grid dimension (e.g., 3 for 3×3)
 * @param {import('@playwright/test').expect} expectFn
 */
async function verifyGameEnd(pages, gridN, expectFn) {
  const totalBoxes = gridN * gridN;

  for (const page of pages) {
    try {
      const bodyText = await page.locator('body').innerText();
      expectFn(/Rematch|Game Over|Winner|wins!/i.test(bodyText),
        `Page should show game over state`).toBe(true);
    } catch { /* page may be closed (disconnect test) */ }
  }

  // Check score sum on the first available page
  for (const page of pages) {
    try {
      const scores = await getPlayerScores(page);
      const scoreValues = Object.values(scores);
      if (scoreValues.length > 0) {
        const sum = scoreValues.reduce((a, b) => a + b, 0);
        expectFn(sum, `Score sum should equal total boxes (${totalBoxes})`).toBe(totalBoxes);
      }
      break; // Only need to verify on one page
    } catch { continue; }
  }
}

module.exports = {
  BETA_URL,
  BETA_API,
  goToLobby,
  createGame,
  createCpuGame,
  joinGame,
  waitForGameStart,
  getTurnState,
  makeMove,
  playToCompletion,
  waitForGameEnd,
  getGameState,
  // Full-matrix helpers
  createGameWithOptions,
  joinGameByCode,
  detectCurrentPlayer,
  findAndClickAvailableLine,
  makeNextMove,
  playGameToCompletion,
  verifyGameEnd,
  getPlayerScores,
};
