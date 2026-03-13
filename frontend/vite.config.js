import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  // VITE_BASE_PATH controls asset base path:
  //   - Custom domain deploy: set to '/'
  //   - E2E / local dev: leave unset (defaults to '/')
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), cloudflare()],
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
})