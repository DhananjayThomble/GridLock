import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Base path for GitHub Pages: assets served from /GridLock/ in production.
  // process.env.GITHUB_ACTIONS is set automatically by GitHub Actions runners.
  base: process.env.GITHUB_ACTIONS ? '/GridLock/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
})
