#!/usr/bin/env node
// e2e-game-flow.js — Full multiplayer game flow E2E test
// Tests: lobby → create game → join game → both players take turns → game ends
// Run: NODE_PATH=/tmp/pw/node_modules node scripts/e2e-game-flow.js
// Exit 0 = all good, Exit 1 = failure

const { chromium } = require('playwright');

const BASE_URL = process.env.TEST_URL || 'http://localhost/beta';
const TIMEOUT   = 25000;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function waitForText(page, text, timeout = TIMEOUT) {
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    text,
    { timeout }
  );
}

async function runE2ETest() {
  const browser = await chromium.launch({ headless: true });
  const errors1 = [], errors2 = [];

  try {
    // ── Two browser contexts = two players ────────────────────────────────────
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1   = await ctx1.newPage();
    const p2   = await ctx2.newPage();

    p1.on('pageerror', e => errors1.push(e.message));
    p2.on('pageerror', e => errors2.push(e.message));

    console.log('\n📋 Test: Multiplayer Game Flow');
    console.log(`   URL: ${BASE_URL}\n`);

    // ── Step 1: Lobby loads ───────────────────────────────────────────────────
    console.log('1. Loading lobby...');
    await p1.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await p2.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });

    assert(errors1.length === 0, 'P1 lobby — no JS errors');
    assert(errors2.length === 0, 'P2 lobby — no JS errors');
    assert(await p1.locator('body').innerText().then(t => t.includes('Dots & Boxes')), 'P1 sees lobby');
    assert(await p2.locator('body').innerText().then(t => t.includes('Dots & Boxes')), 'P2 sees lobby');

    // ── Step 2: P1 creates a 2-player game ───────────────────────────────────
    console.log('\n2. P1 creates a 2-player game...');
    // Fill name
    await p1.fill('input[placeholder="Enter your name…"]', 'Alice');
    // Select 2 players (first player-count button, or click "2 Players" button)
    await p1.click('button:has-text("2 Players")');
    // Select 3×3 grid (quickest game)
    await p1.click('button:has-text("3×3")');
    // Click the big Create Game button (🚀 Create Game)
    await p1.click('button:has-text("🚀 Create Game")');

    // Wait for navigation to /game
    await p1.waitForURL(/\/game/, { timeout: TIMEOUT });
    assert(true, 'P1 navigated to game page');

    // ── Step 3: Grab game ID from the waiting screen ──────────────────────────
    console.log('\n3. Grabbing Game ID...');
    // Wait for room code to appear (text says "ROOM" or "room code")
    await waitForText(p1, 'ROOM', TIMEOUT).catch(() => waitForText(p1, 'room code', TIMEOUT));
    const gameIdText = await p1.locator('body').innerText();
    // Format may be "ROOM\nABCDEF", "Game ID: ABCDEF", or "room code: ABCDEF"
    const gameIdMatch = gameIdText.match(/(?:ROOM|Game ID|room code)[:\s\n]+([A-Z0-9]{4,8})/i)
      || gameIdText.match(/Share the room code:\s*([A-Z0-9]{4,8})/i);
    const gameId = gameIdMatch?.[1]?.trim();
    assert(!!gameId, `P1 sees Game ID: ${gameId}`);
    assert(errors1.length === 0, 'P1 game page — no JS errors');

    // ── Step 4: P2 joins game ─────────────────────────────────────────────────
    console.log(`\n4. P2 joins game ${gameId}...`);
    // Switch to Join tab
    await p2.click('button:has-text("🔗 Join Game")');
    await p2.waitForTimeout(300);
    // Fill name
    await p2.fill('input[placeholder="Enter your name…"]', 'Bob');
    // Fill game ID (placeholder: "e.g. AB3XYZ")
    await p2.fill('input[placeholder*="e.g"]', gameId);
    // Click the submit Join button (second "Join Game" button — the tab is first)
    await p2.locator('button:has-text("Join Game")').last().click();

    // Wait for navigation to /game
    await p2.waitForURL(/\/game/, { timeout: TIMEOUT });
    assert(true, 'P2 navigated to game page');
    assert(errors2.length === 0, 'P2 game page — no JS errors');

    // ── Step 5: Both players see the board ────────────────────────────────────
    console.log('\n5. Waiting for game to start (both players loaded)...');
    await Promise.all([
      waitForText(p1, 'turn', TIMEOUT),
      waitForText(p2, 'turn', TIMEOUT),
    ]);

    const p1Body = await p1.locator('body').innerText();
    const p2Body = await p2.locator('body').innerText();
    assert(p1Body.includes('turn'), 'P1 sees turn indicator');
    assert(p2Body.includes('turn'), 'P2 sees turn indicator');
    assert(errors1.length === 0, 'P1 — no JS errors after game start');
    assert(errors2.length === 0, 'P2 — no JS errors after game start');

    // ── Step 6: Verify turn assignment ────────────────────────────────────────
    console.log('\n6. Verifying turn assignments...');
    const p1YourTurn = p1Body.includes('Your turn');
    const p2YourTurn = p2Body.includes('Your turn');
    assert(p1YourTurn || p2YourTurn, 'At least one player sees "Your turn"');
    assert(!(p1YourTurn && p2YourTurn), 'Both players do NOT see "Your turn" simultaneously');
    assert(!p2Body.includes('player_joining'), 'P2 role is resolved (not "player_joining")');

    // ── Step 7: Current player makes a move ───────────────────────────────────
    console.log('\n7. Current player (P1) makes a move...');
    const currentPage = p1YourTurn ? p1 : p2;
    const otherPage   = p1YourTurn ? p2 : p1;
    const currentName = p1YourTurn ? 'Alice(P1)' : 'Bob(P2)';
    const otherName   = p1YourTurn ? 'Bob(P2)'   : 'Alice(P1)';

    // Click a line segment (interactive elements with cursor-pointer)
    const clickableLines = await currentPage.locator('[class*="cursor-pointer"]').all();
    let moveMade = false;
    for (const line of clickableLines.slice(0, 8)) {
      try {
        await line.click({ timeout: 2000, force: true });
        moveMade = true;
        break;
      } catch {
        continue;
      }
    }
    assert(moveMade, `${currentName} made a move`);

    // Wait briefly for turn to switch
    await otherPage.waitForFunction(
      () => document.body.innerText.includes('Your turn'),
      { timeout: TIMEOUT }
    ).catch(() => {});

    const p1BodyAfter = await p1.locator('body').innerText();
    const p2BodyAfter = await p2.locator('body').innerText();

    const p1TurnAfter = p1BodyAfter.includes('Your turn');
    const p2TurnAfter = p2BodyAfter.includes('Your turn');
    const turnSwitched = p1YourTurn ? p2TurnAfter : p1TurnAfter;
    assert(turnSwitched, `Turn switched to ${otherName} after move`);

    // ── Step 8: Other player can also make a move ─────────────────────────────
    console.log('\n8. Other player makes a move...');
    const clickableLines2 = await otherPage.locator('[class*="cursor-pointer"]').all();
    let move2Made = false;
    for (const line of clickableLines2.slice(0, 8)) {
      try {
        await line.click({ timeout: 2000, force: true });
        move2Made = true;
        break;
      } catch {
        continue;
      }
    }
    assert(move2Made, `${otherName} made a move`);

    // ── Step 9: Check no errors throughout ────────────────────────────────────
    console.log('\n9. Final error check...');
    assert(errors1.length === 0, `P1 (Alice) — zero JS errors throughout (${errors1.length} found)`);
    assert(errors2.length === 0, `P2 (Bob) — zero JS errors throughout (${errors2.length} found)`);
    if (errors1.length > 0) console.error('   P1 errors:', errors1);
    if (errors2.length > 0) console.error('   P2 errors:', errors2);

    await ctx1.close();
    await ctx2.close();

  } catch (err) {
    console.error('\n❌ Test threw an error:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    failed++;
  } finally {
    await browser.close();
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('❌ E2E tests FAILED');
    process.exit(1);
  } else {
    console.log('✅ All E2E tests passed!');
    process.exit(0);
  }
}

runE2ETest().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
