#!/usr/bin/env bash
# Auto-deploy develop branch to beta-api.gridlock.pro
# Called by GitHub webhook on develop push
set -euo pipefail

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

echo "[$(date -u)] Beta deploy starting..."

cd "$BETA_REPO"
git fetch origin develop
git checkout develop
git reset --hard origin/develop

# ── Backend ──
cd "$BETA_REPO/backend"
npm ci --omit=dev
MONGO_URI=mongodb://localhost:27017/gridlock_beta PORT=5001 \
  pm2 reload gridlock-beta-backend --update-env 2>/dev/null || \
  MONGO_URI=mongodb://localhost:27017/gridlock_beta PORT=5001 \
  pm2 start "$BETA_REPO/backend/server.js" --name gridlock-beta-backend

sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5001/health)
if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Beta backend health check failed (HTTP $HTTP_CODE)"
  exit 1
fi

# ── Frontend ──
cd "$BETA_REPO/frontend"
npm ci

# Validate vite is available before attempting build
if [ ! -x "$BETA_REPO/frontend/node_modules/.bin/vite" ]; then
  echo "❌ vite binary not found after npm ci — frontend deps likely failed"
  exit 1
fi

VITE_BASE_PATH=/ \
VITE_SOCKET_URL=https://beta-api.gridlock.pro \
VITE_API_BASE_URL=https://beta-api.gridlock.pro \
VITE_SITE_URL=https://beta.gridlock.pro \
npm run build --silent

sudo rm -rf "$BETA_WEB"/*
sudo cp -r dist/. "$BETA_WEB/"
sudo chown -R www-data:www-data "$BETA_WEB/"

pm2 save --silent

echo "[$(date -u)] Beta deploy complete ✅"
