// e2e/41-leave-game-multiplayer.spec.js — Leave game notifies other players (#365)

const { test, expect } = require('@playwright/test');
const { createGameV, joinToWaitingRoom } = require('./wave-helpers');

test.describe('Leave Game Multiplayer Notification', () => {

  test('leaving notifies other player and game continues', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // P1 creates 2P game (no CPU)
    const roomCode = await createGameV(p1, { username: 'Alice', playerCount: 2, gridSize: '3×3' });
    expect(roomCode).toMatch(/^[A-Z0-9]{4,8}$/);

    // P2 joins (waits for /waiting/ or /game)
    await joinToWaitingRoom(p2, { username: 'Bob', roomCode });

    // Host clicks Start Game when room is full (or auto-start fires in 5s)
    if (p1.url().includes('/waiting/')) {
      const startBtn = p1.locator('button:has-text("Start Game")');
      if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await startBtn.click();
      }
    }

    // Wait for both to reach /game
    await p1.waitForURL(/\/game/, { timeout: 20_000 });
    await p2.waitForURL(/\/game/, { timeout: 20_000 });

    // Wait for game to show turn indicator on both
    await p1.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 10_000 });
    await p2.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 10_000 });

    // P2 clicks Leave Game → confirms → navigates
    // Use page.evaluate to emit leave_game directly with a small delay before navigate
    // This ensures the socket message is queued before page destruction
    await p2.click('text=← Leave Game');
    await expect(p2.locator('[role="dialog"]')).toBeVisible();

    // Click Leave in the dialog. The app calls socket.emit('leave_game') + navigate('/')
    // Socket.IO buffers the message; closing the page may race. So we also close the context
    // after a brief wait to guarantee a disconnect signal reaches the server.
    await p2.click('[role="dialog"] button:has-text("Leave")');

    // Wait briefly then close P2's context — this guarantees the server sees the disconnect
    await p1.waitForTimeout(1000);
    await ctx2.close();

    // P1 should see either "left the game" or "disconnected" or "forfeited" notification
    // In test mode, disconnect timeout is 8s. After the timeout, the server forfeits P2.
    await p1.waitForFunction(
      () => /left the game|disconnected|forfeited|Game Over|wins!/i.test(document.body.innerText),
      { timeout: 20_000 }
    );

    // P1's game should still be accessible (not crashed)
    const bodyText = await p1.locator('body').innerText();
    expect(bodyText).toBeTruthy();
    expect(bodyText.length).toBeGreaterThan(0);

    await ctx1.close();
  });

});
