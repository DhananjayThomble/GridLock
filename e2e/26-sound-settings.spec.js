// e2e/26-sound-settings.spec.js — Sound & Haptic settings panel

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('Sound & Haptic Settings', () => {

  test.beforeEach(async ({ page }) => {
    await goToLobby(page);
  });

  test('opens and closes settings panel', async ({ page }) => {
    const trigger = page.getByTestId('sound-settings-trigger');
    await expect(trigger).toBeVisible();

    // Panel should be hidden initially
    await expect(page.getByTestId('sound-settings-panel')).not.toBeVisible();

    // Open panel
    await trigger.click();
    await expect(page.getByTestId('sound-settings-panel')).toBeVisible();

    // Close panel
    await trigger.click();
    await expect(page.getByTestId('sound-settings-panel')).not.toBeVisible();
  });

  test('toggles individual sound controls', async ({ page }) => {
    await page.getByTestId('sound-settings-trigger').click();

    const toggles = [
      'toggle-move-sound',
      'toggle-score-sound',
      'toggle-turn-alert',
      'toggle-vibration',
    ];

    for (const tid of toggles) {
      const toggle = page.getByTestId(tid);
      await expect(toggle).toBeVisible();

      // Default: enabled (aria-checked=true)
      await expect(toggle).toHaveAttribute('aria-checked', 'true');

      // Click to disable
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');

      // Click to re-enable
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
  });

  test('master mute toggle works', async ({ page }) => {
    await page.getByTestId('sound-settings-trigger').click();

    const masterToggle = page.getByTestId('toggle-master-mute');
    await expect(masterToggle).toBeVisible();

    // Default: not muted (aria-checked=true means sounds ON)
    await expect(masterToggle).toHaveAttribute('aria-checked', 'true');

    // Mute all
    await masterToggle.click();
    await expect(masterToggle).toHaveAttribute('aria-checked', 'false');

    // Verify individual toggles are visually disabled when master mute is on
    const toggleIds = [
      'toggle-move-sound',
      'toggle-score-sound',
      'toggle-turn-alert',
      'toggle-vibration',
    ];
    for (const tid of toggleIds) {
      const toggle = page.getByTestId(tid);
      await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    }

    // Unmute
    await masterToggle.click();
    await expect(masterToggle).toHaveAttribute('aria-checked', 'true');

    // Verify individual toggles are no longer disabled
    for (const tid of toggleIds) {
      const toggle = page.getByTestId(tid);
      await expect(toggle).toHaveAttribute('aria-disabled', 'false');
    }
  });

  test('volume slider changes value', async ({ page }) => {
    await page.getByTestId('sound-settings-trigger').click();

    const slider = page.getByTestId('volume-slider');
    const display = page.getByTestId('volume-display');

    // Default volume is 80%
    await expect(display).toHaveText('80%');

    // Change volume to 50 via fill
    await slider.fill('50');
    await expect(display).toHaveText('50%');

    // Change to 100
    await slider.fill('100');
    await expect(display).toHaveText('100%');
  });

  test('settings persist across page reload', async ({ page }) => {
    await page.getByTestId('sound-settings-trigger').click();

    // Disable move sound
    const moveToggle = page.getByTestId('toggle-move-sound');
    await moveToggle.click();
    await expect(moveToggle).toHaveAttribute('aria-checked', 'false');

    // Change volume to 40
    await page.getByTestId('volume-slider').fill('40');
    await expect(page.getByTestId('volume-display')).toHaveText('40%');

    // Reload page
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('GridLock');

    // Reopen settings
    await page.getByTestId('sound-settings-trigger').click();

    // Verify persisted values
    await expect(page.getByTestId('toggle-move-sound')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('volume-display')).toHaveText('40%');
  });

  test('backward compat: migrates old gridlock_muted key', async ({ page }) => {
    // Set old mute key before loading
    await page.evaluate(() => {
      localStorage.setItem('gridlock_muted', 'true');
      localStorage.removeItem('gridlock_sound_settings');
    });

    // Reload to trigger migration
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('GridLock');

    await page.getByTestId('sound-settings-trigger').click();

    // Master mute should be ON (sounds OFF) — aria-checked=false
    await expect(page.getByTestId('toggle-master-mute')).toHaveAttribute('aria-checked', 'false');

    // Old key should be removed
    const oldKey = await page.evaluate(() => localStorage.getItem('gridlock_muted'));
    expect(oldKey).toBeNull();

    // New key should exist
    const newKey = await page.evaluate(() => localStorage.getItem('gridlock_sound_settings'));
    expect(newKey).not.toBeNull();
    const parsed = JSON.parse(newKey);
    expect(parsed.masterMute).toBe(true);
  });
});
