# GridLock frontend

The React and Vite app runs the lobby, live board, daily challenges, and replay viewer. It connects to the Express and Socket.IO backend for multiplayer state and match history.

From this directory, install dependencies and start Vite:

```bash
npm ci
npm run dev
```

Start the backend and MongoDB with the [project quick start](../README.md#quick-start). Vite proxies local API and Socket.IO traffic to the backend on port 5000. See [`.env.example`](.env.example) for settings used by deployments and remote backends.

| Command | What it checks |
|---|---|
| `npm test` | Vitest component and utility tests |
| `npm run lint` | ESLint |
| `npm run build` | Production bundle in `dist/` |
| `npm run build:seo` | Production bundle, prerendered public pages, and sitemap for indexable deployments |

For the two-browser gameplay smoke test, use the [contributor guide](../CONTRIBUTING.md#checks-to-run-before-opening-a-pr).
