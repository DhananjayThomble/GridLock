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
      // React Compiler is not in use — this rule produces false positives on
      // manual useMemo/useCallback patterns without the compiler transform.
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
])
