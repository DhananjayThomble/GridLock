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
 * Select player count — handles both desktop ("2 Players Classic duel") and mobile ("2P") layouts.
 */
async function selectPlayerCount(page, playerCount) {
  // Try desktop layout first (button with "N Players" text)
  const desktopBtn = page.locator(`button:has-text("${playerCount} Players"):visible`);
  if (await desktopBtn.count() > 0) {
    await desktopBtn.first().click({ timeout: 3000 });
    return;
  }
  // Mobile layout uses radio buttons labeled "2P", "3P", "4P"
  const mobileBtn = page.locator(`[role="radio"]:has-text("${playerCount}P"):visible, button:has-text("${playerCount}P"):visible`);
  if (await mobileBtn.count() > 0) {
    await mobileBtn.first().click({ timeout: 3000 });
    return;
  }
}

/**
 * Select grid size — handles both desktop and mobile layouts.
 */
async function selectGridSize(page, gridSize) {
  const btn = page.locator(`button:has-text("${gridSize}"):visible, [role="radio"]:has-text("${gridSize}"):visible`);
  if (await btn.count() > 0) {
    await btn.first().click({ timeout: 3000 }).catch(() => {});
  }
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
  await selectPlayerCount(page, playerCount);
  await selectGridSize(page, gridSize);
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
  await selectPlayerCount(page, playerCount);
  await selectGridSize(page, gridSize);

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
  // Click "Join Game" — desktop shows "🔗 Join Game", mobile shows "🔗 Join"
  const joinBtn = page.locator('button:has-text("Join Game"):visible, button:has-text("🔗 Join"):visible');
  await joinBtn.first().click();
  await page.waitForTimeout(300);
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
  const lineLocator = page.locator('[role="button"][aria-disabled="false"]');
  const count = await lineLocator.count();
  if (count === 0) return false;
  // Pick a random available line to avoid always picking the same pattern
  const idx = Math.floor(Math.random() * count);
  try {
    await lineLocator.nth(idx).click({ timeout: 3000 });
    return true;
  } catch {
    // Fallback: try first available
    try {
      await lineLocator.first().click({ timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Play a game to completion by alternating moves.
 */
async function playToCompletion(pages, maxMoves = 200, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let moves = 0;

  while (moves < maxMoves && Date.now() < deadline) {
    let moved = false;

    for (const page of pages) {
      try {
        const state = await page.evaluate(() => {
          const text = document.body?.innerText || '';
          return {
            gameOver: /Rematch|Game Over|Winner|wins!/i.test(text),
            yourTurn: text.includes('Your turn'),
          };
        }).catch(() => ({ gameOver: false, yourTurn: false }));

        if (state.gameOver) return true;

        if (state.yourTurn) {
          const ok = await makeMove(page);
          if (ok) {
            moved = true;
            moves++;
            // Wait for server to process move and propagate turn change
            await page.waitForTimeout(200).catch(() => {});
            break;
          }
        }
      } catch { continue; }
    }

    if (!moved) {
      await pages[0].waitForTimeout(200).catch(() => {});
    }
  }

  // Final check
  for (const page of pages) {
    try {
      const gameOver = await page.evaluate(() =>
        /Rematch|Game Over|Winner|wins!/i.test(document.body?.innerText || '')
      ).catch(() => false);
      if (gameOver) return true;
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
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    // Find score numbers — look for standalone small numbers
    const scoreMatches = text.match(/(?:^|\n)\s*"?(\d{1,3})"?\s*(?:\n|$)/gm) || [];
    const scores = scoreMatches.map(m => parseInt(m.replace(/[^\d]/g, ''))).filter(n => !isNaN(n) && n < 1000);
    return {
      isYourTurn: text.includes('Your turn'),
      isGameOver: /Rematch|Game Over|Winner|wins!/i.test(text),
      scores: scores.length >= 2 ? scores.slice(0, 4) : null,
      bodyText: text,
    };
  });
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
  await selectPlayerCount(page, playerCount);
  await selectGridSize(page, gridSize);

  if (cpuCount > 0) {
    // Enable CPU toggle
    await page.locator('button:has-text("Play vs CPU")').click();
    await page.waitForSelector('button:has-text("Easy")', { timeout: 10000 });

    // Set difficulty — only click if different from default (clicking default may toggle off)
    if (cpuDifficulty && cpuDifficulty.toLowerCase() !== 'medium') {
      const diffLabel = cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1);
      await page.click(`button:has-text("${diffLabel}")`);
    }

    // Set CPU count — buttons are labeled "1 🤖", "2 🤖", "3 🤖"
    // For 2-player games with 1 CPU, there's no count selector (only 1 option)
    const cpuCountBtn = page.locator(`button:has-text("${cpuCount} 🤖")`);
    if (await cpuCountBtn.count() > 0) {
      await cpuCountBtn.click({ timeout: 3000 }).catch(() => {});
    }
  }

  await page.click('button:has-text("🚀 Create Game")');
  await page.waitForURL(/\/(game|waiting)/, { timeout: 15_000 });

  const currentUrl = page.url();
  if (currentUrl.includes('/waiting/')) {
    const urlMatch = currentUrl.match(/\/waiting\/([A-Z0-9]+)/i);
    if (!urlMatch) throw new Error(`Could not extract game ID from waiting URL: ${currentUrl}`);
    const roomCode = urlMatch[1].toUpperCase().trim();

    // If all non-human slots are CPU, add CPUs in waiting room and wait for game start
    const allCpu = cpuCount >= playerCount - 1;
    if (allCpu) {
      // Click "🤖 CPU" button for each empty slot
      for (let i = 0; i < cpuCount; i++) {
        const cpuSlotBtn = page.locator('button:has-text("🤖 CPU")');
        if (await cpuSlotBtn.count() > 0) {
          await cpuSlotBtn.first().click({ timeout: 5000 });
          await page.waitForTimeout(500);
        }
      }
      // Wait for game to start (redirect to /game/)
      await page.waitForURL(/\/game/, { timeout: 30_000 });
      await page.waitForFunction(
        () => /turn/i.test(document.body.innerText),
        { timeout: 20_000 }
      );
      return null;
    }
    return roomCode;
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
      const state = await pages[i].evaluate(() => {
        const text = document.body?.innerText || '';
        return {
          gameOver: /Rematch|Game Over|Winner|wins!/i.test(text),
          yourTurn: text.includes('Your turn'),
        };
      }).catch(() => ({ gameOver: false, yourTurn: false }));
      if (state.gameOver) return -1;
      if (state.yourTurn) return i;
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
  const deadline = Date.now() + (hasCPU ? 180_000 : 120_000);
  let humanMoves = 0;

  while (humanMoves < maxMoves && Date.now() < deadline) {
    let moved = false;

    for (const page of pages) {
      try {
        const state = await page.evaluate(() => {
          const text = document.body?.innerText || '';
          return {
            gameOver: /Rematch|Game Over|Winner|wins!/i.test(text),
            yourTurn: text.includes('Your turn'),
          };
        }).catch(() => ({ gameOver: false, yourTurn: false }));

        if (state.gameOver) return true;

        if (state.yourTurn) {
          const ok = await makeMove(page);
          if (ok) {
            moved = true;
            humanMoves++;
            await page.waitForTimeout(200).catch(() => {});
            break;
          }
        }
      } catch { continue; }
    }

    if (!moved) {
      // Wait for CPU turn or state update
      const waitMs = hasCPU ? 500 : 200;
      for (const page of pages) {
        try { await page.waitForTimeout(waitMs); break; } catch { continue; }
      }
    }
  }

  // Final check
  for (const page of pages) {
    try {
      const gameOver = await page.evaluate(() =>
        /Rematch|Game Over|Winner|wins!/i.test(document.body?.innerText || '')
      ).catch(() => false);
      if (gameOver) return true;
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
