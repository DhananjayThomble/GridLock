// e2e/env-config.js — single source of truth for E2E environment URLs
//
// TEST_ENV controls which environment the E2E suite targets:
//   local (default) — isolated local backend (port 5105 via test-e2e-local.sh)
//   beta            — https://beta-gridlock.snapurl.in
//   prod            — https://gridlock.snapurl.in (API: gridlock-api.snapurl.in)
//
// Explicit TEST_BASE_URL / TEST_API_URL / SOCKET_URL still override if set.

const ENV_CONFIGS = {
  local: {
    baseURL:   process.env.CI ? 'http://localhost:4173' : 'http://localhost/beta',
    apiURL:    process.env.CI ? 'http://127.0.0.1:5000' : 'http://127.0.0.1:5105',
    socketURL: process.env.CI ? 'http://127.0.0.1:5000' : 'http://127.0.0.1:5105',
  },
  beta: {
    baseURL:   'https://beta-gridlock.snapurl.in',
    apiURL:    'https://beta-gridlock.snapurl.in',
    socketURL: 'https://beta-gridlock.snapurl.in',
  },
  prod: {
    baseURL:   'https://gridlock.snapurl.in',
    apiURL:    'https://gridlock-api.snapurl.in',
    socketURL: 'https://gridlock-api.snapurl.in',
  },
};

const TEST_ENV = (process.env.TEST_ENV || 'local').toLowerCase();
if (!ENV_CONFIGS[TEST_ENV]) {
  throw new Error(`Unknown TEST_ENV="${TEST_ENV}". Must be one of: ${Object.keys(ENV_CONFIGS).join(', ')}`);
}

const envCfg = ENV_CONFIGS[TEST_ENV];

module.exports = { ENV_CONFIGS, TEST_ENV, envCfg };
