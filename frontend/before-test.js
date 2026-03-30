const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();
  
  await page.route('**/api/auth/me', route => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        user: {
          id: '123', username: 'DJTest', displayName: 'Dhananjay',
          email: 'dj@example.com',
          avatar: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
          usernameSetupComplete: true, createdAt: '2026-03-30T10:00:00Z'
        }
      })
    });
  });
  
  for (const url of ['/', '/leaderboard', '/settings']) {
    await page.goto('https://beta.gridlock.pro' + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const btn = await page.locator('.mobile-header button').last();
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: '/tmp/before' + url.replace(/\//g, '-') + '.png' });
  }
  
  await page.goto('https://beta.gridlock.pro/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/before-settings-full.png', fullPage: true });
  
  await browser.close();
  console.log('BEFORE screenshots done');
})();
