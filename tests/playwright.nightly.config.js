// tests/playwright.nightly.config.js — Nightly test suite against live beta
const { defineConfig, devices } = require('@playwright/test');

const BETA_URL = process.env.BETA_URL || 'https://beta.gridlock.pro';
const BETA_API = process.env.BETA_API || 'https://beta-api.gridlock.pro';

module.exports = defineConfig({
  testDir: './nightly',
  timeout: 60_000,
  globalTimeout: 7_200_000, // 2 hours
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'tests/results/nightly-results.json' }],
    ['html', { open: 'never', outputFolder: 'tests/results/nightly-report' }],
  ],

  use: {
    baseURL: BETA_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Custom env passed to tests
    extraHTTPHeaders: {},
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
