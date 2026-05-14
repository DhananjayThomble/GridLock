---
inclusion: manual
---

# GridLock — Deployment & Operations

Use this reference when working on deployment, CI/CD, infrastructure, or monitoring.

## Environments

| Environment | Backend Port | MongoDB DB | Branch | Frontend |
|-------------|-------------|------------|--------|----------|
| Production  | 5000        | gridlock   | main   | Cloudflare Pages (gridlock.pro) |
| Beta        | 5001        | gridlock_beta | develop | Cloudflare Pages (beta.gridlock.pro) |
| Local Dev   | 5000        | gridlock   | any    | Vite dev server (localhost:5173) |
| Test        | —           | in-memory  | any    | — |

## Deploy Scripts (in `scripts/`)

- `deploy-backend.sh` — Production backend deploy (acquires lock, git pull, npm ci, pm2 reload, health check with auto-rollback)
- `deploy-beta.sh` — Beta backend deploy
- `deploy-frontend.sh` — Frontend deploy to GitHub Pages (legacy, now using Cloudflare)
- `rollback.sh` — Rollback to previous backend version
- `bump-version.sh <version>` — Sync version across all package.json files
- `release.sh` — Full release workflow
- `ci-test.sh` — CI test runner (backend tests + optional E2E)
- `ci-deploy.sh` — CI deploy orchestrator
- `smoke-test.js` — Post-deploy smoke test

## PM2 Configuration

Defined in `ecosystem.config.js`:
- `gridlock-backend` — Production (port 5000)
- `gridlock-beta-backend` — Beta (port 5001)
- `gh-notify` — Webhook listener for auto-deploy

## Health Checks

- `GET /health` — Lightweight (uptime, memory, connections)
- `GET /health/deep` — Comprehensive (MongoDB, Redis, game store stats)

## Monitoring

- Sentry: Error tracking (frontend + backend)
- PostHog: Product analytics (frontend)
- Prometheus: `/metrics` endpoint (internal IP only)
- PM2 logs: `pm2 logs gridlock-backend --lines 50`
