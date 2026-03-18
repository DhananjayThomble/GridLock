// e2e/10-tournament.spec.js — Tournament mode UI tests

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('Tournament', () => {

  test('tournament tab renders in lobby', async ({ page }) => {
    await goToLobby(page);
    const tournamentTab = page.locator('button:has-text("🏆 Tournament")');
    await expect(tournamentTab).toBeVisible();
    await tournamentTab.click();
    // Tournament-specific UI should appear
    await expect(page.locator('button:has-text("🏆 Create Tournament")')).toBeVisible();
    await expect(page.locator('text=Tournament Size')).toBeVisible();
  });

  test('shows tournament size and grid size options', async ({ page }) => {
    await goToLobby(page);
    await page.click('button:has-text("🏆 Tournament")');
    // Use more specific selectors — "4 Players" appears in both the create section (Party mode)
    // and tournament section (Quick bracket). Match by description text to disambiguate.
    await expect(page.locator('button:has-text("Quick bracket")')).toBeVisible();
    await expect(page.locator('button:has-text("Full bracket")')).toBeVisible();
    // Grid size buttons exist in both create and tournament sections; verify at least one is visible
    await expect(page.locator('button:has-text("3×3")').first()).toBeVisible();
    await expect(page.locator('button:has-text("4×4")').first()).toBeVisible();
  });

  test('shows join tournament input', async ({ page }) => {
    await goToLobby(page);
    await page.click('button:has-text("🏆 Tournament")');
    await expect(page.locator('button:has-text("🔗 Join Tournament")')).toBeVisible();
    // Tournament ID input field
    const inputs = page.locator('input[placeholder*="e.g"]');
    await expect(inputs.last()).toBeVisible();
  });

  test('can create a tournament and navigate to tournament lobby', async ({ page }) => {
    await goToLobby(page);
    await page.fill('input[placeholder="Enter your name…"]', 'TourneyHost');
    await page.click('button:has-text("🏆 Tournament")');
    await page.click('button:has-text("4 Players")');
    await page.click('button:has-text("🏆 Create Tournament")');

    // Should navigate to /tournament
    await page.waitForURL(/\/tournament/, { timeout: 15_000 });

    // Tournament lobby should display
    await expect(page.locator('h1:has-text("Tournament")')).toBeVisible();
    // Should show tournament ID label
    await expect(page.locator('label:has-text("Tournament ID"), [class*="text-xs"]:has-text("Tournament ID")').first()).toBeVisible();
    // Should show the host as a participant
    await expect(page.locator('text=TourneyHost')).toBeVisible();
    // Should show waiting status
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/spot|waiting|share/i);
  });

  test('rejects tournament creation without username', async ({ page }) => {
    await goToLobby(page);
    await page.click('button:has-text("🏆 Tournament")');
    // Don't fill username — the Create Tournament button should be disabled
    const createBtn = page.locator('button:has-text("🏆 Create Tournament")');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeDisabled();
    // Should stay on lobby
    expect(page.url()).not.toMatch(/\/tournament/);
  });

});
