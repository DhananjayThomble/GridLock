const { devices, test, expect } = require('@playwright/test');
const {
  BASE_URL, goToLobby, createGame, joinGame, getTurnState,
} = require('./helpers');

for (const layout of ['desktop', 'phone']) {
  test(`completes, shares and replays a real match on ${layout}`, async ({ browser }) => {
    test.setTimeout(45_000);
    const context = await browser.newContext(layout === 'phone' ? devices['Pixel 7'] : devices['Desktop Chrome']);
    const opponent = await browser.newContext(devices['Desktop Chrome']);

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await context.addInitScript(() => {
        if (matchMedia('(pointer: coarse)').matches) {
          Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (data) => { window.sharedResult = data.text; },
          });
        } else {
          Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        }
      });
      const playerPage = await context.newPage();
      const opponentPage = await opponent.newPage();
      await goToLobby(playerPage);
      let roomCode;
      if (layout === 'phone') {
        const profile = playerPage.getByRole('button', { name: 'Edit profile' });
        await profile.tap();
        const name = playerPage.getByRole('textbox', { name: 'Your Name' });
        await name.fill('Alice');
        await expect(name).toHaveValue('Alice', { timeout: 3_000 });
        await profile.tap();
        await playerPage.getByRole('radio', { name: '2P', exact: true }).tap();
        await playerPage.getByRole('radio', { name: '3×3', exact: true }).tap();
        await playerPage.getByRole('button', { name: 'Create Game — start a new game room' }).tap();
        await expect(playerPage).toHaveURL(/\/waiting\/[A-Z0-9]+/, { timeout: 8_000 });
        roomCode = new URL(playerPage.url()).pathname.split('/').at(-1);
      } else {
        roomCode = await createGame(playerPage, { username: 'Alice', gridSize: '3×3' });
      }
      await joinGame(opponentPage, { username: 'Bob', roomCode });
      await expect(playerPage).toHaveURL(/\/game/, { timeout: 15_000 });
      await expect(opponentPage).toHaveURL(/\/game/, { timeout: 15_000 });

      if (layout === 'phone') {
        await playerPage.getByRole('button', { name: 'Quick chat', exact: true }).tap();
        await playerPage.getByRole('textbox', { name: 'Message', exact: true }).fill('Ready for a rematch?');
        await playerPage.getByRole('button', { name: 'Send', exact: true }).tap();
        await expect(opponentPage.getByText('Ready for a rematch?', { exact: true })).toBeVisible();
      }
      const shareButton = playerPage.getByRole('button', { name: 'Share result', exact: true });
      for (let move = 0; move < 24; move++) {
        await expect.poll(async () => {
          const turn = await getTurnState(playerPage, opponentPage);
          return turn.p1HasTurn !== turn.p2HasTurn;
        }, { timeout: 3_000 }).toBe(true);

        const { p1HasTurn } = await getTurnState(playerPage, opponentPage);
        const activePage = p1HasTurn ? playerPage : opponentPage;
        const line = activePage.locator('[data-line][aria-disabled="false"]').first();
        if (layout === 'phone' && activePage === playerPage) {
          await line.tap({ timeout: 3_000 });
        } else {
          await line.click({ timeout: 3_000 });
        }
        for (const page of [playerPage, opponentPage]) {
          await expect(page.locator('[data-line][data-open="false"]')).toHaveCount(move + 1, {
            timeout: 3_000,
          });
        }
      }

      await expect(shareButton).toBeVisible({ timeout: 10_000 });
      await shareButton.click();
      await expect(shareButton).toHaveText(layout === 'phone' ? /Shared!/ : /Copied!/);
      const shareText = layout === 'phone'
        ? await playerPage.evaluate(() => window.sharedResult)
        : await playerPage.evaluate(() => navigator.clipboard.readText());
      expect(shareText).toMatch(/(?:I won|I lost|Draw) in GridLock!/);
      expect(shareText).toMatch(/Score: \d+–\d+ boxes/);
      expect(shareText).toContain('https://gridlock.pro/');
      expect(shareText).not.toMatch(/[🟦🟥🟩🟨⬛]/u);

      const replay = await context.newPage();
      const replayUrl = shareText.split('\n').find(line => line.startsWith('Watch the game: ')).slice('Watch the game: '.length);
      expect(replayUrl).toBe(`${BASE_URL}/replay/${roomCode}`);
      await replay.goto(replayUrl);
      await expect(replay.getByRole('heading', { name: /Game Replay/ })).toBeVisible({ timeout: 10_000 });
      await expect(replay.getByText(/Move \d+ \/ 24/)).toBeVisible({ timeout: 5_000 });
      await replay.close();

      await playerPage.getByRole('button', { name: /Rematch/ }).click();
      await opponentPage.getByRole('button', { name: /Rematch/ }).click();
      for (const page of [playerPage, opponentPage]) {
        await expect(page.locator('[data-line][data-open="true"]')).toHaveCount(24, { timeout: 10_000 });
      }
    } finally {
      await context.close();
      await opponent.close();
    }
  });
}
