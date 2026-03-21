import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Only load Cloudflare plugin when CF_PAGES is set (Cloudflare Pages build environment)
// This avoids breaking local dev, vite preview, and E2E tests
const plugins = [react()];

// https://vite.dev/config/
export default defineConfig(async () => {
  if (process.env.CF_PAGES) {
    try {
      const { cloudflare } = await import("@cloudflare/vite-plugin");
      plugins.push(cloudflare());
    } catch (err) {
      console.error(
        '⚠️  CF_PAGES is set but @cloudflare/vite-plugin failed to load.\n' +
        '   Install it with: npm install -D @cloudflare/vite-plugin\n' +
        '   Error:', err.message
      );
      process.exit(1);
    }
  }

  // Sentry source map upload — optional, only runs when SENTRY_AUTH_TOKEN is set
  if (process.env.SENTRY_AUTH_TOKEN) {
    plugins.push(
      sentryVitePlugin({
        org: process.env.SENTRY_ORG || 'sentry',
        project: process.env.SENTRY_PROJECT || 'gridlock-frontend',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        url: process.env.SENTRY_URL || 'https://sentry.gridlock.pro',
        sourcemaps: {
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
        telemetry: false,
      })
    );
  }

  return {
    // VITE_BASE_PATH controls asset base path:
    //   - Custom domain deploy: set to '/'
    //   - E2E / local dev: leave unset (defaults to '/')
    base: process.env.VITE_BASE_PATH || '/',
    plugins,
    build: {
      // Generate source maps for Sentry — hidden maps are uploaded but not served publicly
      sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
    },
    server: {
      proxy: {
        '/socket.io': {
          target: 'http://localhost:5000',
          ws: true,
        },
        '/api': {
          target: 'http://localhost:5000',
        },
      },
    },
  }
})
