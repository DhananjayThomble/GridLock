// e2e/01-lobby.spec.js — Lobby rendering & basic navigation

const { test, expect } = require('@playwright/test');
const { goToLobby, createGame, BASE_URL } = require('./helpers');

test.describe('Lobby', () => {

  test('renders without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await goToLobby(page);

    expect(errors, `JS errors: ${errors.join('; ')}`).toHaveLength(0);
    await expect(page.locator('body')).toContainText('GridLock');
  });

  test('shows Create and Join tabs', async ({ page }) => {
    await goToLobby(page);
    await expect(page.locator('button:has-text("🚀 Create Game"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("🔗 Join Game"):visible').first()).toBeVisible();
  });

  test('shows player count and grid size options', async ({ page }) => {
    await goToLobby(page);
    await expect(page.locator('button:has-text("2 Players"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("3 Players"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("4 Players"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("3×3"):visible').first()).toBeVisible();
    await expect(page.locator('button:has-text("5×5"):visible').first()).toBeVisible();
  });

  test('shows Join tab with game code input', async ({ page }) => {
    await goToLobby(page);
    await page.locator('button:has-text("🔗 Join Game"):visible').first().click();
    await expect(page.locator('input[placeholder*="e.g"]')).toBeVisible();
  });

  test('rejects Create Game without a username', async ({ page }) => {
    await goToLobby(page);
    // Don't fill username — Create Game button should be disabled
    const createBtn = page.locator('button:has-text("🚀 Create Game"):visible').first();
    await expect(createBtn).toBeDisabled();
    // Verify we stay on lobby
    expect(page.url()).not.toMatch(/\/(game|waiting)/);
  });

  test('shows avatar picker', async ({ page }) => {
    await goToLobby(page);
    // Avatar buttons exist — check via text content of all buttons
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('👦');
    expect(bodyText).toContain('🤖');
  });

  test('/beta route loads correctly (correct basename)', async ({ page }) => {
    // Verify the beta route itself works (regression: blank screen from basename bug)
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE_URL);
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors).toHaveLength(0);
  });

});
