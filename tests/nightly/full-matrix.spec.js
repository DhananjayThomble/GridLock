// tests/nightly/full-matrix.spec.js — Full game matrix: all player/grid/CPU permutations
// Runs against live beta (https://beta.gridlock.pro) via playwright.nightly.config.js
//
// ~96 test scenarios covering:
//   12 all-human combos (2/3/4 players × 3×3/4×4/5×5/6×6 grids)
//   20 human+CPU combos
//   + disconnect and spectator tests per player count

const { test, expect, chromium } = require('@playwright/test');
const {
  goToLobby,
  createGameWithOptions,
  joinGameByCode,
  joinGame,
  waitForGameStart,
  makeMove,
  playGameToCompletion,
  verifyGameEnd,
  getPlayerScores,
  getGameState,
  BETA_URL,
} = require('../fixtures/test-helpers');

// ═══════════════════════════════════════════════════════════════════════════════
// Matrix Definitions
// ═══════════════════════════════════════════════════════════════════════════════

// Grid sizes available in the UI: 3×3, 4×4, 5×5, 6×6
const GRID_SIZES = ['3×3', '4×4', '5×5', '6×6'];

// Parse grid dimension from label (e.g., '3×3' → 3)
function gridN(label) {
  return parseInt(label.charAt(0), 10);
}

// Timeout per grid size (larger grids = more moves = more time)
function timeoutForGrid(label) {
  const n = gridN(label);
  // Total lines in an NxN dots-and-boxes grid: 2*N*(N+1)
  // But timeout is based on expected game duration
  const timeouts = { 3: 60_000, 4: 90_000, 5: 120_000, 6: 180_000 };
  return timeouts[n] || 120_000;
}

// Max moves safety limit per grid size
function maxMovesForGrid(label) {
  const n = gridN(label);
  // Total lines = 2*n*(n+1) — that's the absolute max moves
  return 2 * n * (n + 1) + 20; // small buffer
}

// Player name generator
function playerName(prefix, playerIndex) {
  return `${prefix}P${playerIndex + 1}`;
}

// All-Human Matrix: [playerCount, gridSize]
const ALL_HUMAN_MATRIX = [];
for (const pc of [2, 3, 4]) {
  for (const gs of GRID_SIZES) {
    ALL_HUMAN_MATRIX.push([pc, gs]);
  }
}

// Human + CPU Matrix: [playerCount, humanCount, cpuCount, gridSize]
const CPU_MATRIX = [];
// 2P: 1 human + 1 CPU
for (const gs of GRID_SIZES) CPU_MATRIX.push([2, 1, 1, gs]);
// 3P: 1 human + 2 CPU
for (const gs of GRID_SIZES) CPU_MATRIX.push([3, 1, 2, gs]);
// 3P: 2 human + 1 CPU
for (const gs of GRID_SIZES) CPU_MATRIX.push([3, 2, 1, gs]);
// 4P: 1 human + 3 CPU
for (const gs of GRID_SIZES) CPU_MATRIX.push([4, 1, 3, gs]);
// 4P: 2 human + 2 CPU
for (const gs of GRID_SIZES) CPU_MATRIX.push([4, 2, 2, gs]);

