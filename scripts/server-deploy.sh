#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# server-deploy.sh — SSH forced command that receives deploys from GitHub Actions
#
# The deploy key in ~/.ssh/authorized_keys can run ONLY this script, so a leaked
# key can redeploy GridLock but cannot open a shell. Nothing is built here: the
# backend only runs `npm ci --omit=dev`, and the frontend arrives pre-built as a
# tarball on stdin. That keeps deploys light enough for a low-memory server.
#
# Install (once, as ubuntu — see INFRASTRUCTURE.md → Deploying):
#   sudo install -m 755 scripts/server-deploy.sh /usr/local/bin/gridlock-deploy
#   # ~/.ssh/authorized_keys:
#   command="/usr/local/bin/gridlock-deploy",restrict ssh-ed25519 AAAA... gridlock-deploy
#
# Commands (sent by .github/workflows/deploy.yml):
#   backend  prod|beta     pull + install prod deps + pm2 reload + health check
#   frontend prod|beta     read dist tarball from stdin, publish to Nginx root
###############################################################################

PROJECTS="/home/ubuntu/projects"
PROD_DIR="$PROJECTS/GridLock-prod"
BETA_DIR="$PROJECTS/GridLock-beta"
MAX_TARBALL_BYTES=$((200 * 1024 * 1024))

export HUSKY=0
log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"; }
die() { log "❌ $*"; exit 1; }

read -r ACTION TARGET EXTRA <<< "${SSH_ORIGINAL_COMMAND:-}"
[ -z "${EXTRA:-}" ] || die "Unexpected arguments"

case "$TARGET" in
  prod) WEB_ROOT="/var/www/gridlock";      SITE_URL="https://gridlock.pro/" ;;
  beta) WEB_ROOT="/var/www/gridlock-beta"; SITE_URL="https://beta.gridlock.pro/" ;;
  *) die "Usage: backend|frontend prod|beta" ;;
esac

deploy_backend_beta() {
  exec 200>/tmp/beta-deploy.lock
  flock -n 200 || die "Another beta deploy is running"

  cd "$BETA_DIR"
  git fetch origin develop --quiet
  git checkout develop --quiet
  git reset --hard origin/develop --quiet
  log "Checked out develop @ $(git rev-parse --short HEAD)"

  cd backend
  npm ci --omit=dev --loglevel=warn
  pm2 reload gridlock-beta-backend --update-env 2>/dev/null || \
    pm2 start "$BETA_DIR/backend/server.js" --name gridlock-beta-backend
  pm2 save --silent

  local code=000
  for _ in 1 2 3 4 5; do
    sleep 2
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:5001/health || echo 000)
    [ "$code" = "200" ] && break
  done
  [ "$code" = "200" ] || die "Beta backend health check failed (HTTP $code)"
  log "✅ Beta backend deployed"
}

deploy_frontend() {
  # Global (not local) so the EXIT trap can still see it
  UPLOAD_DIR=$(mktemp -d)
  trap 'sudo rm -rf "$UPLOAD_DIR"' EXIT
  local tmp="$UPLOAD_DIR"

  # Tarball comes from the workflow on stdin; cap its size
  head -c "$MAX_TARBALL_BYTES" | tar -xzf - -C "$tmp" --no-same-owner --no-same-permissions
  [ -f "$tmp/index.html" ] || die "Upload has no index.html — refusing to publish"

  sudo chown -R www-data:www-data "$tmp"
  sudo rsync -a --delete "$tmp/" "$WEB_ROOT/"
  log "Published $(du -sh "$WEB_ROOT" | cut -f1) to $WEB_ROOT"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE_URL" || echo 000)
  [ "$code" = "200" ] || die "Smoke check failed for $SITE_URL (HTTP $code)"
  log "✅ Frontend live at $SITE_URL"
}

case "$ACTION:$TARGET" in
  backend:prod) exec bash "$PROD_DIR/scripts/deploy-backend.sh" ;;
  backend:beta) deploy_backend_beta ;;
  frontend:*)   deploy_frontend ;;
  *) die "Unknown command: $ACTION" ;;
esac
