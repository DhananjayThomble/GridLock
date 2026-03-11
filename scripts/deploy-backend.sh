#!/usr/bin/env bash
set -euo pipefail

# Deploy backend to production
# Usage: ./scripts/deploy-backend.sh [--rollback] [--dry-run]
#
# This script deploys from the DEDICATED production directory.
# It NEVER switches branches — always stays on main.
#
# Log rotation: deploy.log is trimmed to the last 1000 lines on each
# non-dry-run invocation. For external rotation (logrotate, etc.),
# target $PROD_DIR/deploy.log — the script appends only.

PROD_DIR="/home/ubuntu/projects/GridLock-prod"
PM2_APP="gridlock-backend"
DEPLOY_LOG="${PROD_DIR}/deploy.log"
ROLLBACK_FILE="${PROD_DIR}/.last-good-commit"
HEALTH_URL="http://localhost:5000/health"
HEALTH_TIMEOUT=5
LOCKFILE="/tmp/gridlock-deploy.lock"
DRY_RUN=false

# ── Helpers ──────────────────────────────────────────────────────
log() {
    local msg="[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"
    echo "$msg"
    if [[ "$DRY_RUN" == false ]]; then
        echo "$msg" >> "$DEPLOY_LOG"
    fi
}

die() { log "❌ FATAL: $*"; exit 1; }

health_check() {
    local url="${1:-$HEALTH_URL}"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HEALTH_TIMEOUT" "$url" 2>/dev/null || echo "000")
    echo "$code"
}

# Retry health check: 5 attempts, 2 seconds apart
health_check_retry() {
    local url="${1:-$HEALTH_URL}"
    local max_attempts=5
    local delay=2
    local attempt code
    for (( attempt=1; attempt<=max_attempts; attempt++ )); do
        sleep "$delay"
        code=$(health_check "$url")
        if [[ "$code" == "200" ]]; then
            echo "$code"
            return 0
        fi
        log "Health check attempt $attempt/$max_attempts: HTTP $code"
    done
    echo "$code"
    return 1
}

# ── Log Rotation ─────────────────────────────────────────────────
rotate_log() {
    if [[ -f "$DEPLOY_LOG" ]]; then
        local lines
        lines=$(wc -l < "$DEPLOY_LOG")
        if (( lines > 1000 )); then
            local tmp="${DEPLOY_LOG}.tmp"
            tail -1000 "$DEPLOY_LOG" > "$tmp" && mv "$tmp" "$DEPLOY_LOG"
        fi
    fi
}

# ── Concurrency Lock ────────────────────────────────────────────
acquire_lock() {
    if [[ -f "$LOCKFILE" ]]; then
        local lock_pid
        lock_pid=$(cat "$LOCKFILE" 2>/dev/null || echo "")
        if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
            die "Another deploy is running (PID $lock_pid). If stale, remove $LOCKFILE"
        else
            log "⚠️  Removing stale lock (PID $lock_pid no longer running)"
            rm -f "$LOCKFILE"
        fi
    fi
    echo $$ > "$LOCKFILE"
}

release_lock() {
    rm -f "$LOCKFILE"
}

# ── Trap Handler ─────────────────────────────────────────────────
# On interruption mid-deploy, roll back to the saved commit so production
# is never left in a half-deployed state.
DEPLOY_IN_PROGRESS=false

cleanup_on_interrupt() {
    local exit_code=$?
    set +e  # don't let failing rollback commands abort the handler

    if [[ "$DEPLOY_IN_PROGRESS" == true ]]; then
        echo ""
        log "⚠️  Deploy interrupted — initiating rollback"
        DEPLOY_IN_PROGRESS=false  # prevent re-entrant trap
        do_rollback_internal
        log "🔄 Rollback after interruption complete"
    fi

    # Release lock AFTER rollback so no concurrent deploy races against it
    release_lock

    exit "${exit_code}"
}

trap cleanup_on_interrupt INT TERM HUP EXIT

# ── Rollback (internal, no lock — called from trap or do_rollback) ──
do_rollback_internal() {
    if [[ ! -f "$ROLLBACK_FILE" ]]; then
        die "No rollback commit found at $ROLLBACK_FILE"
    fi

    local prev_commit
    prev_commit=$(cat "$ROLLBACK_FILE")
    log "🔄 Rolling back to commit $prev_commit ..."

    cd "$PROD_DIR"
    git reset --hard "$prev_commit"
    cd backend && npm ci --omit=dev --silent 2>&1 | tail -3
    pm2 reload "$PM2_APP" --update-env

    local code
    code=$(health_check_retry) || true
    if [[ "$code" == "200" ]]; then
        log "✅ Rollback successful — health check passed (HTTP $code)"
    else
        log "❌ Rollback health check failed (HTTP $code) — MANUAL INTERVENTION REQUIRED"
        exit 1
    fi
}

# ── Rollback (user-invoked, acquires lock) ───────────────────────
do_rollback() {
    acquire_lock
    do_rollback_internal
    release_lock
}

# ── Dry Run ──────────────────────────────────────────────────────
do_dry_run() {
    DRY_RUN=true
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
    acquire_lock
    rotate_log
    log "🚀 Starting backend deployment..."

    cd "$PROD_DIR"

    # Safety: ensure we're on main
    local current_branch
    current_branch=$(git branch --show-current)
    if [[ "$current_branch" != "main" ]]; then
        release_lock
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

    DEPLOY_IN_PROGRESS=true
    git reset --hard origin/main
    log "Checked out: $(git rev-parse --short HEAD)"

    # Install dependencies
    cd backend
    log "Installing production dependencies..."
    npm ci --omit=dev --silent 2>&1 | tail -5

    # Reload PM2
    log "Reloading PM2 app: $PM2_APP"
    pm2 reload "$PM2_APP" --update-env

    # Health check with retry (5 attempts, 2s apart)
    local code
    code=$(health_check_retry) || true
    if [[ "$code" == "200" ]]; then
        DEPLOY_IN_PROGRESS=false
        log "✅ Deployment successful — health check passed (HTTP $code)"
        log "Deployed commit: $(git rev-parse --short HEAD)"
    else
        log "❌ Health check failed (HTTP $code) — initiating rollback"
        DEPLOY_IN_PROGRESS=false
        do_rollback_internal
        release_lock
        exit 1
    fi

    release_lock
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