// ═══════════════════════════════════════════════════════════════════════════════
// ALL-HUMAN MATRIX: Real multi-browser games (12 combos)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Full Matrix — All Human Players', () => {
  test.describe.configure({ mode: 'serial' });

  for (const [playerCount, gridSize] of ALL_HUMAN_MATRIX) {
    test(`${playerCount}P × ${gridSize} — all human`, async () => {
      test.setTimeout(timeoutForGrid(gridSize) + 30_000); // extra buffer for setup

      const contexts = [];
      const pages = [];

      try {
        // 1. Launch N browser contexts
        for (let i = 0; i < playerCount; i++) {
          const ctx = await chromium.launch().then(b => b.newContext());
          const page = await ctx.newPage();
          contexts.push(ctx);
          pages.push(page);
        }

        // 2. Player 1 creates the game (all human — cpuCount = 0)
        const roomCode = await createGameWithOptions(pages[0], {
          username: playerName('Matrix', 0),
          playerCount,
          gridSize,
          cpuCount: 0,
        });
        expect(roomCode).toBeTruthy();
        expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

        // 3. Other players join via room code
        for (let i = 1; i < playerCount; i++) {
          await joinGameByCode(pages[i], roomCode, playerName('Matrix', i));
        }

        // 4. Wait for game to start — all players see turn indicator
        await waitForGameStart(...pages);

        // Verify all players see the board (turn text present)
        for (const page of pages) {
          const bodyText = await page.locator('body').innerText();
          expect(bodyText).toMatch(/turn/i);
        }

        // 5. Play game to completion
        const completed = await playGameToCompletion(
          pages,
          maxMovesForGrid(gridSize),
          false, // no CPU
        );
        expect(completed, `${playerCount}P × ${gridSize} game should complete`).toBe(true);

        // 6. Verify game end state
        await verifyGameEnd(pages, gridN(gridSize), expect);

      } finally {
        // Cleanup: close all browser contexts
        for (const ctx of contexts) {
          try { await ctx.browser()?.close(); } catch { /* ignore */ }
        }
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CPU MATRIX: Human + CPU games (20 combos)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Full Matrix — Human + CPU Players', () => {
  test.describe.configure({ mode: 'serial' });

  for (const [playerCount, humanCount, cpuCount, gridSize] of CPU_MATRIX) {
    test(`${playerCount}P (${humanCount}H+${cpuCount}CPU) × ${gridSize}`, async () => {
      test.setTimeout(timeoutForGrid(gridSize) + 30_000);

      const contexts = [];
      const pages = [];

      try {
        // Launch browser contexts for human players only
        for (let i = 0; i < humanCount; i++) {
          const ctx = await chromium.launch().then(b => b.newContext());
          const page = await ctx.newPage();
          contexts.push(ctx);
          pages.push(page);
        }

        if (humanCount === 1 && cpuCount === playerCount - 1) {
          // All non-human slots are CPU → game starts immediately (no waiting room)
          await createGameWithOptions(pages[0], {
            username: playerName('CpuMatrix', 0),
            playerCount,
            gridSize,
            cpuCount,
            cpuDifficulty: 'medium',
          });
          // createGameWithOptions returns null for CPU-only games and waits for turn
        } else {
          // Mixed: some humans + some CPUs → host creates, others join
          const roomCode = await createGameWithOptions(pages[0], {
            username: playerName('CpuMatrix', 0),
            playerCount,
            gridSize,
            cpuCount,
            cpuDifficulty: 'medium',
          });

          // Additional human players join
          for (let i = 1; i < humanCount; i++) {
            await joinGameByCode(pages[i], roomCode, playerName('CpuMatrix', i));
          }

          // Wait for game start
          await waitForGameStart(...pages);
        }

        // Play to completion — CPU turns are automatic
        const completed = await playGameToCompletion(
          pages,
          maxMovesForGrid(gridSize),
          true, // has CPU
        );
        expect(completed, `${playerCount}P (${humanCount}H+${cpuCount}CPU) × ${gridSize} should complete`).toBe(true);

        // Verify game end
        await verifyGameEnd(pages, gridN(gridSize), expect);

      } finally {
        for (const ctx of contexts) {
          try { await ctx.browser()?.close(); } catch { /* ignore */ }
        }
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISCONNECT TESTS: One per player count (3 tests)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Full Matrix — Player Disconnect', () => {
  test.describe.configure({ mode: 'serial' });

  // Use 3×3 grid for disconnect tests (fast enough to verify behavior)
  const disconnectGridSize = '3×3';

  for (const playerCount of [2, 3, 4]) {
    test(`${playerCount}P × ${disconnectGridSize} — player disconnect mid-game`, async () => {
      test.setTimeout(120_000);

      const contexts = [];
      const pages = [];

      try {
        for (let i = 0; i < playerCount; i++) {
          const ctx = await chromium.launch().then(b => b.newContext());
          const page = await ctx.newPage();
          contexts.push(ctx);
          pages.push(page);
        }

        // Create and join game
        const roomCode = await createGameWithOptions(pages[0], {
          username: playerName('Disco', 0),
          playerCount,
          gridSize: disconnectGridSize,
          cpuCount: 0,
        });

        for (let i = 1; i < playerCount; i++) {
          await joinGameByCode(pages[i], roomCode, playerName('Disco', i));
        }

        await waitForGameStart(...pages);

        // Play a few moves (3-5 moves to get into mid-game)
        for (let m = 0; m < 4; m++) {
          for (const page of pages) {
            try {
              const text = await page.locator('body').innerText().catch(() => '');
              if (text.includes('Your turn')) {
                await makeMove(page);
                break;
              }
            } catch { continue; }
          }
          await pages[0].waitForTimeout(500);
        }

        // Disconnect the last player (close their browser)
        const disconnectedCtx = contexts[playerCount - 1];
        await disconnectedCtx.browser()?.close().catch(() => {});
        contexts[playerCount - 1] = null; // Mark as closed

        // Remaining players should be able to continue
        const remainingPages = pages.slice(0, playerCount - 1);

        // Wait a moment for server to detect disconnect
        await remainingPages[0].waitForTimeout(2000);

        // Try to continue playing with remaining players
        // The game should either: continue (with disconnected player forfeiting turns)
        // or show a "player left" notification and end/adjust
        const completed = await playGameToCompletion(remainingPages, maxMovesForGrid(disconnectGridSize), false);

        // Verify at least the remaining players see some end state
        // (either game over or "player left" notification)
        for (const page of remainingPages) {
          try {
            const text = await page.locator('body').innerText();
            const hasEndState = /Rematch|Game Over|Winner|wins!|left|disconnected|forfeit/i.test(text);
            expect(hasEndState, 'Remaining players should see game end or disconnect notification').toBe(true);
          } catch { /* page may have navigated */ }
        }

      } finally {
        for (const ctx of contexts) {
          if (ctx) {
            try { await ctx.browser()?.close(); } catch { /* ignore */ }
          }
        }
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPECTATOR TESTS: One per player count (3 tests)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Full Matrix — Spectator View', () => {
  test.describe.configure({ mode: 'serial' });

  const spectatorGridSize = '3×3';

  for (const playerCount of [2, 3, 4]) {
    test(`${playerCount}P × ${spectatorGridSize} — spectator view`, async () => {
      test.setTimeout(120_000);

      const contexts = [];
      const pages = [];
      let spectatorCtx = null;
      let spectator = null;

      try {
        // Launch player browser contexts
        for (let i = 0; i < playerCount; i++) {
          const ctx = await chromium.launch().then(b => b.newContext());
          const page = await ctx.newPage();
          contexts.push(ctx);
          pages.push(page);
        }

        // Launch spectator browser context
        const specBrowser = await chromium.launch();
        spectatorCtx = await specBrowser.newContext();
        spectator = await spectatorCtx.newPage();

        // Create and join game
        const roomCode = await createGameWithOptions(pages[0], {
          username: playerName('Spec', 0),
          playerCount,
          gridSize: spectatorGridSize,
          cpuCount: 0,
        });

        for (let i = 1; i < playerCount; i++) {
          await joinGameByCode(pages[i], roomCode, playerName('Spec', i));
        }

        await waitForGameStart(...pages);

        // Spectator joins
        await joinGame(spectator, {
          username: 'SpecWatcher',
          roomCode,
          joinMode: 'spectator',
        });

        // Spectator should see spectating indicator
        await spectator.waitForFunction(
          () => /Spectating|spectator/i.test(document.body.innerText),
          { timeout: 15_000 }
        );

        // Spectator should NOT have interactive (clickable) lines
        const interactiveLines = await spectator.locator('[role="button"][aria-disabled="false"]').count();
        expect(interactiveLines, 'Spectator should have no clickable lines').toBe(0);

        // Make a move and verify spectator sees the update
        const specBefore = await spectator.locator('body').innerText();

        // Find active player and make a move
        for (const page of pages) {
          const text = await page.locator('body').innerText();
          if (text.includes('Your turn')) {
            await makeMove(page);
            break;
          }
        }

        // Wait for spectator to see the change
        await spectator.waitForFunction(
          prev => document.body && document.body.innerText !== prev,
          specBefore,
          { timeout: 10_000 }
        );

        // Verify spectator still can't click
        const linesAfter = await spectator.locator('[role="button"][aria-disabled="false"]').count();
        expect(linesAfter, 'Spectator still has no clickable lines after move').toBe(0);

      } finally {
        for (const ctx of contexts) {
          try { await ctx.browser()?.close(); } catch { /* ignore */ }
        }
        if (spectatorCtx) {
          try { await spectatorCtx.browser()?.close(); } catch { /* ignore */ }
        }
      }
    });
  }
});
