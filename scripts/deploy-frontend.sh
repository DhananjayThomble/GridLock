#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# deploy-frontend.sh — Build frontend and deploy to Nginx (/var/www/gridlock)
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
# Build settings live in scripts/build-frontend.sh.
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

# --- Build (shared with GitHub Actions) ---------------------------------------
# Note: on the production server prefer the GitHub Actions deploy
# (.github/workflows/deploy.yml). This manual path builds locally.
bash "$SCRIPT_DIR/build-frontend.sh" prod
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
