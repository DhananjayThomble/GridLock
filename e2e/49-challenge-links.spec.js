// e2e/49-challenge-links.spec.js — Challenge Links E2E tests (#455)
const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('Challenge Links', () => {
  test.describe('Create Challenge', () => {
    test('Challenge a Friend button is visible in lobby', async ({ page }) => {
      await goToLobby(page);
      await page.fill('input[placeholder="Enter your name…"]:visible', 'ChallengeHost');

      // The "Challenge a Friend" button should be visible
      const challengeBtn = page.getByRole('button', { name: /Challenge a Friend/i });
      await expect(challengeBtn).toBeVisible();
    });

    test('Clicking Challenge a Friend generates a shareable link', async ({ page }) => {
      await goToLobby(page);
      await page.fill('input[placeholder="Enter your name…"]:visible', 'LinkMaker');

      const challengeBtn = page.getByRole('button', { name: /Challenge a Friend/i });
      await challengeBtn.click();

      // Should show a challenge link modal/section with the link
      await expect(page.locator('text=/play\\/LinkMaker/i')).toBeVisible({ timeout: 5000 });

      // Copy button should be visible
      await expect(page.getByRole('button', { name: /Copy/i })).toBeVisible();
    });

    test('Copy link button copies to clipboard', async ({ browser }) => {
      const context = await browser.newContext({
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      const page = await context.newPage();
      await goToLobby(page);
      await page.fill('input[placeholder="Enter your name…"]:visible', 'CopyTest');

      await page.getByRole('button', { name: /Challenge a Friend/i }).click();
      await expect(page.locator('text=/play\\/CopyTest/i')).toBeVisible({ timeout: 5000 });

      await page.getByRole('button', { name: /Copy/i }).click();

      // Verify clipboard contains the challenge link
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toContain('/play/CopyTest');

      await context.close();
    });
  });

  test.describe('Visit Challenge Link', () => {
    test('Challenge page shows challenger name from URL', async ({ page }) => {
      await page.goto(`${BASE_URL}/play/TestChallenger`, { waitUntil: 'networkidle' });

      // Should display the challenger's name
      await expect(page.locator('text=/TestChallenger/i')).toBeVisible();

      // Should show "challenged you" or similar text
      await expect(page.locator('text=/challenge/i')).toBeVisible();
    });

    test('Challenge page has name input and accept button', async ({ page }) => {
      await page.goto(`${BASE_URL}/play/SomePlayer`, { waitUntil: 'networkidle' });

      // Name input should be visible
      await expect(page.locator('input[placeholder*="name" i]:visible')).toBeVisible();

      // Accept Challenge button
      await expect(page.getByRole('button', { name: /Accept Challenge/i })).toBeVisible();
    });

    test('Accepting challenge with name joins the game', async ({ browser }) => {
      // Player A: create challenge from lobby
      const ctx1 = await browser.newContext();
      const page1 = await ctx1.newPage();
      await goToLobby(page1);
      await page1.fill('input[placeholder="Enter your name…"]:visible', 'ChallengerA');

      await page1.getByRole('button', { name: /Challenge a Friend/i }).click();
      await expect(page1.locator('text=/play\\/ChallengerA/i')).toBeVisible({ timeout: 5000 });

      // Player B: visit the challenge link
      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await page2.goto(`${BASE_URL}/play/ChallengerA`, { waitUntil: 'networkidle' });

      // Verify challenger name shown
      await expect(page2.locator('text=/ChallengerA/i')).toBeVisible();

      // Enter name and accept
      await page2.fill('input[placeholder*="name" i]:visible', 'ChallengerB');
      await page2.getByRole('button', { name: /Accept Challenge/i }).click();

      // Both should end up in the game
      await Promise.all([
        page1.waitForURL(/\/(game|waiting)/, { timeout: 15_000 }),
        page2.waitForURL(/\/(game|waiting)/, { timeout: 15_000 }),
      ]);

      await ctx1.close();
      await ctx2.close();
    });

    test('Visit expired/invalid challenge shows error message', async ({ page }) => {
      // Visit a challenge link for a non-existent challenge
      await page.goto(`${BASE_URL}/play/NonExistentPlayer123`, { waitUntil: 'networkidle' });

      // Enter name and try to accept
      await page.fill('input[placeholder*="name" i]:visible', 'LateJoiner');
      await page.getByRole('button', { name: /Accept Challenge/i }).click();

      // Should show an error about expired/invalid challenge
      await expect(page.locator('text=/expired|not found|no longer available|invalid/i')).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Challenge Link URL parsing', () => {
    test('/play/:username route renders ChallengePage', async ({ page }) => {
      await page.goto(`${BASE_URL}/play/TestUser`, { waitUntil: 'networkidle' });

      // Should not redirect to lobby (it's a valid route)
      expect(page.url()).toContain('/play/TestUser');
    });

    test('Username with special chars in URL is handled', async ({ page }) => {
      await page.goto(`${BASE_URL}/play/Player_123`, { waitUntil: 'networkidle' });

      // Should display the username
      await expect(page.locator('text=/Player_123/i')).toBeVisible();
    });
  });
});
