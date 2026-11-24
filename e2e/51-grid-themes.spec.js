const { test, expect } = require('@playwright/test');

test('every grid theme is available to guests and the selection persists', async ({ page }) => {
  await page.goto('/settings');

  const names = ['Clean', 'Classic', 'Minimal', 'Neon Glow', 'Glassmorphism'];
  for (const name of names) {
    const theme = page.getByRole('button', { name, exact: true });
    await expect(theme).toBeEnabled();
    await theme.click();
    await expect(theme).toHaveAttribute('aria-pressed', 'true');
  }

  await page.reload();
  await expect(page.getByRole('button', { name: 'Glassmorphism', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the saved theme from before the unlock requirements were removed', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gridlock_grid_theme', 'classic');
    localStorage.setItem('gridlock_unlocked_themes', JSON.stringify(['clean', 'classic']));
  });
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Classic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const neon = page.getByRole('button', { name: 'Neon Glow', exact: true });
  await neon.click();
  await expect(neon).toHaveAttribute('aria-pressed', 'true');
});
