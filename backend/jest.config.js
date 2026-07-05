/**
 * Jest configuration for the GridLock backend.
 *
 * Coverage is OFF by default, so `npm test` (used by the pre-commit hook and
 * scripts/merge-gate.sh) behaves exactly as before and does NOT enforce thresholds.
 * Coverage collection and the thresholds below apply only when Jest runs with
 * `--coverage`, i.e. via `npm run test:coverage`.
 *
 * NOTE: the thresholds are a deliberately conservative INITIAL FLOOR. They were not
 * calibrated against a real coverage run in the authoring environment (the
 * mongodb-memory-server MongoDB binary was not available there). After running
 * `npm run test:coverage` on a machine where the suite runs, raise these to just below
 * the measured values so coverage ratchets up over time.
 */
module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'controllers/**/*.js',
    'models/**/*.js',
    'routes/**/*.js',
    'middleware/**/*.js',
    'services/**/*.js',
    'stores/**/*.js',
    'utils/**/*.js',
    'config/**/*.js',
    'lib/**/*.js',
    '!**/__tests__/**',
    '!**/node_modules/**',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 40,
      branches: 40,
      functions: 40,
      lines: 40,
    },
  },
};
