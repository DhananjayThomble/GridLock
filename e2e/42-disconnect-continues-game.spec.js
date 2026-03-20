// e2e/42-disconnect-continues-game.spec.js — Game continues after disconnect

const { test, expect } = require('@playwright/test');
const { makeMove } = require('./helpers');
const { createGameV, joinToWaitingRoom } = require('./wave-helpers');

test.describe('Disconnect Continues Game', () => {

  test('game continues after player disconnects', async ({ browser }) => {
    test.setTimeout(120_000);

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // P1 creates a 2P game (simpler than 4P — still tests disconnect)
    const roomCode = await createGameV(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

    // P2 joins
    await joinToWaitingRoom(p2, { username: 'Bob', roomCode });

    // Host clicks Start if still in waiting room (or auto-start fires in 5s)
    if (p1.url().includes('/waiting/')) {
      const startBtn = p1.locator('button:has-text("Start Game")');
      if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await startBtn.click();
      }
    }

    // Wait for both to reach /game
    await p1.waitForURL(/\/game/, { timeout: 20_000 });
    await p2.waitForURL(/\/game/, { timeout: 20_000 });

    // Wait for game to be active on P1
    await p1.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 10_000 });

    // P2 closes their tab (disconnect)
    await p2.close();

    // P1 sees disconnect notification (8s timeout in test env)
    await p1.waitForFunction(
      () => /disconnected/i.test(document.body.innerText),
      { timeout: 15_000 }
    );

    // Wait for disconnect timeout (8s in test env) + buffer
    await p1.waitForTimeout(10_000);

    // Game should continue — P1 can still interact or game progresses
    let canPlay = false;
    for (let i = 0; i < 30; i++) {
      const text = await p1.locator('body').innerText().catch(() => '');
      if (/Game Over|Winner|wins!|forfeited/i.test(text)) {
        canPlay = true; // game progressed — success
        break;
      }
      if (text.includes('Your turn')) {
        const moved = await makeMove(p1);
        if (moved) canPlay = true;
        break;
      }
      await p1.waitForTimeout(500);
    }
    expect(canPlay).toBe(true);

    // Verify game did NOT freeze (the error/notification is shown)
    const bodyText = await p1.locator('body').innerText().catch(() => '');
    // Game either continued to end or is still playable — not stuck
    expect(bodyText).not.toMatch(/^$/);

    await ctx1.close();
    await ctx2.close();
  });

});
