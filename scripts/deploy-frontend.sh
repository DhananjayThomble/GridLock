#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# deploy-frontend.sh — Build frontend and deploy to EC2 Nginx (/var/www/gridlock)
#
# Prerequisites:
#   - The deploy user must have passwordless sudo configured for:
#     chown, rsync, rm (used during deploy to /var/www/gridlock).
#     Example sudoers entry:
#       deploy ALL=(ALL) NOPASSWD: /usr/bin/chown, /usr/bin/rsync, /bin/rm
#
# Usage:
#   ./scripts/deploy-frontend.sh [--dry-run]
#
# Environment variables (optional — defaults to production):
#   VITE_SOCKET_URL    WebSocket URL   (default: https://api.gridlock.pro)
#   VITE_API_BASE_URL  API base URL    (default: https://api.gridlock.pro)
#   VITE_SITE_URL      Site URL        (default: https://gridlock.pro)
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROD_WEB="/var/www/gridlock"
DRY_RUN=false

# --- Parse flags ---------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# --- Logging -------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Starting production frontend deploy (dry_run=$DRY_RUN)"

# --- Set build environment vars -----------------------------------------------
export VITE_SOCKET_URL="${VITE_SOCKET_URL:-https://api.gridlock.pro}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.gridlock.pro}"
export VITE_SITE_URL="${VITE_SITE_URL:-https://gridlock.pro}"
export VITE_BASE_PATH="/"
if [ -n "${VITE_POSTHOG_KEY:-}" ]; then
  export VITE_POSTHOG_KEY
else
  unset VITE_POSTHOG_KEY || true
fi
export VITE_POSTHOG_HOST="${VITE_POSTHOG_HOST:-}"
if [ -n "${VITE_SENTRY_DSN:-}" ]; then
  export VITE_SENTRY_DSN
else
  unset VITE_SENTRY_DSN || true
fi

log "Build env: VITE_API_BASE_URL=$VITE_API_BASE_URL"
log "Build env: VITE_SOCKET_URL=$VITE_SOCKET_URL"
log "Build env: VITE_SITE_URL=$VITE_SITE_URL"

# --- Build frontend ------------------------------------------------------------
log "Installing frontend dependencies..."
cd "$REPO_DIR/frontend"
NODE_ENV=development npm ci --loglevel=warn

log "Building frontend (with SEO prerendering)..."
export SENTRY_SOURCEMAPS=1
PUPPETEER_SKIP_DOWNLOAD=true npm run build:seo

if [ ! -d "$REPO_DIR/frontend/dist" ]; then
  log "❌ Build failed — frontend/dist not found"
  exit 1
fi
log "✅ Build succeeded ($(du -sh "$REPO_DIR/frontend/dist" | cut -f1) total)"

# Auto-bump service worker cache version with build timestamp
BUILD_TS=$(date +%s)
sed -i "s/const CACHE_NAME = 'gridlock-[^']*'/const CACHE_NAME = 'gridlock-${BUILD_TS}'/" "$REPO_DIR/frontend/dist/sw.js"
log "✅ SW cache version bumped to gridlock-${BUILD_TS}"

# --- Upload source maps to Sentry ---------------------------------------------
log "Uploading source maps to Sentry..."
cd "$REPO_DIR"
bash scripts/upload-sourcemaps.sh gridlock-prod sentry
cd "$REPO_DIR/frontend"

# --- Deploy to /var/www/gridlock -----------------------------------------------
if [ "$DRY_RUN" = true ]; then
  log "🏁 DRY RUN — skipping deploy. Build output:"
  ls -la "$REPO_DIR/frontend/dist"
  exit 0
fi

log "Deploying to $PROD_WEB..."
TEMP_DEPLOY=$(mktemp -d)
cp -r "$REPO_DIR/frontend/dist/." "$TEMP_DEPLOY/"
sudo chown -R www-data:www-data "$TEMP_DEPLOY/"
sudo rsync -a --delete "$TEMP_DEPLOY/" "$PROD_WEB/"
sudo rm -rf "$TEMP_DEPLOY"

# --- Smoke check ---------------------------------------------------------------
log "Running smoke check..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' https://gridlock.pro/ --max-time 10)
if [ "$HTTP_CODE" != "200" ]; then
  log "❌ Smoke check failed — got HTTP $HTTP_CODE"
  exit 1
fi
log "✅ Smoke check passed (HTTP $HTTP_CODE)"

log "✅ Production frontend deployed to $PROD_WEB"
log "Site: https://gridlock.pro"
log "Done."
