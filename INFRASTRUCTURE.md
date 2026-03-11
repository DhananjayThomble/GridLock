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

# Preview what would change (no log writes, no side effects)
./scripts/deploy-backend.sh --dry-run

# Rollback to previous release
./scripts/deploy-backend.sh --rollback
```

The deploy script:
1. Acquires a deploy lock (prevents concurrent deploys)
2. Rotates the deploy log (keeps last 1000 lines)
3. Fetches `origin/main` in the prod directory
4. Saves current commit hash for rollback
5. `git reset --hard origin/main`
6. `npm ci --omit=dev`
7. `pm2 reload gridlock-backend`
8. Health check with retry (5 attempts, 2s apart) on `localhost:5000/health`
9. Auto-rollback if health check fails
10. Releases the deploy lock

### Backend (Beta)

```bash
./scripts/deploy-beta.sh
```

### Frontend (GitHub Pages)

```bash
# Deploy to production (builds + pushes to gh-pages)
./scripts/deploy-frontend.sh

# Preview build without pushing (validates everything works)
./scripts/deploy-frontend.sh --dry-run
```

**Custom environment (optional):**
```bash
VITE_API_BASE_URL=http://localhost:5000 \
VITE_SOCKET_URL=http://localhost:5000 \
  ./scripts/deploy-frontend.sh --dry-run
```

The deploy script:
1. Builds the frontend in the dev worktree (`frontend/`)
2. Creates a **git worktree** at `/tmp/gh-pages-deploy` for the `gh-pages` branch
3. Cleans old files and copies the fresh `dist/` output
4. Adds `CNAME` (`gridlock.snapurl.in`) and `404.html` (SPA routing)
5. Commits with deploy message (commit hash + timestamp)
6. Pushes to `gh-pages`
7. Removes the worktree

**Safety:** The script **never** checks out `gh-pages` in the main worktree.
This prevents the `node_modules` deletion that broke production on 2026-03-11.
A trap handler cleans up the worktree on any failure or interruption.

**CI/CD:** The GitHub Actions workflow (`.github/workflows/deploy-pages.yml`)
uses GitHub's deploy-pages action for automated deployments on push to `main`.
For manual deploys from the server, use the script above.

## Safety Rules

1. **Never switch branches** in `GridLock-prod/` — it must always be on `main`
2. **Never run dev builds** in `GridLock-prod/` — use `GridLock/` for that
3. **Always use deploy scripts** — don't manually `git pull` in prod directories
4. The `PRODUCTION_DIR_DO_NOT_DEVELOP_HERE` marker file exists as a reminder

## Deploy Lock (Concurrency Protection)

The deploy script uses a lockfile (`/tmp/gridlock-deploy.lock`) to prevent
concurrent deploys from corrupting production. The lock contains the PID of the
running deploy process.

- On start, the script checks if the lock exists and whether the owning PID is alive.
- If the PID is dead (stale lock from a crashed/killed process), the lock is
  automatically removed and the deploy proceeds with a warning.
- If the PID is alive, the deploy aborts immediately.
- The lock is released on successful completion, rollback, or interruption.

To manually clear a stale lock: `rm /tmp/gridlock-deploy.lock`

## Trap Handler (Interruption Safety)

If the deploy script receives `SIGINT`, `SIGTERM`, or `SIGHUP` mid-deploy
(e.g., Ctrl+C, `kill`, SSH drop), a trap handler fires that:

1. Automatically rolls back to the previously saved commit (`git reset --hard`)
2. Reinstalls dependencies for the rolled-back code (`npm ci --omit=dev`)
3. Reloads PM2
4. Runs a retry health check (5 attempts, 2s apart) to confirm rollback succeeded
5. Releases the deploy lock

This ensures production is **never left in a half-deployed state**. If the
rollback itself fails, the script exits with a `MANUAL INTERVENTION REQUIRED`
message in the deploy log.

The trap only activates during the critical deploy window (after `git reset` begins
and before the health check passes). Outside this window, interruptions just
release the lock and exit cleanly.

## CI/CD

The GitHub Actions workflow (`.github/workflows/deploy-backend.yml`) SSHes into
the server and runs `./scripts/deploy-backend.sh` for automated deployments on
push to `main`.

**Note:** The workflow hardcodes paths (`~/projects/GridLock` and
`~/projects/GridLock-prod`) that assume the EC2 directory structure documented
above. If the server layout changes, update both the workflow and the deploy
script's `PROD_DIR` variable.
