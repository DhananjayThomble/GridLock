#!/usr/bin/env bash
# Manually deploy develop branch to beta (backend + frontend, built on this box).
# Normal path: .github/workflows/deploy.yml on push to develop.
set -euo pipefail
trap 'echo "❌ Deploy failed at line $LINENO (exit $?)"' ERR

LOCKFILE="/tmp/beta-deploy.lock"

# ── Concurrency Lock ────────────────────────────────────────────
# Prevent concurrent deploys (e.g. rapid webhook fires).
# flock -n = non-blocking: if another deploy holds the lock, exit immediately.
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "[$(date -u)] ⚠️  Another beta deploy is already running — skipping."
    exit 0
fi

BETA_REPO="/home/ubuntu/projects/GridLock-beta"
BETA_WEB="/var/www/gridlock-beta"

# Merge stderr into stdout so Node.js execFile captures everything
exec 2>&1

# Disable husky hooks in non-TTY environments (PM2/execFile)
export HUSKY=0

echo "[$(date -u)] Beta deploy starting..."

cd "$BETA_REPO"
git fetch origin develop
git checkout develop
git reset --hard origin/develop

# ── Backend ──
cd "$BETA_REPO/backend"
npm ci --omit=dev
# Env vars are loaded from backend/.env via dotenv in server.js
pm2 reload gridlock-beta-backend --update-env 2>/dev/null || \
  pm2 start "$BETA_REPO/backend/server.js" --name gridlock-beta-backend

sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5001/health)
if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Beta backend health check failed (HTTP $HTTP_CODE)"
  exit 1
fi

# ── Frontend ──
# Build settings live in scripts/build-frontend.sh (shared with GitHub Actions).
# On the production server prefer the GitHub Actions deploy, which builds off-box.
bash "$BETA_REPO/scripts/build-frontend.sh" beta
cd "$BETA_REPO/frontend"

sudo rm -rf "$BETA_WEB"/*
sudo cp -r dist/. "$BETA_WEB/"
sudo chown -R www-data:www-data "$BETA_WEB/"

pm2 save --silent

echo "[$(date -u)] Beta deploy complete ✅"
