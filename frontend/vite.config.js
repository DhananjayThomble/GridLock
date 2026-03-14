import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Only load Cloudflare plugin when CF_PAGES is set (Cloudflare Pages build environment)
// This avoids breaking local dev, vite preview, and E2E tests
const plugins = [react()];

// https://vite.dev/config/
export default defineConfig(async () => {
  // CF_PAGES is set automatically by Cloudflare Pages build environment.
  // Production and beta both deploy to EC2 Nginx (not Cloudflare Pages), so
  // this plugin will NOT load in any current deploy path — it is kept for
  // potential future use. Remove if Cloudflare Pages is fully abandoned.
  if (process.env.CF_PAGES) {
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(cloudflare());
  }

  return {
    // VITE_BASE_PATH controls asset base path:
    //   - Custom domain deploy: set to '/'
    //   - E2E / local dev: leave unset (defaults to '/')
    base: process.env.VITE_BASE_PATH || '/',
    plugins,
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
