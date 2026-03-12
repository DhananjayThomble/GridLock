// playwright.config.js
// Runs against a live server (backend on :5000 in CI, backend on :5105 locally via test-e2e-local.sh)
//
// PORT ISOLATION STRATEGY
// -----------------------
// PM2 owns port 5000 on this host permanently. If a test backend tries to bind :5000 it
// crashes silently and the frontend ends up talking to the PM2 instance (stale game state).
// Multiplayer/spectator tests fail because games already have wrong players.
//
// Solution: scripts/test-e2e-local.sh starts an isolated backend on :5105 and a Vite
// preview on :4175, then sets TEST_BASE_URL before launching Playwright. This means:
//
//   npm run test:e2e:local     → uses isolated ports (safe, always works)
//   npm run test:e2e           → uses http://localhost/beta (Nginx, needs PM2 running)
//   CI (process.env.CI=true)   → backend starts fresh on :5000 (no PM2 in CI runners)
//
// Never override TEST_BASE_URL to :5000 locally — you'll hit PM2 stale state.

const { defineConfig, devices } = require('@playwright/test');

// ---------------------------------------------------------------------------
// Environment resolution
// ---------------------------------------------------------------------------
// TEST_ENV controls which environment the E2E suite targets:
//   local (default) — isolated local backend (port 5105 via test-e2e-local.sh)
//   beta            — https://beta-gridlock.snapurl.in  (API: gridlock-api.snapurl.in)
//   prod            — https://gridlock.snapurl.in       (API: gridlock-api.snapurl.in)
//
// Explicit TEST_BASE_URL / TEST_API_URL / SOCKET_URL still override if set.
// ---------------------------------------------------------------------------

const ENV_CONFIGS = {
  local: {
    baseURL: process.env.CI ? 'http://localhost:4173' : 'http://localhost/beta',
    apiURL:  process.env.CI ? 'http://127.0.0.1:5000' : 'http://127.0.0.1:5105',
    socketURL: process.env.CI ? 'http://127.0.0.1:5000' : 'http://127.0.0.1:5105',
  },
  beta: {
    baseURL:   'https://beta-gridlock.snapurl.in',
    apiURL:    'https://gridlock-api.snapurl.in',
    socketURL: 'https://gridlock-api.snapurl.in',
  },
  prod: {
    baseURL:   'https://gridlock.snapurl.in',
    apiURL:    'https://gridlock-api.snapurl.in',
    socketURL: 'https://gridlock-api.snapurl.in',
  },
};

const TEST_ENV = (process.env.TEST_ENV || 'local').toLowerCase();
if (!ENV_CONFIGS[TEST_ENV]) {
  throw new Error(`Unknown TEST_ENV="${TEST_ENV}". Must be one of: local, beta, prod`);
}

const envCfg   = ENV_CONFIGS[TEST_ENV];
const BASE_URL = process.env.TEST_BASE_URL || envCfg.baseURL;

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
      testIgnore: /\/(27|28|29)-.*\.spec\.js$/,
    },
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone 14'] },
      testMatch: /\/(27|28|29)-.*\.spec\.js$/,
    },
    {
      name: 'mobile-pixel',
      use: { ...devices['Pixel 7'] },
      testMatch: /\/(27|28|29)-.*\.spec\.js$/,
    },
    {
      name: 'tablet-ipad',
      use: { ...devices['iPad Mini'] },
      testMatch: /\/(27|28|29)-.*\.spec\.js$/,
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
