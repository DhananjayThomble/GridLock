/**
 * Jest configuration for the GridLock backend.
 *
 * Coverage is OFF by default, so `npm test` (used by the pre-commit hook and
 * scripts/merge-gate.sh) behaves exactly as before and does NOT enforce thresholds.
 * Coverage collection and the thresholds below apply only when Jest runs with
 * `--coverage`, i.e. via `npm run test:coverage`.
 *
 * NOTE: thresholds are calibrated to sit just below the current measured coverage
 * (statements ~49.5%, branches ~41.9%, functions ~60.1%, lines ~51.8% across 714 passing
 * tests) so they act as a regression ratchet without breaking on minor variation. Raise
 * them over time as coverage improves.
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
      statements: 48,
      branches: 40,
      functions: 58,
      lines: 50,
    },
  },
};
