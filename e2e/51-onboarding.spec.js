// e2e/51-onboarding.spec.js — First-time onboarding flow

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL, makeMove } = require('./helpers');

test.describe('First-Time Onboarding', () => {

  test('new user sees simplified onboarding view', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('[data-testid="onboarding-view"]')).toBeVisible();
    await expect(page.locator('text=Welcome! Complete boxes to win.')).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-play-now"]')).toBeVisible();

    await expect(page.locator('button:has-text("🚀 Create Game")')).not.toBeVisible();
    await expect(page.locator('button:has-text("⚡ Quick Play")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Ranked")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Tournament")')).not.toBeVisible();
  });

  test('new user enters name and clicks Play Now → CPU game starts', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await page.fill('[data-testid="onboarding-name-input"]', 'NewPlayer');
    await page.click('[data-testid="onboarding-play-now"]');

    await page.waitForURL(/\/game/, { timeout: 15_000 });
    await page.waitForFunction(
      () => /turn/i.test(document.body.innerText),
      { timeout: 20_000 }
    );
  });

  test('after completing first game → revisit lobby → full lobby shown', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await page.fill('[data-testid="onboarding-name-input"]', 'FirstTimer');
    await page.click('[data-testid="onboarding-play-now"]');
    await page.waitForURL(/\/game/, { timeout: 15_000 });
    await page.waitForFunction(
      () => /turn/i.test(document.body.innerText),
      { timeout: 20_000 }
    );

    for (let i = 0; i < 80; i++) {
      const text = await page.locator('body').innerText();
      if (/Rematch|Game Over|Winner|wins!/i.test(text)) break;
      if (text.includes('Your turn')) {
        await makeMove(page);
      }
      await page.waitForTimeout(300);
    }

    await page.waitForFunction(
      () => /Rematch|Game Over|Winner|wins!/i.test(document.body.innerText),
      { timeout: 30_000 }
    );

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    await expect(page.locator('[data-testid="onboarding-view"]')).not.toBeVisible();
    await expect(page.locator('button:has-text("🚀 Create Game"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("⚡ Quick Play"):visible').first()).toBeVisible();
  });

  test('returning user sees full lobby immediately', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.setItem('gridlock_has_played', 'true'));
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('[data-testid="onboarding-view"]')).not.toBeVisible();
    await expect(page.locator('button:has-text("🚀 Create Game"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("⚡ Quick Play"):visible').first()).toBeVisible();
  });

  test('first-time user sees game demo animation', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    const demo = page.locator('[data-testid="game-demo"]');
    await expect(demo).toBeVisible();

    // Verify demo has correct structure (dots + lines)
    const dots = demo.locator('[data-testid="demo-dot"]');
    await expect(dots).toHaveCount(9);
  });

  test('game demo does not interfere with name input or Play Now button', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    // Demo is visible
    await expect(page.locator('[data-testid="game-demo"]')).toBeVisible();

    // Name input is still functional
    const nameInput = page.locator('[data-testid="onboarding-name-input"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('TestPlayer');
    await expect(nameInput).toHaveValue('TestPlayer');

    // Play Now button is enabled and clickable
    const playBtn = page.locator('[data-testid="onboarding-play-now"]');
    await expect(playBtn).toBeVisible();
    await expect(playBtn).toBeEnabled();
  });
});
