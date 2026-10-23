// e2e/40-mobile-multiplayer.spec.js
// Phone-sized multiplayer regression checks (#590, #591, #593).
// Every player is a separate iPhone-14-sized browser context with touch input, so this
// exercises the mobile lobby, waiting room and board the way real players meet them.

const { test, expect, devices } = require('@playwright/test');
const { BASE_URL } = require('./helpers');

const PHONE = devices['iPhone 14'];
const NAMES = ['Aaa', 'Bbb', 'Ccc', 'Ddd'];

/** A fresh phone-sized player. `page.__ctx` is kept so a test can reopen a tab in the same browser. */
async function newPhone(browser) {
  const ctx = await browser.newContext({ ...PHONE });
  await ctx.addInitScript(() => localStorage.setItem('gridlock_has_played', 'true'));
  const page = await ctx.newPage();
  page.__ctx = ctx;
  return page;
}

/** Host creates a room from the phone lobby. Returns the room code. */
async function hostCreate(page, name, players = 2) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // On phones the name field sits inside the collapsible profile panel
  await page.locator('button[aria-controls="mobile-profile-panel"]').click();
  await page.locator('#lobby-name-input-mobile').fill(name);
  await page.locator('button[aria-controls="mobile-profile-panel"]').click();
  await page.locator('button:visible', { hasText: new RegExp(`^${players}P$`) }).click();
  await page.locator('button:visible', { hasText: /Create Game/ }).click();
  await page.waitForURL(/\/(waiting|game)\//, { timeout: 15_000 });
  return page.url().match(/\/(?:waiting|game|join)\/([A-Z0-9]+)/i)?.[1];
}

async function guestJoin(page, name, code) {
  await page.goto(`${BASE_URL}/join/${code}`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/name/i).first().fill(name);
  await page.getByRole('button', { name: /Join Game/ }).click();
  await page.waitForURL(/\/(waiting|game)/, { timeout: 15_000 });
}

/** Host + (players-1) guests, all on the board. Returns pages in join order. */
async function startRoom(browser, players) { // returns { pages, code }
  const pages = [];
  for (let i = 0; i < players; i++) pages.push(await newPhone(browser));
  const code = await hostCreate(pages[0], NAMES[0], players);
  for (let i = 1; i < players; i++) await guestJoin(pages[i], NAMES[i], code);
  for (const p of pages) await expect(p.getByTestId('board-container')).toBeVisible({ timeout: 20_000 });
  return { pages, code };
}

const bodyText = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const openLines = (p) => p.locator('[data-line][data-open="true"]');

