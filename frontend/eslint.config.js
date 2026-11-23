import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-beta']),
  // Node config files (vite.config.js etc.) — use Node globals
  {
    files: ['vite.config.js', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // React source files
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  // Keep the new rules visible on legacy code while enforcing them elsewhere.
  {
    files: [
      'src/components/AuthSetup.jsx',
      'src/components/DailyChallenge.jsx',
      'src/components/DailyLeaderboard.jsx',
      'src/components/DailyResult.jsx',
      'src/components/GameHistory.jsx',
      'src/components/Profile.jsx',
    ],
    rules: { 'react-hooks/set-state-in-effect': 'warn' },
  },
  {
    files: [
      'src/components/lobby/AvatarGrid.jsx',
      'src/components/lobby/GridSizeSelector.jsx',
      'src/components/lobby/PlayerCountSelector.jsx',
    ],
    rules: { 'react-refresh/only-export-components': 'warn' },
  },
  // Test files run under Vitest (jsdom + Node) — allow Node globals like `global`
  {
    files: ['src/**/__tests__/**/*.{js,jsx}', 'src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
