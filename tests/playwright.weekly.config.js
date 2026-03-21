// tests/playwright.weekly.config.js — Weekly test suite (visual, chaos, contract)
const { defineConfig, devices } = require('@playwright/test');

const BETA_URL = process.env.BETA_URL || 'https://beta.gridlock.pro';

module.exports = defineConfig({
  testDir: './weekly',
  timeout: 120_000,
  globalTimeout: 1_800_000, // 30 min total
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0, // weekly tests should be deterministic
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'tests/results/weekly-results.json' }],
    ['html', { open: 'never', outputFolder: 'tests/results/weekly-report' }],
  ],

  use: {
    baseURL: BETA_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: /visual-regression/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /visual-regression/,
    },
  ],
});
