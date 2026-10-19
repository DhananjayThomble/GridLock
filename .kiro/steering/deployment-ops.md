---
inclusion: manual
---

# GridLock — Deployment & Operations

Use this reference when working on deployment, CI/CD, infrastructure, or monitoring.

## Environments

| Environment | Backend Port | MongoDB DB | Branch | Frontend |
|-------------|-------------|------------|--------|----------|
| Production  | 5000        | gridlock   | main   | Nginx `/var/www/gridlock` (gridlock.pro) |
| Beta        | 5001        | gridlock_beta | develop | Nginx `/var/www/gridlock-beta` (beta.gridlock.pro) |
| Local Dev   | 5000        | gridlock   | any    | Vite dev server (localhost:5173) |
| Test        | —           | in-memory  | any    | — |

## How Deploys Work

Pushes to `main` (prod) and `develop` (beta) deploy automatically via
`.github/workflows/deploy.yml` on GitHub-hosted runners: CI → build frontend
(`build-frontend.sh`) → SSH to the 1GB server, whose deploy key is locked to
`server-deploy.sh`. Never build or run tests on the server. Details:
`INFRASTRUCTURE.md` → Deploying.

## Deploy Scripts (in `scripts/`)

- `build-frontend.sh [prod|beta]` — Build frontend + SEO prerender (runs in GitHub Actions)
- `server-deploy.sh` — SSH forced command on the server (installed as `/usr/local/bin/gridlock-deploy`)
- `deploy-backend.sh` — Production backend deploy (acquires lock, git pull, npm ci, pm2 reload, health check with auto-rollback)
- `deploy-beta.sh` — Manual beta deploy (builds on the server — fallback only)
- `deploy-frontend.sh` — Manual frontend deploy to Nginx (builds on the server — fallback only)
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

## Health Checks

- `GET /health` — Lightweight (uptime, memory, connections)
- `GET /health/deep` — Comprehensive (MongoDB, Redis, game store stats)

## Monitoring

- Sentry: Error tracking (frontend + backend) — optional, currently off; enabled via `VITE_SENTRY_DSN` / `SENTRY_DSN`
- PostHog: Product analytics (frontend) — optional, currently off; enabled via `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`
- Prometheus: `/metrics` endpoint (internal IP only)
- PM2 logs: `pm2 logs gridlock-backend --lines 50`
