#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# build-frontend.sh — Build the frontend for prod or beta into frontend/dist
#
# Runs anywhere (GitHub Actions or a dev machine). Deliberately NOT run on the
# 1GB production server: npm ci + Vite + headless Chromium prerendering needs
# more memory than the box can spare. See INFRASTRUCTURE.md → Deploying.
#
# Usage:
#   bash scripts/build-frontend.sh [prod|beta]
#
# Optional env:
#   SENTRY_AUTH_TOKEN, SENTRY_URL  — upload source maps (skipped if unset)
#   PUPPETEER_EXECUTABLE_PATH      — Chromium for SEO prerendering
###############################################################################

TARGET="${1:-prod}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

case "$TARGET" in
  prod)
    export VITE_SOCKET_URL="${VITE_SOCKET_URL:-https://api.gridlock.pro}"
    export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.gridlock.pro}"
    export VITE_SITE_URL="${VITE_SITE_URL:-https://gridlock.pro}"
    SENTRY_PROJECT="gridlock-prod"
    # PostHog / Sentry DSN come from frontend/.env.production
    ;;
  beta)
    export VITE_SOCKET_URL="${VITE_SOCKET_URL:-https://beta-api.gridlock.pro}"
    export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://beta-api.gridlock.pro}"
    export VITE_SITE_URL="${VITE_SITE_URL:-https://beta.gridlock.pro}"
    export VITE_POSTHOG_KEY="${VITE_POSTHOG_KEY:-phc_yXSobqyjQdjoiE4EZevmn8QmVKelgyjkGTsjDDNGFE9}"
    export VITE_POSTHOG_HOST="${VITE_POSTHOG_HOST:-https://analytics.gridlock.pro}"
    export VITE_SENTRY_DSN="${VITE_SENTRY_DSN:-https://0829c2210084373653926c86a662d93c@sentry.gridlock.pro/3}"
    SENTRY_PROJECT="gridlock-beta"
    ;;
  *)
    echo "Usage: $0 [prod|beta]"; exit 1 ;;
esac
export VITE_BASE_PATH="/"

log "Building frontend for $TARGET (API: $VITE_API_BASE_URL)"

cd "$REPO_DIR/frontend"
NODE_ENV=development npm ci --loglevel=warn

export SENTRY_SOURCEMAPS=1
npm run build:seo

if [ ! -f "$REPO_DIR/frontend/dist/index.html" ]; then
  log "❌ Build failed — frontend/dist/index.html not found"
  exit 1
fi

# Auto-bump service worker cache version with build timestamp
BUILD_TS=$(date +%s)
sed -i "s/const CACHE_NAME = 'gridlock-[^']*'/const CACHE_NAME = 'gridlock-${BUILD_TS}'/" dist/sw.js
if grep -q "gridlock-${BUILD_TS}" dist/sw.js; then
  log "✅ SW cache version bumped to gridlock-${BUILD_TS}"
else
  log "⚠️ SW cache bump failed — check sw.js format"
fi

cd "$REPO_DIR"
bash scripts/upload-sourcemaps.sh "$SENTRY_PROJECT" sentry

log "✅ Frontend built for $TARGET ($(du -sh frontend/dist | cut -f1))"
