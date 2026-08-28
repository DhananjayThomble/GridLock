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

The dev worktree (`GridLock/`) is used for branch switching, builds, and CI
checks. Production (backend + frontend) both run from a **dedicated clone**
(`GridLock-prod/`) that never switches branches, so dev-side branch switches
or in-progress builds can never affect what's live. Dev work happens in
`GridLock/` without risk.

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

### Frontend (EC2, served by Nginx)

The frontend is a static Vite/React build served directly by Nginx from
`/var/www/gridlock` on the same EC2 instance as the backend — same origin as
the API, no separate hosting provider involved.

```bash
# Build + deploy to /var/www/gridlock (rsync, with a smoke check at the end)
./scripts/deploy-frontend.sh

# Build only, skip the deploy step (validates the build works)
./scripts/deploy-frontend.sh --dry-run
```

**Custom environment (optional):**
```bash
VITE_API_BASE_URL=http://localhost:5000 \
VITE_SOCKET_URL=http://localhost:5000 \
  ./scripts/deploy-frontend.sh --dry-run
```

The deploy script:
1. Builds the frontend (with SEO prerendering) in the dev worktree (`frontend/`)
2. Uploads source maps to Sentry, if configured (skipped silently otherwise)
3. Copies the fresh `dist/` output to a temp dir, `chown`s it to `www-data`
4. `rsync --delete`s it into `/var/www/gridlock` (atomic-ish — old files are
   only removed as new ones land)
5. Runs a smoke check against `https://gridlock.pro/`

Nginx (`/etc/nginx/sites-available/gridlock.pro.conf`) serves the static
files directly, proxies `/api/`, `/socket.io/`, and `/health` to the backend
on `:5000`, and falls back unmatched routes to `index.html` for client-side
routing (`try_files $uri /index.html`) — no GitHub Pages, no separate SPA
404-redirect trick needed.

TLS is terminated with a Cloudflare Origin Certificate at
`/etc/nginx/ssl/cf-origin.{pem,key}` (Cloudflare's proxy sits in front,
mode should be **Full (strict)**).

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

## Self-Hosted GitHub Actions Runner

GitHub Actions free-tier minutes are exhausted, so CI runs on a self-hosted
runner installed on this EC2 instance.

### Runner Details

| Setting        | Value                                          |
|----------------|------------------------------------------------|
| **Name**       | `gridlock-ec2`                                 |
| **Labels**     | `self-hosted`, `Linux`, `X64`                  |
| **Install dir**| `~/actions-runner/`                            |
| **User**       | `ubuntu`                                       |
| **Nice level** | 10 (via systemd override)                      |

### Systemd Service

```
actions.runner.DhananjayThomble-GridLock.gridlock-ec2.service
```

```bash
# Check status
sudo systemctl status actions.runner.DhananjayThomble-GridLock.gridlock-ec2

# Restart
sudo systemctl restart actions.runner.DhananjayThomble-GridLock.gridlock-ec2

# View logs
journalctl -u actions.runner.DhananjayThomble-GridLock.gridlock-ec2 -f
```

### Resource Limits

A systemd override at
`/etc/systemd/system/actions.runner.DhananjayThomble-GridLock.gridlock-ec2.service.d/override.conf`
sets `Nice=10` so CI jobs don't starve production workloads.

### Security Considerations

> ⚠️ **The self-hosted runner shares the same `ubuntu` user as production.**
> It has full access to PM2, git credentials, SSH keys, and all project
> directories. **Treat repository access as production access.**

**Mandatory rules:**

1. **NEVER enable workflows on fork pull requests.** A malicious fork can
   execute arbitrary code on this machine via a crafted workflow, compromising
   production data and credentials.
2. **NEVER add untrusted collaborators** without reviewing runner security
   implications. Any collaborator with write access can modify workflows and
   run code on the production server.
3. **Keep the repo private.** Public repos allow anyone to open a PR — combined
   with fork PR workflows, this is a full compromise vector.
4. **Audit workflow changes carefully.** Any change to `.github/workflows/`
   runs directly on production infrastructure.

### Re-registering the Runner

If the runner needs to be re-registered (e.g., token expired, repo transferred):

```bash
cd ~/actions-runner
# Remove old registration
./config.sh remove --token $(gh api repos/DhananjayThomble/GridLock/actions/runners/registration-token --method POST --jq '.token')
# Re-register
./config.sh --url https://github.com/DhananjayThomble/GridLock \
  --token $(gh api repos/DhananjayThomble/GridLock/actions/runners/registration-token --method POST --jq '.token') \
  --name gridlock-ec2 --labels self-hosted,Linux,X64 --unattended
sudo systemctl restart actions.runner.DhananjayThomble-GridLock.gridlock-ec2
```

## CI/CD

All CI/CD workflows run on the self-hosted runner (`runs-on: [self-hosted, Linux, X64]`),
which lives on the same EC2 instance as production — no SSH step needed, the
job runs directly on the box.

| Workflow | File | Trigger | What it does |
|----------|------|---------|---------------|
| CI | `.github/workflows/ci.yml` | Push to any branch except `main`; PRs targeting `main` | `scripts/ci-test.sh` — backend tests + frontend lint/build, `--skip-e2e` on plain pushes, full E2E on PRs into `main` |
| Deploy | `.github/workflows/deploy.yml` | Push to `main` | `scripts/ci-deploy.sh prod` — reruns the full test suite, then `deploy-backend.sh` + `deploy-frontend.sh` + `smoke-test.sh` |

Both workflows just `actions/checkout` and call the existing `scripts/*.sh` —
`deploy-backend.sh` and `deploy-frontend.sh` use their own absolute paths
(`PROD_DIR`, `/var/www/gridlock`) regardless of where the workflow checked
out, so there's nothing path-specific to keep in sync inside the workflow
files themselves. If the server layout changes, only the scripts need updating.
