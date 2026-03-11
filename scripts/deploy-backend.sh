#!/usr/bin/env bash
set -euo pipefail

# Deploy backend to production
# Usage: ./scripts/deploy-backend.sh [--rollback] [--dry-run]
#
# This script deploys from the DEDICATED production directory.
# It NEVER switches branches — always stays on main.

PROD_DIR="/home/ubuntu/projects/GridLock-prod"
PM2_APP="gridlock-backend"
DEPLOY_LOG="${PROD_DIR}/deploy.log"
ROLLBACK_FILE="${PROD_DIR}/.last-good-commit"
HEALTH_URL="http://localhost:5000/health"
HEALTH_TIMEOUT=5

# ── Helpers ──────────────────────────────────────────────────────
log() {
    local msg="[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"
    echo "$msg"
    echo "$msg" >> "$DEPLOY_LOG"
}

die() { log "❌ FATAL: $*"; exit 1; }

health_check() {
    local url="${1:-$HEALTH_URL}"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HEALTH_TIMEOUT" "$url" 2>/dev/null || echo "000")
    echo "$code"
}

# ── Rollback ─────────────────────────────────────────────────────
do_rollback() {
    if [[ ! -f "$ROLLBACK_FILE" ]]; then
        die "No rollback commit found at $ROLLBACK_FILE"
    fi

    local prev_commit
    prev_commit=$(cat "$ROLLBACK_FILE")
    log "🔄 Rolling back to commit $prev_commit ..."

    cd "$PROD_DIR"
    git reset --hard "$prev_commit"
    cd backend && npm ci --production --silent 2>&1 | tail -3
    pm2 reload "$PM2_APP" --update-env

    sleep 3
    local code
    code=$(health_check)
    if [[ "$code" == "200" ]]; then
        log "✅ Rollback successful — health check passed (HTTP $code)"
    else
        log "❌ Rollback health check failed (HTTP $code) — MANUAL INTERVENTION REQUIRED"
        exit 1
    fi
}

# ── Dry Run ──────────────────────────────────────────────────────
do_dry_run() {
    log "🧪 DRY RUN — no changes will be made"
    cd "$PROD_DIR"

    local current_commit new_commit
    current_commit=$(git rev-parse HEAD)
    git fetch origin main --quiet
    new_commit=$(git rev-parse origin/main)

    if [[ "$current_commit" == "$new_commit" ]]; then
        log "Already up to date at $current_commit"
    else
        local changes
        changes=$(git log --oneline "${current_commit}..origin/main" | wc -l)
        log "Would deploy $changes new commit(s): $current_commit → $new_commit"
        git log --oneline "${current_commit}..origin/main" | head -10
    fi

    log "Current branch: $(git branch --show-current)"
    log "PM2 app: $PM2_APP"
    log "Health endpoint: $HEALTH_URL"
    log "🧪 DRY RUN complete"
}

# ── Deploy ───────────────────────────────────────────────────────
do_deploy() {
    log "🚀 Starting backend deployment..."

    cd "$PROD_DIR"

    # Safety: ensure we're on main
    local current_branch
    current_branch=$(git branch --show-current)
    if [[ "$current_branch" != "main" ]]; then
        die "Production directory is on branch '$current_branch', expected 'main'. Aborting."
    fi

    # Save current commit for rollback
    local prev_commit
    prev_commit=$(git rev-parse HEAD)
    echo "$prev_commit" > "$ROLLBACK_FILE"
    log "Saved rollback point: $prev_commit"

    # Pull latest
    git fetch origin main --quiet
    local new_commit
    new_commit=$(git rev-parse origin/main)

    if [[ "$prev_commit" == "$new_commit" ]]; then
        log "Already up to date at $prev_commit — reloading anyway"
    else
        log "Deploying: $prev_commit → $new_commit"
    fi

    git reset --hard origin/main
    log "Checked out: $(git rev-parse --short HEAD)"

    # Install dependencies
    cd backend
    log "Installing production dependencies..."
    npm ci --production --silent 2>&1 | tail -5

    # Reload PM2
    log "Reloading PM2 app: $PM2_APP"
    pm2 reload "$PM2_APP" --update-env

    # Health check
    sleep 3
    local code
    code=$(health_check)
    if [[ "$code" == "200" ]]; then
        log "✅ Deployment successful — health check passed (HTTP $code)"
        log "Deployed commit: $(git rev-parse --short HEAD)"
    else
        log "❌ Health check failed (HTTP $code) — initiating rollback"
        do_rollback
        exit 1
    fi
}

# ── Main ─────────────────────────────────────────────────────────
case "${1:-}" in
    --rollback)
        do_rollback
        ;;
    --dry-run)
        do_dry_run
        ;;
    *)
        do_deploy
        ;;
esac
