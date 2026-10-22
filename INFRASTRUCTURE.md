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

Production runs from a **dedicated clone** (`GridLock-prod/`) that never
switches branches, so branch switches or in-progress work elsewhere can never
affect what's live. Beta runs from its own clone (`GridLock-beta/`) on `develop`.

## PM2 Processes

| Name                   | Directory            | Port | Branch    |
|------------------------|----------------------|------|-----------|
| `gridlock-backend`     | `GridLock-prod/backend/` | 5000 | `main`    |
| `gridlock-beta-backend`| `GridLock-beta/backend/` | 5001 | `develop` |

## Deploying

The production server is deliberately small, so **nothing is built on it**.

```
push to develop/main
  └─ GitHub Actions (.github/workflows/deploy.yml, GitHub-hosted runner)
       1. CI: backend tests + frontend lint/build      (ci.yml)
       2. Build frontend + SEO prerender               (scripts/build-frontend.sh)
       3. ssh deploy@server "backend <prod|beta>"     → git pull, npm ci --omit=dev,
                                                         pm2 reload, health check, auto-rollback
       4. tar dist | ssh deploy@server "frontend <prod|beta>"
                                                       → rsync into the Nginx web root
```

| Branch    | Target     | Backend (PM2)           | Frontend web root        |
|-----------|------------|-------------------------|--------------------------|
| `main`    | production | `gridlock-backend` :5000 | `/var/www/gridlock`      |
| `develop` | beta       | `gridlock-beta-backend` :5001 | `/var/www/gridlock-beta` |

The SSH key GitHub uses is locked to `scripts/server-deploy.sh` (an SSH
*forced command*): it can trigger these two deploy actions and nothing else —
no shell, no port forwarding. Deploys only run on pushes to this repo's
branches, never on pull requests, so fork PRs can't reach the secrets.

### One-time setup

**On the server** (as `ubuntu`):

```bash
# 1. Install the forced-command script (re-run after it changes in the repo)
cd ~/projects/GridLock-prod && git pull
sudo install -m 755 scripts/server-deploy.sh /usr/local/bin/gridlock-deploy

# 2. Create a deploy key and lock it to that script
ssh-keygen -t ed25519 -N '' -C gridlock-deploy -f ~/gridlock-deploy
echo "command=\"/usr/local/bin/gridlock-deploy\",restrict $(cat ~/gridlock-deploy.pub)" >> ~/.ssh/authorized_keys

# 3. Print the values for GitHub, then delete the private key from the server
cat ~/gridlock-deploy          # → DEPLOY_SSH_KEY
ssh-keyscan -t ed25519 localhost | sed "s/^localhost/<your-server-hostname-or-ip>/"   # → DEPLOY_KNOWN_HOSTS
rm ~/gridlock-deploy ~/gridlock-deploy.pub
```

`ubuntu` needs passwordless sudo for `chown`, `rsync` and `rm` (already
required by the old deploy scripts).

**On GitHub** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | Private key from step 3 |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan` line from step 3 |

**Optional — error tracking & analytics.** Sentry and PostHog are wired in
but **off by default** (not currently used). To turn them on, add these as
Actions *variables* (per environment, so prod and beta can differ) and redeploy:

| Variable / secret | Enables |
|-------------------|---------|
| `VITE_SENTRY_DSN` (variable) | Frontend error tracking |
| `VITE_POSTHOG_KEY` + `VITE_POSTHOG_HOST` (variables) | Product analytics |
| `SENTRY_AUTH_TOKEN` (secret) + `SENTRY_URL` (variable) | Source map upload |

For backend error tracking, set `SENTRY_DSN` in the server's `backend/.env`.

Optional but recommended: Settings → Environments → `production` → restrict
deployment branches to `main` (and `beta` to `develop`), and move the secrets
there.

Until `DEPLOY_HOST` is set, the deploy job is skipped with a warning (CI
still runs).

**Then retire the old webhook deployer** so the server stops building:

```bash
pm2 delete gh-notify && pm2 save
```

and delete the webhook under GitHub → Settings → Webhooks.

### Manual deploys (fallback)

```bash
# Backend — pulls latest main, installs deps, reloads PM2, auto-rollback
./scripts/deploy-backend.sh              # also: --dry-run, --rollback

# Re-run the last GitHub deploy without a new commit
#   GitHub → Actions → Deploy → Run workflow

# Frontend / beta built on the server — heavy on a small server, avoid if possible
./scripts/deploy-frontend.sh             # also: --dry-run
./scripts/deploy-beta.sh
```

`deploy-backend.sh` steps: lock → rotate log → save rollback commit →
`git reset --hard origin/main` → `npm ci --omit=dev` → `pm2 reload` →
health check (5 × 2s) on `localhost:5000/health` → auto-rollback on failure.

### Keeping a low-memory server healthy

- **Add swap** so a spike doesn't OOM-kill MongoDB:
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **Cap MongoDB's cache** — by default WiredTiger takes ~50% of RAM. In
  `/etc/mongod.conf`: `storage.wiredTiger.engineConfig.cacheSizeGB: 0.25`,
  then `sudo systemctl restart mongod`.
- **Rotate PM2 logs**: `pm2 install pm2-logrotate`.
- **Consider dropping beta** from this box if memory is tight
  (`pm2 delete gridlock-beta-backend`); each Node process uses ~80–150 MB.
- **Don't run builds, tests or E2E here** (`ci-test.sh`, `ci-deploy.sh`,
  `merge-gate.sh`'s local CI) — GitHub Actions does that now.

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
the production host, as the same `ubuntu` user as production. GitHub Actions
workflows were removed in v2.2.0. Pull-request checks now run on GitHub-hosted
runners (`.github/workflows/ci.yml`, `deploy.yml`); see **Deploying**.

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

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `.github/workflows/ci.yml` | Pull requests to `develop`/`main` | Backend tests (with MongoDB), frontend lint + build |
| `.github/workflows/deploy.yml` | Push to `develop` (beta) or `main` (prod), or manual | Runs CI, builds the frontend, deploys over SSH (see **Deploying**) |

Both run on GitHub-hosted runners (free for public repos). Server paths are
hardcoded in `scripts/server-deploy.sh`, `deploy-backend.sh` and
`ecosystem.config.js`; if the server layout changes, update them and
re-install `server-deploy.sh`.
