#!/usr/bin/env node
// smoke-test.js — quick Playwright sanity check for prod + beta
// Run: node scripts/smoke-test.js
// Exit 0 = all good, Exit 1 = something broken (safe to block deploy)

const { chromium } = require('playwright');

const URLS = [
  { label: 'PROD', url: 'http://localhost/' },
  { label: 'BETA', url: 'http://localhost/beta/' },
];

const REQUIRED_TEXT = 'Dots & Boxes'; // must appear on lobby screen

(async () => {
  const browser = await chromium.launch({ headless: true });
  let allPassed = true;

  for (const { label, url } of URLS) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      const rootHTML = await page.locator('#root').innerHTML().catch(() => '');
      const bodyText = await page.locator('body').innerText().catch(() => '');

      const isEmpty  = rootHTML.trim().length < 10;
      const hasError = errors.length > 0;
      const hasTEXT  = bodyText.includes(REQUIRED_TEXT);

      const pass = !isEmpty && !hasError && hasTEXT;
      allPassed = allPassed && pass;

      if (pass) {
        console.log(`✅ ${label} OK — "${REQUIRED_TEXT}" found, no JS errors`);
      } else {
        console.error(`❌ ${label} FAILED`);
        if (isEmpty)  console.error(`   #root is empty (blank screen)`);
        if (hasError) console.error(`   JS errors: ${errors.join('; ')}`);
        if (!hasTEXT) console.error(`   "${REQUIRED_TEXT}" not found in page`);
      }
    } catch (e) {
      console.error(`❌ ${label} FAILED — navigation error: ${e.message}`);
      allPassed = false;
    }

    await page.close();
  }

  await browser.close();
  process.exit(allPassed ? 0 : 1);
})();
