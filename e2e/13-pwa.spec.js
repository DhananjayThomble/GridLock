// e2e/13-pwa.spec.js — PWA manifest, service worker, and install prompt

const { test, expect } = require('@playwright/test');
const { goToLobby, BASE_URL } = require('./helpers');

test.describe('PWA Support', () => {

  test('manifest.json is accessible and valid', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/manifest.json`);
    expect(res.ok()).toBeTruthy();

    const manifest = await res.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toBeInstanceOf(Array);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    // Every icon must have src and sizes
    for (const icon of manifest.icons) {
      expect(icon.src).toBeTruthy();
      expect(icon.sizes).toBeTruthy();
    }
  });

  test('sw.js is accessible', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/sw.js`);
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain('CACHE_NAME');
    expect(text).toContain('fetch');
  });

  test('index.html contains manifest link and theme-color', async ({ page }) => {
    await goToLobby(page);
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);

    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveCount(1);
    await expect(themeColor).toHaveAttribute('content', '#0F172A');
  });

  test('install button appears when beforeinstallprompt fires', async ({ page }) => {
    await goToLobby(page);

    // Initially no install button
    await expect(page.locator('button:has-text("📲 Install App")')).toHaveCount(0);

    // Simulate beforeinstallprompt
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt');
      event.preventDefault = () => {};
      event.prompt = () => Promise.resolve();
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });

    // Install button should now be visible
    await expect(page.locator('button:has-text("📲 Install App")')).toBeVisible({ timeout: 3000 });
  });

  test('install button hidden in standalone mode', async ({ browser }) => {
    // Launch with display-mode: standalone emulated via CDP
    const context = await browser.newContext({
      // Simulate standalone by injecting matchMedia override
    });
    const page = await context.newPage();

    // Override matchMedia before navigation
    await page.addInitScript(() => {
      const original = window.matchMedia;
      window.matchMedia = (query) => {
        if (query === '(display-mode: standalone)') {
          return { matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} };
        }
        return original(query);
      };
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Fire beforeinstallprompt — button should NOT appear because standalone
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt');
      event.preventDefault = () => {};
      event.prompt = () => Promise.resolve();
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });

    // Wait a tick and verify no install button
    await page.waitForTimeout(500);
    await expect(page.locator('button:has-text("📲 Install App")')).toHaveCount(0);

    await context.close();
  });
});
