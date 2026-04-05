#!/usr/bin/env bash
# Auto-deploy develop branch to beta-api.gridlock.pro
# Called by GitHub webhook on develop push
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
cd "$BETA_REPO/frontend"
NODE_ENV=development npm ci --no-optional

# Validate vite + native rollup binary are available.
# git reset --hard can corrupt node_modules (missing native binaries like @rollup/rollup-linux-x64-gnu).
# If npm ci didn't restore them, nuke and reinstall from scratch.
if [ ! -x "$BETA_REPO/frontend/node_modules/.bin/vite" ] || ! node -e "require('@rollup/rollup-linux-x64-gnu')" 2>/dev/null; then
  echo "⚠️  Native deps missing after npm ci — doing clean reinstall..."
  rm -rf node_modules package-lock.json
  npm install
fi

# Final validation
if [ ! -x "$BETA_REPO/frontend/node_modules/.bin/vite" ]; then
  echo "❌ vite binary not found after reinstall — frontend deps broken"
  exit 1
fi

# Beta frontend env vars (exported so npm run build picks them up)
export VITE_POSTHOG_KEY="${VITE_POSTHOG_KEY:-phc_yXSobqyjQdjoiE4EZevmn8QmVKelgyjkGTsjDDNGFE9}"
export VITE_POSTHOG_HOST="${VITE_POSTHOG_HOST:-https://analytics.gridlock.pro}"
export VITE_SENTRY_DSN="${VITE_SENTRY_DSN:-https://0829c2210084373653926c86a662d93c@sentry.gridlock.pro/3}"
export VITE_BASE_PATH=/
export VITE_SOCKET_URL=https://beta-api.gridlock.pro
export VITE_API_BASE_URL=https://beta-api.gridlock.pro
export VITE_SITE_URL=https://beta.gridlock.pro
export PUPPETEER_SKIP_DOWNLOAD=true
export SENTRY_SOURCEMAPS=1
npm run build:seo --silent

# Upload source maps before deploying
cd "$BETA_REPO"
bash scripts/upload-sourcemaps.sh gridlock-beta sentry
cd "$BETA_REPO/frontend"

# Auto-bump service worker cache version with build timestamp
BUILD_TS=$(date +%s)
sed -i "s/const CACHE_NAME = 'gridlock-[^']*'/const CACHE_NAME = 'gridlock-${BUILD_TS}'/" dist/sw.js
echo "✅ SW cache version bumped to gridlock-${BUILD_TS}"

sudo rm -rf "$BETA_WEB"/*
sudo cp -r dist/. "$BETA_WEB/"
sudo chown -R www-data:www-data "$BETA_WEB/"

pm2 save --silent

echo "[$(date -u)] Beta deploy complete ✅"
