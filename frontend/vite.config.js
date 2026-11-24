import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Only load Cloudflare plugin when CF_PAGES is set (Cloudflare Pages build environment)
// This avoids breaking local dev, vite preview, and E2E tests
const plugins = [react()];

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const siteUrl = (env.VITE_SITE_URL || 'https://gridlock.pro').replace(/\/+$/, '');
  const robots = env.VITE_ROBOTS || 'index, follow, max-image-preview:large';
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
      include: ['src/**/*.test.{js,jsx}'],
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/tests/setup.js',
      css: false,
    },
    // VITE_BASE_PATH controls asset base path:
    //   - Custom domain deploy: set to '/'
    //   - E2E / local dev: leave unset (defaults to '/')
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [
      ...plugins,
      {
        name: 'gridlock-seo-defaults',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) => html.replaceAll('%VITE_SITE_URL%', siteUrl).replaceAll('%VITE_ROBOTS%', robots),
        },
      },
    ],
    define: {
      'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl),
      'import.meta.env.VITE_ROBOTS': JSON.stringify(robots),
    },
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
