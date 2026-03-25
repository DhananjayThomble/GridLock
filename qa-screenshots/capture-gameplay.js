/**
 * capture-gameplay.js — Capture in-game board screenshots
 * Uses Playwright UI automation with two browser contexts for 2P games
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'https://beta.gridlock.pro';
const OUT_DIR = path.join(__dirname, 'mobile-audit-2026-03-22');

const DEVICES = [
  { name: 'iphone-14', width: 390, height: 844, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', dpr: 3 },
  { name: 'galaxy-s22', width: 360, height: 780, ua: 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', dpr: 3 },
  { name: 'pixel-7', width: 412, height: 915, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', dpr: 2.625 },
];

let totalCaptured = 0;
let failures = [];

// ── Helpers ─────────────────────────────────────────────────────────────

async function cap(page, dir, name, opts = {}) {
  const fp = path.join(dir, `${name}.png`);
  try {
    await page.screenshot({ path: fp, fullPage: !!opts.fullPage, timeout: 15000 });
    totalCaptured++;
    console.log(`  ✅ ${name}.png`);
  } catch (e) {
    failures.push(`${path.basename(dir)}/${name}: ${e.message.slice(0, 80)}`);
    console.log(`  ❌ ${name}.png — ${e.message.slice(0, 80)}`);
  }
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('gridlock_theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(500);
}

function makeCtxOpts(device) {
  return {
    viewport: { width: device.width, height: device.height },
    userAgent: device.ua,
    deviceScaleFactor: device.dpr,
  };
}

// Click an available (untaken) line on the board
// Returns true if a move was made
async function clickAvailableLine(page) {
  return await page.evaluate(() => {
    // Lines have aria-labels like "Horizontal line row 0 col 0" or "Vertical line row 0 col 0"
    const lines = document.querySelectorAll('[aria-label^="Horizontal line"], [aria-label^="Vertical line"]');
    for (const line of lines) {
      // Only click lines that are NOT taken (aria-disabled=false or no "(taken)" in label)
      const label = line.getAttribute('aria-label') || '';
      const disabled = line.getAttribute('aria-disabled');
      if (!label.includes('(taken)') && disabled !== 'true') {
        line.click();
        return true;
      }
    }
    return false;
  });
}

// Check if it's this player's turn
async function isMyTurn(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('[class*="turn"], [class*="Turn"]');
    if (el && el.textContent.includes('Your turn')) return true;
    // Also check aria-disabled on lines
    const lines = document.querySelectorAll('[aria-label^="Horizontal line"], [aria-label^="Vertical line"]');
    for (const line of lines) {
      if (line.getAttribute('aria-disabled') === 'false' && !line.getAttribute('aria-label').includes('(taken)')) {
        return true;
      }
    }
    return false;
  });
}

// Check if game over modal is showing
async function hasGameOverModal(page) {
  return await page.evaluate(() => {
    // The winner modal is a fixed overlay with z-50 and bg-black/70
    const overlays = document.querySelectorAll('.fixed.inset-0');
    for (const el of overlays) {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
        const text = el.innerText || '';
        if (text.includes('Wins!') || text.includes('Draw!') || text.includes('Rematch') || text.includes('Play Again')) {
          return true;
        }
      }
    }
    return false;
  });
}

// Wait for game board to be interactive
async function waitForBoard(page, timeoutMs = 10000) {
  try {
    await page.waitForSelector('[aria-label^="Horizontal line"], [aria-label^="Vertical line"]', { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

// ── 2-Player Game Capture ────────────────────────────────────────────────

async function capture2PlayerGame(browser, device, gridSize) {
  const dir = path.join(OUT_DIR, device.name);
  const prefix = `board-2p-${gridSize}x${gridSize}`;
  console.log(`\n📸 ${device.name}: 2P ${gridSize}x${gridSize} game`);

  const ctx1 = await browser.newContext(makeCtxOpts(device));
  const ctx2 = await browser.newContext(makeCtxOpts(device));

  try {
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    // ── P1: Create game ─────────────────────────────────────────────────
    await page1.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page1.waitForTimeout(1500);
    await setTheme(page1, 'dark');

    // Set preferences
    await page1.evaluate(({ gridSize }) => {
      localStorage.setItem('gridlock-gridSize', String(gridSize));
      localStorage.setItem('gridlock-playerCount', '2');
      localStorage.setItem('gridlock-cpuEnabled', 'false');
      localStorage.setItem('gridlock-cpuCount', '0');
    }, { gridSize });
    await page1.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page1.waitForTimeout(1500);

    // Enter name
    const nameInput = await page1.$('input[type="text"]');
    if (nameInput) await nameInput.fill('Player1');
    await page1.waitForTimeout(300);

    // Click Create
    const createBtn = await page1.$('button:has-text("Create"), button:has-text("CREATE")');
    if (createBtn) await createBtn.click();
    else { console.log('  ❌ No Create button'); return; }

    // Wait for waiting room
    await page1.waitForURL(/\/waiting\//, { timeout: 10000 });
    await page1.waitForTimeout(1500);

    // Capture waiting room
    await cap(page1, dir, `${prefix}-waiting-room`, { fullPage: true });

    // Extract game ID
    const gameId = page1.url().match(/\/waiting\/([A-Z0-9]+)/i)?.[1];
    if (!gameId) { console.log('  ❌ No game ID found'); return; }
    console.log(`  📋 Game ID: ${gameId}`);

    // ── P2: Join game ───────────────────────────────────────────────────
    await page2.goto(`${BASE_URL}/join/${gameId}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page2.waitForTimeout(1500);
    await setTheme(page2, 'dark');

    // Fill name and join
    const nameInput2 = await page2.$('input[type="text"]');
    if (nameInput2) await nameInput2.fill('Player2');
    await page2.waitForTimeout(300);
    const joinBtn = await page2.$('button:has-text("Join"), button:has-text("JOIN")');
    if (joinBtn) await joinBtn.click();

    // Both should navigate to /game — P1 may need to click Start
    await page2.waitForTimeout(3000);

    // Check if P1 is still on waiting room (needs to start)
    if (page1.url().includes('/waiting/')) {
      // Look for Start Game button
      const startBtn = await page1.$('button:has-text("Start"), button:has-text("START")');
      if (startBtn) {
        await startBtn.click();
        console.log('  🚀 Host starting game...');
      }
      await page1.waitForTimeout(4000);
    }

    // Wait for both to be on /game
    try { await page1.waitForURL(/\/game/, { timeout: 10000 }); } catch {}
    try { await page2.waitForURL(/\/game/, { timeout: 10000 }); } catch {}
    await page1.waitForTimeout(1500);

    console.log(`  P1: ${page1.url()}, P2: ${page2.url()}`);

    // ── Capture game start ──────────────────────────────────────────────
    const boardReady = await waitForBoard(page1);
    if (!boardReady) {
      console.log('  ⚠️ Board not ready on P1');
      await cap(page1, dir, `${prefix}-game-start`);
      return;
    }

    await cap(page1, dir, `${prefix}-game-start`);
    await cap(page1, dir, `${prefix}-your-turn`); // P1 goes first

    // ── Play moves ──────────────────────────────────────────────────────
    const totalLines = 2 * gridSize * (gridSize + 1);
    let movesPlayed = 0;
    let capturedOpponent = false;
    let capturedMid = false;
    const midPoint = Math.max(6, Math.floor(totalLines * 0.4));

    for (let attempt = 0; attempt < totalLines * 3 && movesPlayed < totalLines; attempt++) {
      // Alternate checking P1 then P2
      for (const [activePage, otherPage, label] of [[page1, page2, 'P1'], [page2, page1, 'P2']]) {
        const myTurnNow = await isMyTurn(activePage);
        if (!myTurnNow) continue;

        const moved = await clickAvailableLine(activePage);
        if (moved) {
          movesPlayed++;
          await activePage.waitForTimeout(700); // Wait for animation + server round-trip

          // Capture key states
          if (movesPlayed === 1 && !capturedOpponent) {
            await otherPage.waitForTimeout(500);
            await cap(otherPage, dir, `${prefix}-opponent-turn`);
            capturedOpponent = true;
          }
          if (movesPlayed >= midPoint && !capturedMid) {
            await cap(page1, dir, `${prefix}-mid-game`);
            await cap(page1, dir, `${prefix}-score-bar`);
            capturedMid = true;
          }

          // Check for game over
          const gameOver = await hasGameOverModal(page1) || await hasGameOverModal(page2);
          if (gameOver) {
            console.log(`  🏁 Game over after ${movesPlayed} moves`);
            await page1.waitForTimeout(500);
            await cap(page1, dir, `${prefix}-winner-modal`);
            await cap(page2, dir, `${prefix}-winner-modal-p2`);
            await cap(page1, dir, `${prefix}-rematch-modal`);
            break;
          }
          break; // Only one move per outer loop iteration
        }
      }

      // Check game over after each outer iteration
      const gameOver = await hasGameOverModal(page1) || await hasGameOverModal(page2);
      if (gameOver) break;

      // Short pause between attempts
      await page1.waitForTimeout(200);
    }

    if (!capturedMid && movesPlayed > 3) {
      await cap(page1, dir, `${prefix}-mid-game`);
      await cap(page1, dir, `${prefix}-score-bar`);
    }

    console.log(`  📊 ${movesPlayed} moves played`);
  } catch (e) {
    console.log(`  ❌ 2P ${gridSize}x${gridSize} failed: ${e.message}`);
    failures.push(`${device.name}/${prefix}: ${e.message.slice(0, 100)}`);
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
}

// ── CPU Game Capture ──────────────────────────────────────────────────────

async function captureCPUGame(browser, device, gridSize, playerCount) {
  const dir = path.join(OUT_DIR, device.name);
  const prefix = `board-${playerCount}p-${gridSize}x${gridSize}-cpu`;
  console.log(`\n📸 ${device.name}: ${playerCount}P CPU ${gridSize}x${gridSize}`);

  const ctx = await browser.newContext(makeCtxOpts(device));

  try {
    const page = await ctx.newPage();

    // Go to lobby, set up CPU game
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await setTheme(page, 'dark');

    await page.evaluate(({ gridSize, playerCount }) => {
      localStorage.setItem('gridlock-gridSize', String(gridSize));
      localStorage.setItem('gridlock-playerCount', String(playerCount));
      localStorage.setItem('gridlock-cpuEnabled', 'true');
      localStorage.setItem('gridlock-cpuCount', String(playerCount - 1));
      localStorage.setItem('gridlock-cpuDifficulty', 'medium');
    }, { gridSize, playerCount });
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    // Enter name
    const nameInput = await page.$('input[type="text"]');
    if (nameInput) await nameInput.fill('QA_Player');
    await page.waitForTimeout(300);

    // Click Create
    const createBtn = await page.$('button:has-text("Create"), button:has-text("CREATE")');
    if (createBtn) await createBtn.click();
    else { console.log('  ❌ No Create button'); return; }
    
    await page.waitForTimeout(3000);
    console.log(`  URL after create: ${page.url()}`);

    // If in waiting room, need to click CPU buttons to fill slots
    if (page.url().includes('/waiting/')) {
      console.log('  🤖 Filling CPU slots...');
      
      // Click all CPU buttons to fill remaining slots
      for (let i = 0; i < playerCount - 1; i++) {
        const cpuBtns = await page.$$('button:has-text("CPU")');
        for (const btn of cpuBtns) {
          const text = await btn.textContent();
          const visible = await btn.isVisible();
          if (visible && text.includes('CPU')) {
            await btn.click();
            await page.waitForTimeout(800);
            break;
          }
        }
      }

      await page.waitForTimeout(2000);

      // Check if room is full and we need to start
      const startBtn = await page.$('button:has-text("Start"), button:has-text("START")');
      if (startBtn) {
        await startBtn.click();
        console.log('  🚀 Starting game...');
      }

      // Wait for navigation to /game
      try { await page.waitForURL(/\/game/, { timeout: 15000 }); } catch {}
      await page.waitForTimeout(2000);
    }

    console.log(`  Final URL: ${page.url()}`);

    // Check if board loaded
    const boardReady = await waitForBoard(page, 8000);
    if (!boardReady) {
      console.log('  ⚠️ Board not ready — capturing current state');
      await cap(page, dir, `${prefix}-game-start`);
      return;
    }

    // Capture game start
    await cap(page, dir, `${prefix}-game-start`);

    // Play the game — make moves when it's our turn, wait for CPU moves
    const totalLines = 2 * gridSize * (gridSize + 1);
    let movesPlayed = 0;
    let capturedMid = false;
    const midPoint = Math.max(4, Math.floor(totalLines * 0.3));

    for (let round = 0; round < totalLines * 2 + 30; round++) {
      // Check for game over
      const gameOver = await hasGameOverModal(page);
      if (gameOver) {
        console.log(`  🏁 Game over after ${movesPlayed} player moves`);
        await page.waitForTimeout(500);
        await cap(page, dir, `${prefix}-winner-modal`);
        break;
      }

      // Is it our turn?
      const myTurn = await isMyTurn(page);
      if (myTurn) {
        const moved = await clickAvailableLine(page);
        if (moved) {
          movesPlayed++;
          // Wait for move to register and CPU to respond
          await page.waitForTimeout(2000);

          // Capture mid-game
          if (!capturedMid && movesPlayed >= midPoint) {
            await page.waitForTimeout(1500); // Let CPU respond
            await cap(page, dir, `${prefix}-mid-game`);
            await cap(page, dir, `${prefix}-score-bar`);
            capturedMid = true;
          }
        } else {
          await page.waitForTimeout(500);
        }
      } else {
        // Wait for CPU to move
        await page.waitForTimeout(2000);
      }
    }

    if (!capturedMid) {
      await cap(page, dir, `${prefix}-mid-game`);
      await cap(page, dir, `${prefix}-score-bar`);
    }
  } catch (e) {
    console.log(`  ❌ ${playerCount}P CPU ${gridSize}x${gridSize} failed: ${e.message}`);
    failures.push(`${device.name}/${prefix}: ${e.message.slice(0, 100)}`);
  } finally {
    await ctx.close();
  }
}

// ── Chat Capture ──────────────────────────────────────────────────────────

async function captureChat(browser, device) {
  const dir = path.join(OUT_DIR, device.name);
  console.log(`\n📸 ${device.name}: Chat during game`);

  const ctx = await browser.newContext(makeCtxOpts(device));

  try {
    const page = await ctx.newPage();

    // Create a 2P CPU game to get to game screen quickly
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await setTheme(page, 'dark');

    await page.evaluate(() => {
      localStorage.setItem('gridlock-gridSize', '3');
      localStorage.setItem('gridlock-playerCount', '2');
      localStorage.setItem('gridlock-cpuEnabled', 'true');
      localStorage.setItem('gridlock-cpuCount', '1');
      localStorage.setItem('gridlock-cpuDifficulty', 'easy');
    });
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    const nameInput = await page.$('input[type="text"]');
    if (nameInput) await nameInput.fill('ChatPlayer');
    await page.waitForTimeout(300);

    const createBtn = await page.$('button:has-text("Create"), button:has-text("CREATE")');
    if (createBtn) await createBtn.click();

    // May go to waiting room or /game
    await page.waitForTimeout(3000);
    
    if (page.url().includes('/waiting/')) {
      // Fill CPU slot
      const cpuBtns = await page.$$('button:has-text("CPU")');
      for (const btn of cpuBtns) {
        if (await btn.isVisible()) { await btn.click(); break; }
      }
      await page.waitForTimeout(2000);
      const startBtn = await page.$('button:has-text("Start"), button:has-text("START")');
      if (startBtn) await startBtn.click();
      try { await page.waitForURL(/\/game/, { timeout: 15000 }); } catch {}
    }

    await page.waitForTimeout(2000);
    console.log(`  URL: ${page.url()}`);

    // Find and click chat button (the 💬 FAB)
    const chatBtn = await page.$('button[aria-label*="chat" i], button[aria-label*="Chat" i], button:has-text("💬")');
    if (chatBtn) {
      await chatBtn.click();
      await page.waitForTimeout(1000);
      await cap(page, dir, 'board-chat-open');

      // Type a message
      const chatInput = await page.$('input[placeholder*="message" i], input[placeholder*="Message" i], input[placeholder*="chat" i], textarea[placeholder*="message" i]');
      if (chatInput) {
        await chatInput.fill('GG! Great move! 🎮');
        await page.waitForTimeout(300);
        // Send
        const sendBtn = await page.$('button[aria-label*="send" i], button:has-text("Send")');
        if (sendBtn) await sendBtn.click();
        else await chatInput.press('Enter');
        await page.waitForTimeout(1000);
        await cap(page, dir, 'board-chat-messages');
      } else {
        console.log('  ⚠️ Chat input not found');
        await cap(page, dir, 'board-chat-messages');
      }
    } else {
      // Try looking for chat icon with different selectors
      console.log('  ⚠️ Chat button not found, trying alt selectors...');
      const altChat = await page.$('[class*="chat" i], [class*="Chat"]');
      if (altChat) {
        await altChat.click();
        await page.waitForTimeout(1000);
        await cap(page, dir, 'board-chat-open');
      }
    }
  } catch (e) {
    console.log(`  ❌ Chat capture failed: ${e.message}`);
    failures.push(`${device.name}/chat: ${e.message.slice(0, 100)}`);
  } finally {
    await ctx.close();
  }
}

// ── Light mode captures ──────────────────────────────────────────────────

async function captureLightMode(browser, device) {
  const dir = path.join(OUT_DIR, device.name);
  console.log(`\n📸 ${device.name}: Light mode board`);

  const ctx = await browser.newContext(makeCtxOpts(device));

  try {
    const page = await ctx.newPage();

    // Create 2P CPU game in light mode
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await setTheme(page, 'light');

    await page.evaluate(() => {
      localStorage.setItem('gridlock-gridSize', '3');
      localStorage.setItem('gridlock-playerCount', '2');
      localStorage.setItem('gridlock-cpuEnabled', 'true');
      localStorage.setItem('gridlock-cpuCount', '1');
      localStorage.setItem('gridlock-cpuDifficulty', 'easy');
    });
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await setTheme(page, 'light');

    const nameInput = await page.$('input[type="text"]');
    if (nameInput) await nameInput.fill('LightPlayer');
    await page.waitForTimeout(300);

    const createBtn = await page.$('button:has-text("Create"), button:has-text("CREATE")');
    if (createBtn) await createBtn.click();

    await page.waitForTimeout(3000);

    if (page.url().includes('/waiting/')) {
      const cpuBtns = await page.$$('button:has-text("CPU")');
      for (const btn of cpuBtns) {
        if (await btn.isVisible()) { await btn.click(); break; }
      }
      await page.waitForTimeout(2000);
      const startBtn = await page.$('button:has-text("Start"), button:has-text("START")');
      if (startBtn) await startBtn.click();
      try { await page.waitForURL(/\/game/, { timeout: 15000 }); } catch {}
    }

    await page.waitForTimeout(2000);
    await setTheme(page, 'light');
    await page.waitForTimeout(500);

    await cap(page, dir, 'board-light-mode-game');

    // Make a few moves
    for (let i = 0; i < 5; i++) {
      const myTurn = await isMyTurn(page);
      if (myTurn) {
        await clickAvailableLine(page);
        await page.waitForTimeout(800);
      } else {
        await page.waitForTimeout(1500);
      }
    }
    await cap(page, dir, 'board-light-mode-mid-game');

  } catch (e) {
    console.log(`  ❌ Light mode capture failed: ${e.message}`);
    failures.push(`${device.name}/light-mode: ${e.message.slice(0, 100)}`);
  } finally {
    await ctx.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎮 GridLock Gameplay Screenshot Capture');
  console.log(`📁 Output: ${OUT_DIR}`);
  console.log(`🌐 Target: ${BASE_URL}\n`);

  for (const d of DEVICES) {
    fs.mkdirSync(path.join(OUT_DIR, d.name), { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const device of DEVICES) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`📱 ${device.name} (${device.width}×${device.height})`);
      console.log(`${'═'.repeat(60)}`);

      // 2P 3×3
      await capture2PlayerGame(browser, device, 3);

      // 2P 5×5
      await capture2PlayerGame(browser, device, 5);

      // 4P CPU 3×3
      await captureCPUGame(browser, device, 3, 4);

      // 4P CPU 5×5
      await captureCPUGame(browser, device, 5, 4);

      // Chat
      await captureChat(browser, device);

      // Light mode
      await captureLightMode(browser, device);
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 CAPTURE SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  console.log(`✅ Total screenshots captured: ${totalCaptured}`);
  if (failures.length > 0) {
    console.log(`❌ Failures (${failures.length}):`);
    failures.forEach(f => console.log(`   - ${f}`));
  }

  // List new files per device
  for (const d of DEVICES) {
    const devDir = path.join(OUT_DIR, d.name);
    const files = fs.readdirSync(devDir).filter(f => f.startsWith('board-'));
    console.log(`\n📱 ${d.name}: ${files.length} board screenshots`);
    files.forEach(f => console.log(`   ${f}`));
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