/** Tap the centre of the n-th open line with a real touch. */
async function tapLine(p, n = 0) {
  const box = await openLines(p).nth(n).boundingBox();
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function closeAll(pages) {
  await Promise.all(pages.map((p) => p.__ctx?.close().catch(() => {})));
}

test.describe('Mobile multiplayer (phone-sized)', () => {
  test.setTimeout(120_000);

  test('3 players: every phone shows the right turn banner and only the current player can move', async ({ browser }) => {
    const { pages } = await startRoom(browser, 3);
    try {
      const [a, b, c] = pages;
      // Regression: the 2nd joiner used to be labelled player1 and showed "Your turn!" to the wrong phone
      await expect(a.getByText('Your turn!')).toBeVisible();
      await expect(b.getByText("Aaa's turn")).toBeVisible();
      await expect(c.getByText("Aaa's turn")).toBeVisible();
      await expect(b.getByText('Your turn!')).toHaveCount(0);

      // Bbb taps out of turn: nothing is drawn
      const before = await openLines(a).count();
      await tapLine(b, 0);
      await b.waitForTimeout(500);
      expect(await openLines(a).count()).toBe(before);

      // Aaa moves, the turn passes to Bbb on all three phones
      await tapLine(a, 0);
      await expect(b.getByText('Your turn!')).toBeVisible();
      await expect(a.getByText("Bbb's turn")).toBeVisible();
      await expect(c.getByText("Bbb's turn")).toBeVisible();
    } finally { await closeAll(pages); }
  });

  test('4 players: turns rotate through all four phones', async ({ browser }) => {
    const { pages } = await startRoom(browser, 4);
    try {
      for (let turn = 0; turn < 4; turn++) {
        const mover = pages[turn];
        await expect(mover.getByText('Your turn!')).toBeVisible();
        for (const other of pages.filter((_, i) => i !== turn)) {
          await expect(other.getByText(`${NAMES[turn]}'s turn`)).toBeVisible();
        }
        await tapLine(mover, turn); // pick lines far apart so no box is completed
      }
      await expect(pages[0].getByText('Your turn!')).toBeVisible(); // back to the host
    } finally { await closeAll(pages); }
  });

  test('a player closes their tab on their turn, the others are told, and they rejoin from the lobby banner', async ({ browser }) => {
    const { pages } = await startRoom(browser, 3);
    try {
      const [a, b, c] = pages;
      await tapLine(a, 0);
      await expect(b.getByText('Your turn!')).toBeVisible();

      await b.close(); // tab closed on Bbb's own turn
      await expect(a.getByText(/Bbb disconnected/)).toBeVisible({ timeout: 15_000 });
      await expect(c.getByText(/Bbb disconnected/)).toBeVisible();

      // Same browser, new tab: the lobby offers the unfinished game
      const b2 = await b.__ctx.newPage();
      await b2.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await expect(b2.getByText('You have an unfinished game')).toBeVisible();
      await b2.getByRole('button', { name: /Rejoin Game/ }).click(); // one tap, no form

      // Back on the same board, still Bbb's turn, others' warning cleared
      await expect(b2.getByTestId('board-container')).toBeVisible({ timeout: 15_000 });
      await expect(b2.getByText('Your turn!')).toBeVisible();
      expect(await openLines(b2).count()).toBe(await openLines(a).count());
      await expect(a.getByText(/Bbb disconnected/)).toHaveCount(0, { timeout: 10_000 });

      // ... and the rejoined player can move
      await tapLine(b2, 5);
      await expect(c.getByText("Ccc's turn").or(c.getByText('Your turn!'))).toBeVisible();
    } finally { await closeAll(pages); }
  });

  test('a network drop shows an offline notice at once and the player is back in the game when it returns', async ({ browser }) => {
    const { pages } = await startRoom(browser, 2);
    try {
      const [a, b] = pages;
      await b.__ctx.setOffline(true);
      await expect(b.getByText("You're offline")).toBeVisible({ timeout: 5_000 });

      await b.__ctx.setOffline(false);
      await expect(b.getByText("You're offline")).toHaveCount(0, { timeout: 20_000 });
      await expect(b.getByText('Reconnecting…')).toHaveCount(0, { timeout: 20_000 });

      await tapLine(a, 0); // Aaa moves while Bbb was away
      await expect(b.getByText('Your turn!')).toBeVisible({ timeout: 10_000 });
    } finally { await closeAll(pages); }
  });

  test('a player leaves a 3-player game: the others are told and keep playing', async ({ browser }) => {
    const { pages } = await startRoom(browser, 3);
    try {
      const [a, b, c] = pages;
      await b.getByRole('button', { name: /Leave Game/ }).click();
      await b.getByRole('button', { name: /^Leave$/ }).click();
      await expect(b).toHaveURL(new RegExp(`${BASE_URL.replace(/\/$/, '')}/?$`));

      await expect(a.getByText(/Bbb left the game/)).toBeVisible({ timeout: 10_000 });
      await expect(c.getByText(/Bbb left the game/)).toBeVisible();

      await tapLine(a, 0); // game goes on: next turn skips Bbb
      await expect(c.getByText('Your turn!')).toBeVisible({ timeout: 10_000 });
    } finally { await closeAll(pages); }
  });

  test('browser Back from a running game returns to the lobby with a rejoin banner, not a stale waiting room', async ({ browser }) => {
    const { pages } = await startRoom(browser, 2);
    try {
      const [a] = pages;
      await a.goBack();
      await expect(a).toHaveURL(new RegExp(`${BASE_URL.replace(/\/$/, '')}/?$`));
      await expect(a.getByText('You have an unfinished game')).toBeVisible();
      expect(await bodyText(a)).not.toContain('Start Game');
    } finally { await closeAll(pages); }
  });

  test('waiting room: the host and a guest can refresh the page and keep their seats', async ({ browser }) => {
    const host = await newPhone(browser);
    const guest = await newPhone(browser);
    const third = await newPhone(browser);
    try {
      const code = await hostCreate(host, 'Aaa', 3);
      await guestJoin(guest, 'Bbb', code);
      await expect(guest.getByText(/Waiting for the host/)).toBeVisible();

      await guest.reload({ waitUntil: 'domcontentloaded' });
      await expect(guest.getByText('Bbb (you)')).toBeVisible({ timeout: 15_000 });
      await expect(host.getByText('Bbb')).toBeVisible();

      await host.reload({ waitUntil: 'domcontentloaded' });
      await expect(host.getByText('Aaa (you)')).toBeVisible({ timeout: 15_000 });
      await expect(host.getByText('Bbb')).toBeVisible();

      await guestJoin(third, 'Ccc', code); // the room is still there for the last player
      for (const p of [host, guest, third]) await expect(p.getByTestId('board-container')).toBeVisible({ timeout: 20_000 });
    } finally { await closeAll([host, guest, third]); }
  });

  test('waiting room: leaving frees the seat at once so someone else can take it', async ({ browser }) => {
    const second = await newPhone(browser);
    const host3 = await newPhone(browser);
    const g1 = await newPhone(browser);
    try {
      const code = await hostCreate(host3, 'Aaa', 3);
      await guestJoin(g1, 'Bbb', code);
      await expect(host3.getByText('Bbb')).toBeVisible();

      await g1.getByRole('button', { name: /Leave Waiting Room/ }).click();
      await expect(g1).toHaveURL(new RegExp(`${BASE_URL.replace(/\/$/, '')}/?$`));
      await expect(host3.getByText('Bbb')).toHaveCount(0, { timeout: 10_000 });

      await guestJoin(second, 'Ccc', code); // the freed seat is usable
      await expect(host3.getByText('Ccc')).toBeVisible();
    } finally { await closeAll([host3, g1, second]); }
  });

  test('tap assist: a tap beside a line snaps to it, a tap in the middle of a box does nothing, a taken line never reaches the server', async ({ browser }) => {
    const p = await newPhone(browser);
    try {
      // 1 human vs 1 CPU through the phone lobby
      await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await p.locator('button[aria-controls="mobile-profile-panel"]').click();
      await p.locator('#lobby-name-input-mobile').fill('TapTester');
      await p.locator('button[aria-controls="mobile-profile-panel"]').click();
      await p.locator('button[role="switch"][aria-label="Add CPU opponents"]:visible').click();
      await p.locator('button:visible', { hasText: /Easy/ }).first().click();
      await p.locator('button:visible', { hasText: /Create Game/ }).click();
      await expect(p.getByTestId('board-container')).toBeVisible({ timeout: 20_000 });
      await expect(p.getByText('Your turn!')).toBeVisible();

      const total = await p.locator('[data-line]').count();
      const taken = async () => total - (await openLines(p).count());
      const first = await p.locator('[data-testid="board-hline"]').first().boundingBox();

      // Middle of the first box: ambiguous, so nothing is drawn (a move cannot be undone)
      await p.touchscreen.tap(first.x + first.width / 2, first.y + first.height + first.width / 2);
      await p.waitForTimeout(500);
      expect(await taken()).toBe(0);

      // A few pixels below the top edge, outside the thin line itself: snaps to that line
      await p.touchscreen.tap(first.x + first.width / 2, first.y + first.height + 4);
      await expect.poll(taken, { timeout: 8_000 }).toBeGreaterThanOrEqual(1);
      await expect(p.getByText('Your turn!')).toBeVisible({ timeout: 15_000 }); // CPU replied

      // Tap a line that is already drawn: no server error banner, board does not move
      const board = p.getByTestId('board-container');
      const boardBefore = await board.boundingBox();
      const drawn = await p.locator('[data-line][data-open="false"]').first().boundingBox();
      await p.touchscreen.tap(drawn.x + drawn.width / 2, drawn.y + drawn.height / 2);
      await p.waitForTimeout(600);
      await expect(p.getByTestId('game-error')).toHaveCount(0);
      expect(await board.boundingBox()).toEqual(boardBefore);
    } finally { await p.__ctx.close(); }
  });

  test('first run on a phone: tapping Create without a name opens, focuses and flags the name field', async ({ browser }) => {
    const p = await newPhone(browser);
    try {
      await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await p.locator('button:visible', { hasText: /Create Game/ }).click();
      const input = p.locator('#lobby-name-input-mobile');
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
      await expect(p.getByText(/Please enter a username/).first()).toBeVisible();
    } finally { await p.__ctx.close(); }
  });
});
