# GridLock Infrastructure

## Directory Layout

```
~/projects/
├── GridLock/              # Dev/build worktree — branches freely switched here
│   ├── backend/           # NOT used by production PM2
│   ├── frontend/          # Build & dev
│   └── scripts/           # Deploy scripts (version-controlled)
│
├── GridLock-prod/         # PRODUCTION — locked to main branch
│   ├── backend/           # PM2 runs from here (port 5000)
│   ├── PRODUCTION_DIR_DO_NOT_DEVELOP_HERE
│   └── deploy.log         # Deployment history
│
└── GridLock-beta/         # BETA — locked to develop branch
    └── backend/           # PM2 runs from here (port 5001)
```

## Why Separate Directories?

The dev worktree (`GridLock/`) is used for branch switching, builds, CI checks,
and GitHub Pages deployments. Switching to `gh-pages` deletes `node_modules`
and backend files, which **breaks production** if PM2 is running from the same
directory.

The fix: production runs from a **dedicated clone** (`GridLock-prod/`) that
never switches branches. Dev work happens in `GridLock/` without risk.

## PM2 Processes

| Name                   | Directory            | Port | Branch    |
|------------------------|----------------------|------|-----------|
| `gridlock-backend`     | `GridLock-prod/backend/` | 5000 | `main`    |
| `gridlock-beta-backend`| `GridLock-beta/backend/` | 5001 | `develop` |
| `gh-notify`            | —                    | —    | —         |

## Deploying

### Backend (Production)

```bash
# Normal deploy — pulls latest main, installs deps, reloads PM2
./scripts/deploy-backend.sh

# Preview what would change
./scripts/deploy-backend.sh --dry-run

# Rollback to previous release
./scripts/deploy-backend.sh --rollback
```

The deploy script:
1. Fetches `origin/main` in the prod directory
2. Saves current commit hash for rollback
3. `git reset --hard origin/main`
4. `npm ci --production`
5. `pm2 reload gridlock-backend`
6. Health check on `localhost:5000/health`
7. Auto-rollback if health check fails

### Backend (Beta)

```bash
./scripts/deploy-beta.sh
```

### Frontend

Frontend is deployed via GitHub Pages workflow (`.github/workflows/deploy-pages.yml`).
See issue #185 for the dedicated deploy script.

## Safety Rules

1. **Never switch branches** in `GridLock-prod/` — it must always be on `main`
2. **Never run dev builds** in `GridLock-prod/` — use `GridLock/` for that
3. **Always use deploy scripts** — don't manually `git pull` in prod directories
4. The `PRODUCTION_DIR_DO_NOT_DEVELOP_HERE` marker file exists as a reminder

## CI/CD

The GitHub Actions workflow (`.github/workflows/deploy-backend.yml`) SSHes into
the server and runs `./scripts/deploy-backend.sh` for automated deployments on
push to `main`.
