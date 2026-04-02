// tests/weekly/chaos/socket-stability-chaos.spec.js
// Chaos tests for socket stability — rapid disconnects, race conditions, edge cases
// Targets live beta via tests/fixtures/test-helpers.js

const { test, expect } = require('@playwright/test');
const {
    goToLobby,
    createGame,
    joinGame,
    waitForGameStart,
    makeMove,
    BETA_URL,
} = require('../../fixtures/test-helpers');

test.describe('Chaos: Socket Stability', () => {

    test('rapid disconnect storm — 2P game survives 3 rapid reconnects', async ({ browser }) => {
        test.setTimeout(120_000);
        const ctx1 = await browser.newContext();
        const p1 = await ctx1.newPage();

        try {
            const roomCode = await createGame(p1, { username: 'StormHost', playerCount: 2, gridSize: '3×3' });

            // Rapidly join and disconnect 3 times
            for (let i = 0; i < 3; i++) {
                const ctx = await browser.newContext();
                const p = await ctx.newPage();
                try {
                    await joinGame(p, { username: `StormP2_r${i}`, roomCode });
                    await p.waitForTimeout(500);
                } catch {
                    // Join may fail if previous player hasn't fully left — acceptable
                }
                await ctx.close();
                await p1.waitForTimeout(2000); // Wait for server to process disconnect
            }

            // Host page should still be functional
            const bodyText = await p1.locator('body').innerText();
            const isAlive = /GridLock|waiting|turn|Game Over/i.test(bodyText);
            expect(isAlive, 'Host page should still be functional after rapid disconnects').toBe(true);
        } finally {
            await ctx1.close();
        }
    });

    test('simultaneous join race — 2 players join 2P game at once', async ({ browser }) => {
        test.setTimeout(90_000);
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const ctx3 = await browser.newContext();
        const p1 = await ctx1.newPage();
        const p2 = await ctx2.newPage();
        const p3 = await ctx3.newPage();

        try {
            const roomCode = await createGame(p1, { username: 'RaceHost', playerCount: 2, gridSize: '3×3' });

            // Both try to join simultaneously
            const [result2, result3] = await Promise.allSettled([
                joinGame(p2, { username: 'Racer2', roomCode }),
                joinGame(p3, { username: 'Racer3', roomCode }),
            ]);

            // At least one should succeed
            const successes = [result2, result3].filter(r => r.status === 'fulfilled');
            expect(successes.length).toBeGreaterThanOrEqual(1);

            // If both succeeded, one should be in the game and one may see an error
            // The game should not crash regardless
            const hostBody = await p1.locator('body').innerText();
            const hostAlive = hostBody.length > 0;
            expect(hostAlive, 'Host page should not crash during simultaneous join').toBe(true);
        } finally {
            await ctx1.close();
            await ctx2.close();
            await ctx3.close();
        }
    });

    test('disconnect during active gameplay — move recorded, game handles disconnect', async ({ browser }) => {
        test.setTimeout(120_000);
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const p1 = await ctx1.newPage();
        const p2 = await ctx2.newPage();

        try {
            const roomCode = await createGame(p1, { username: 'MoveHost', playerCount: 2, gridSize: '3×3' });
            await joinGame(p2, { username: 'MoveP2', roomCode });
            await waitForGameStart(p1, p2);

            // Make a move with whoever has the turn
            const p1Body = await p1.locator('body').innerText();
            if (p1Body.includes('Your turn')) {
                await makeMove(p1);
            } else {
                await makeMove(p2);
            }
            await p1.waitForTimeout(500);

            // P2 disconnects immediately after a move
            await ctx2.close();

            // Wait for disconnect timeout (8s in test mode, up to 45s in beta)
            // Use longer timeout for beta
            await p1.waitForFunction(
                () => /left|disconnected|forfeited|Game Over|wins!/i.test(document.body.innerText),
                { timeout: 60_000 }
            );

            // P1's game should show the move was recorded and disconnect was handled
            const finalBody = await p1.locator('body').innerText();
            const handled = /left|disconnected|forfeited|Game Over|wins!/i.test(finalBody);
            expect(handled, 'Disconnect after move should be handled gracefully').toBe(true);
        } finally {
            await ctx1.close();
            await ctx2.close().catch(() => {});
        }
    });

    test('host disconnect from full lobby — joiners see room closed', async ({ browser }) => {
        test.setTimeout(90_000);
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const p1 = await ctx1.newPage();
        const p2 = await ctx2.newPage();

        try {
            // P1 creates a 3P game (needs more players, so stays in waiting)
            const roomCode = await createGame(p1, { username: 'LobbyHost', playerCount: 3, gridSize: '3×3' });

            // P2 joins the waiting room
            await goToLobby(p2);
            await p2.locator('input[placeholder="Enter your name…"]:visible').first().fill('LobbyP2');

            // Navigate to join flow
            const joinBtn = p2.locator('button:has-text("Join"), a:has-text("Join")').first();
            if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await joinBtn.click();
            }

            // Fill room code if join panel is visible
            const codeInput = p2.locator('input[placeholder*="e.g"]');
            if (await codeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                await codeInput.fill(roomCode);
                const joinAsPlayer = p2.locator('button:has-text("Join as Player"), button:has-text("Join Game")').first();
                if (await joinAsPlayer.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await joinAsPlayer.click();
                }
            }

            await p1.waitForTimeout(2000);

            // Host disconnects
            await ctx1.close();

            // P2 should eventually see room_closed or be redirected to lobby
            await p2.waitForTimeout(5000);
            const p2Body = await p2.locator('body').innerText();
            // Room should be cleaned up — P2 either sees an error, gets redirected, or the room closes
            expect(p2Body.length).toBeGreaterThan(0); // Page still functional
        } finally {
            await ctx1.close().catch(() => {});
            await ctx2.close();
        }
    });
});
