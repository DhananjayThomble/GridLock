// playwright.config.js
// Runs against a live server (backend on :5000, frontend served by Nginx or vite preview)
// In CI: uses vite preview on :4173 (base=/), backend on :5000
// Locally: uses http://localhost/beta (via Nginx) or override with TEST_BASE_URL

const { defineConfig, devices } = require('@playwright/test');

// Locally default to /beta (Nginx). In CI, vite preview runs at root /.
const DEFAULT_URL = process.env.CI ? 'http://localhost:4173' : 'http://localhost/beta';
const BASE_URL    = process.env.TEST_BASE_URL || DEFAULT_URL;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,        // game tests share backend socket state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                  // one worker — socket-based game state is sequential
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'],   ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: BASE_URL,
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
  ],

  // In CI: start vite preview before tests, kill after.
  // The build is run as a prior CI step so dist/ is ready.
  webServer: process.env.CI ? {
    command: 'cd frontend && npx vite preview --port 4173 --base=/',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  } : undefined,
});
