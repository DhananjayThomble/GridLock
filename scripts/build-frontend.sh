#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# build-frontend.sh — Build the frontend for prod or beta into frontend/dist
#
# Runs anywhere (GitHub Actions or a dev machine). Deliberately NOT run on the
# production server: npm ci + Vite + headless Chromium prerendering needs
# more memory than the box can spare. See INFRASTRUCTURE.md → Deploying.
#
# Usage:
#   bash scripts/build-frontend.sh [prod|beta]
#
# Optional env (all off when unset — the app runs fine without them):
#   VITE_SENTRY_DSN                — override the production DSN, or enable Sentry in beta
#   VITE_POSTHOG_KEY, VITE_POSTHOG_HOST — product analytics (PostHog)
#   SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_URL — source-map upload
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
    default_dsn=$(node -p 'require(process.argv[1]).productionDsn' "$REPO_DIR/config/sentry.json")
    export VITE_SENTRY_DSN="${VITE_SENTRY_DSN-$default_dsn}"
    export VITE_SENTRY_ENVIRONMENT=production
    ;;
  beta)
    export VITE_SOCKET_URL="${VITE_SOCKET_URL:-https://beta-api.gridlock.pro}"
    export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://beta-api.gridlock.pro}"
    export VITE_SITE_URL="${VITE_SITE_URL:-https://beta.gridlock.pro}"
    export VITE_SENTRY_ENVIRONMENT=beta
    ;;
  *)
    echo "Usage: $0 [prod|beta]"; exit 1 ;;
esac
export VITE_BASE_PATH="/"
export VITE_SENTRY_RELEASE="gridlock@${GITHUB_SHA:-$(git -C "$REPO_DIR" rev-parse HEAD)}"

log "Building frontend for $TARGET (API: $VITE_API_BASE_URL)"

cd "$REPO_DIR/frontend"
NODE_ENV=development npm ci --loglevel=warn

# Hidden source maps are only useful if we can upload them to Sentry
unset SENTRY_SOURCEMAPS
if [ -n "${VITE_SENTRY_DSN:-}" ] && [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  : "${SENTRY_ORG:?Set the Sentry organization slug}"
  : "${SENTRY_PROJECT:?Set the Sentry project slug}"
  export SENTRY_SOURCEMAPS=1
elif [ -n "${VITE_SENTRY_DSN:-}" ]; then
  log "Sentry source maps disabled: SENTRY_AUTH_TOKEN is missing"
fi
onoff() { [ -n "$1" ] && echo on || echo off; }
log "Sentry: $(onoff "${VITE_SENTRY_DSN:-}") | PostHog: $(onoff "${VITE_POSTHOG_KEY:-}")"
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
if [ "${SENTRY_SOURCEMAPS:-}" = 1 ]; then
  bash scripts/upload-sourcemaps.sh "$SENTRY_PROJECT" "$SENTRY_ORG"
fi

log "✅ Frontend built for $TARGET ($(du -sh frontend/dist | cut -f1))"
