const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers');

const lines = {
  d: 'Vertical line, row 1, column 2',
  e: 'Vertical line, row 1, column 3',
  5: 'Horizontal line, row 2, column 3',
  j: 'Vertical line, row 2, column 4',
  n: 'Vertical line, row 3, column 4',
  l: 'Vertical line, row 3, column 2',
  h: 'Vertical line, row 2, column 2',
  7: 'Horizontal line, row 3, column 2',
};

async function play(page, moves) {
  const board = page.getByRole('group', { name: 'Dots and Boxes board' });
  for (const move of moves) {
    const line = board.getByRole('button', { name: lines[move], exact: true });
    await line.click();
    await expect(line).toHaveCount(0);
  }
}

async function copyChallenge(page) {
  await page.getByRole('button', { name: 'Challenge a friend', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(['You took', 'Challenge copied']);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return new URL(text.split(' ').at(-1));
}

test.describe('One-minute challenge', () => {
  test('a guest can beat a friend and pass the same board to another guest', async ({ browser, page, context }) => {
    test.setTimeout(30_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined }); });
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: /play the one-minute challenge/i }).click();
    await play(page, 'de5nlh7');
    await expect(page.getByText('You took 7 of 9 boxes.')).toBeVisible();
    const link = await copyChallenge(page);
    expect(link.searchParams.get('gen')).toBe('1');

    const friendContext = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
      viewport: { width: 390, height: 760 },
      isMobile: true,
      hasTouch: true,
      colorScheme: 'dark',
    });
    try {
      await friendContext.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined }); });
      const friend = await friendContext.newPage();
      await friend.goto(link.href);
      const canonical = friend.locator('link[rel="canonical"]');
      await expect(canonical).toHaveAttribute('href', /\/challenge\/$/);
      await expect(friend.locator('dl').getByText('Friend', { exact: true })).toBeVisible();
      await expect(friend.locator('dl').getByText('7', { exact: true })).toBeVisible();
      await play(friend, 'de5jnlh7');
      await expect(friend.getByRole('heading', { name: 'You beat your friend!' })).toBeVisible();
      await expect(friend.getByText('You took 8 of 9 boxes.')).toBeVisible();
      const nextLink = await copyChallenge(friend);
      expect(nextLink.searchParams.get('gen')).toBe('2');
      expect(nextLink.searchParams.get('from')).not.toBe(link.searchParams.get('from'));

      await page.goto(nextLink.href);
      await expect(page.locator('dl').getByText('8', { exact: true })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Dots and Boxes board' }).getByRole('button')).toHaveCount(10);
    } finally {
      await friendContext.close();
    }
  });

  test('an unfinished score link still opens a playable board', async ({ page }) => {
    test.setTimeout(15_000);
    await page.goto(`${BASE_URL}/challenge/?v=1&from=0123456789abcdef0123456789abcdef&moves=d&gen=1`);
    await expect(page.getByText('This link’s score is unavailable.')).toBeVisible();
    const line = page.getByRole('button', { name: lines.d, exact: true });
    await line.focus();
    await line.press('Enter');
    await expect(line).toHaveCount(0);
    await expect(page.locator('dl').getByText('1', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Dots and Boxes board' }).locator('button:focus')).toHaveCount(1);
  });

  test('a guest can retry a failed load and move', async ({ page }) => {
    test.setTimeout(15_000);
    let failRequest = true;
    await page.route('**/api/challenge/v1', async (route) => {
      if (failRequest) {
        failRequest = false;
        await route.fulfill({ status: 503 });
      } else {
        await route.continue();
      }
    });
    await page.goto(`${BASE_URL}/challenge/`);
    await expect(page.getByRole('alert')).toHaveText('Couldn’t load the board.');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();

    const line = page.getByRole('button', { name: lines.d, exact: true });
    await expect(line).toBeVisible();
    failRequest = true;
    await line.click();
    await expect(page.getByRole('alert')).toHaveText('Couldn’t play that move. Try selecting the line again.');
    await line.click();
    await expect(line).toHaveCount(0);
    await expect(page.locator('dl').getByText('1', { exact: true })).toBeVisible();
  });
});
