// tests/playwright.weekly.config.js — Weekly test suite (visual, chaos, contract)
const { defineConfig, devices } = require('@playwright/test');

const BETA_URL = process.env.BETA_URL || 'https://beta.gridlock.pro';

module.exports = defineConfig({
  testDir: './weekly',
  timeout: 12_000_000,
  globalTimeout: 720_000_000, // 200h — intentionally large per DJ's requirement (no timeout)
  expect: { timeout: 1_500_000 },
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
    trace: 'retain-on-failure',
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
