import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

  return {
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/tests/setup.js',
      css: false,
    },
    // VITE_BASE_PATH controls asset base path:
    //   - Custom domain deploy: set to '/'
    //   - E2E / local dev: leave unset (defaults to '/')
    base: process.env.VITE_BASE_PATH || '/',
    plugins,
    build: {
      // Generate hidden source maps for Sentry upload during deploys.
      // Upload is handled by sentry-cli in deploy scripts (not vite plugin —
      // self-hosted Sentry's relay rejects the plugin's chunk upload with 413).
      sourcemap: process.env.SENTRY_SOURCEMAPS ? 'hidden' : false,
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
