# GridLock Infrastructure

## Database Mapping

Each environment connects to its own MongoDB database to prevent cross-environment
data contamination. The `MONGO_URI` is set via PM2's `ecosystem.config.js`.

| Environment | Database           | MONGO_URI                                  | Set via              |
|-------------|--------------------|--------------------------------------------|----------------------|
| Production  | `gridlock`         | `mongodb://localhost:27017/gridlock`       | ecosystem.config.js  |
| Beta        | `gridlock_beta`    | `mongodb://localhost:27017/gridlock_beta`  | ecosystem.config.js  |
| Test (Jest) | `gridlock-test`    | `mongodb://localhost:27017/gridlock-test`  | Test setup / in-memory |
| E2E         | `gridlock_e2e_local` | `mongodb://localhost:27017/gridlock_e2e_local` | E2E config       |

> **Production safety:** If `NODE_ENV=production` and `MONGO_URI` is not set,
> the server exits immediately with a FATAL error. This prevents production
> from silently falling back to a default database.

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
4. Adds `CNAME` (`gridlock.pro`) and `404.html` (SPA routing)
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

## PM2 Ecosystem Config

All PM2 processes are defined in `ecosystem.config.js` at the repo root.

### Usage

```bash
# Start all processes
pm2 start ecosystem.config.js

# Start a specific process
pm2 start ecosystem.config.js --only gridlock-backend

# Reload all (zero-downtime)
pm2 reload ecosystem.config.js

# Restart a specific process
pm2 restart gridlock-backend
```

### Log Rotation

PM2 log rotation is handled by `pm2-logrotate`:

- **Max file size:** 10M
- **Retained files:** 5
- **Compression:** enabled (gzip)

To check/reconfigure:

```bash
pm2 conf pm2-logrotate
```

### Boot Persistence

To ensure PM2 processes survive server reboots:

```bash
# Generate the startup script (requires sudo — run manually)
pm2 startup

# After starting all desired processes, save the process list
pm2 save
```

**Note:** `pm2 startup` outputs a command that must be run with `sudo`.
Run it once after initial setup, then `pm2 save` to persist the current
process list. After that, PM2 auto-restarts saved processes on boot.

## GitHub Actions Runner (retired)

CI previously ran on a self-hosted GitHub Actions runner (`gridlock-ec2`) on
this EC2 instance, as the same `ubuntu` user as production. GitHub Actions
workflows were removed in v3.8. Pull-request checks now run on GitHub-hosted
runners (`.github/workflows/ci.yml`); deploys run via the gh-notify webhook.

> ⚠️ **This repository is public. Never register a self-hosted runner on the
> production host.** Anyone can open a pull request against a public repo, and
> a runner that shares the production user would give that code access to PM2,
> git credentials, SSH keys and all project directories.

If the old runner is still installed, remove it:

```bash
cd ~/actions-runner
sudo ./svc.sh stop && sudo ./svc.sh uninstall
./config.sh remove --token $(gh api repos/DhananjayThomble/GridLock/actions/runners/registration-token --method POST --jq '.token')
```

Then confirm no runners are listed under the repo's Settings → Actions →
Runners, and set "Fork pull request workflows from outside collaborators" to
require approval for all outside collaborators.

## CI/CD

Pull-request checks (backend tests, frontend lint and build) run on
GitHub-hosted runners via `.github/workflows/ci.yml`. Deploys run on the server
via the gh-notify webhook listener (PM2 process
`gh-notify`), which invokes the scripts in `scripts/` (`ci-test.sh`,
`ci-deploy.sh`, `deploy-backend.sh`). Deploy scripts hardcode paths
(`~/projects/GridLock` and `~/projects/GridLock-prod`) that assume the EC2
directory structure documented above. If the server layout changes, update the
scripts' directory variables.
