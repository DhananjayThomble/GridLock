#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# deploy-frontend.sh — Build frontend and deploy to GitHub Pages via worktree
#
# Usage:
#   ./scripts/deploy-frontend.sh [--dry-run]
#
# Environment variables (optional — defaults to production):
#   VITE_SOCKET_URL    WebSocket URL   (default: https://api.gridlock.pro)
#   VITE_API_BASE_URL  API base URL    (default: https://api.gridlock.pro)
#   VITE_SITE_URL      Site URL        (default: https://gridlock.pro)
#
# Safety: Uses git worktree to avoid checking out gh-pages in the main worktree.
#         The main worktree stays on its current branch at all times.
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_DIR="/tmp/gh-pages-deploy"
CNAME_DOMAIN="gridlock.pro"
GH_PAGES_BRANCH="gh-pages"
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

# --- Cleanup trap --------------------------------------------------------------
cleanup() {
  local exit_code=$?
  log "Cleaning up..."
  # Remove worktree if it exists
  if [ -d "$WORKTREE_DIR" ]; then
    git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || rm -rf "$WORKTREE_DIR"
  fi
  # Prune stale worktree references
  git -C "$REPO_DIR" worktree prune 2>/dev/null || true
  if [ $exit_code -ne 0 ]; then
    log "❌ Deploy failed (exit $exit_code)"
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM HUP

# --- Preflight checks ----------------------------------------------------------
log "Starting frontend deploy (dry_run=$DRY_RUN)"

cd "$REPO_DIR"

# Ensure we're NOT on gh-pages in the main worktree (safety check)
current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo 'detached')"
if [ "$current_branch" = "$GH_PAGES_BRANCH" ]; then
  log "❌ FATAL: Main worktree is on $GH_PAGES_BRANCH — aborting to protect backend files."
  exit 1
fi
log "Main worktree on branch: $current_branch (safe)"

# Store current commit for deploy message
DEPLOY_COMMIT="$(git rev-parse --short HEAD)"
DEPLOY_TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# --- Set build environment vars -----------------------------------------------
export VITE_SOCKET_URL="${VITE_SOCKET_URL:-https://api.gridlock.pro}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.gridlock.pro}"
export VITE_SITE_URL="${VITE_SITE_URL:-https://gridlock.pro}"
export VITE_BASE_PATH="/"

log "Build env: VITE_API_BASE_URL=$VITE_API_BASE_URL"
log "Build env: VITE_SOCKET_URL=$VITE_SOCKET_URL"
log "Build env: VITE_SITE_URL=$VITE_SITE_URL"

# --- Build frontend ------------------------------------------------------------
log "Installing frontend dependencies..."
cd "$REPO_DIR/frontend"
npm ci --loglevel=warn

log "Building frontend..."
npm run build

if [ ! -d "$REPO_DIR/frontend/dist" ]; then
  log "❌ Build failed — frontend/dist not found"
  exit 1
fi
log "✅ Build succeeded ($(du -sh "$REPO_DIR/frontend/dist" | cut -f1) total)"

cd "$REPO_DIR"

# --- Prepare git worktree for gh-pages ----------------------------------------
# Clean up any existing worktree at the target path
if [ -d "$WORKTREE_DIR" ]; then
  log "Removing existing worktree at $WORKTREE_DIR..."
  git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || rm -rf "$WORKTREE_DIR"
  git worktree prune 2>/dev/null || true
fi

log "Creating worktree for $GH_PAGES_BRANCH at $WORKTREE_DIR..."
git fetch origin "$GH_PAGES_BRANCH" 2>/dev/null || true
git worktree add "$WORKTREE_DIR" "$GH_PAGES_BRANCH"

# --- Deploy to worktree -------------------------------------------------------
log "Cleaning old files in worktree..."
# Remove everything except .git (worktree link)
find "$WORKTREE_DIR" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

log "Copying build output..."
cp -r "$REPO_DIR/frontend/dist/." "$WORKTREE_DIR/"

# Add CNAME for custom domain
echo "$CNAME_DOMAIN" > "$WORKTREE_DIR/CNAME"
log "Added CNAME: $CNAME_DOMAIN"

# Add 404.html for SPA routing (GitHub Pages serves this for unknown paths)
if [ -f "$WORKTREE_DIR/index.html" ]; then
  cp "$WORKTREE_DIR/index.html" "$WORKTREE_DIR/404.html"
  log "Added 404.html (copy of index.html for SPA routing)"
else
  log "⚠️  No index.html found — skipping 404.html"
fi

# --- Commit and push -----------------------------------------------------------
cd "$WORKTREE_DIR"
git add -A

if git diff --cached --quiet; then
  log "No changes to deploy — gh-pages is already up to date."
else
  COMMIT_MSG="deploy: ${DEPLOY_COMMIT} @ ${DEPLOY_TIMESTAMP}"
  git commit -m "$COMMIT_MSG"
  log "Committed: $COMMIT_MSG"

  if [ "$DRY_RUN" = true ]; then
    log "🏁 DRY RUN — skipping push. Worktree contents:"
    ls -la "$WORKTREE_DIR"
  else
    log "Pushing to origin/$GH_PAGES_BRANCH..."
    git push origin "$GH_PAGES_BRANCH"
    log "✅ Deployed successfully! Site: https://$CNAME_DOMAIN"
  fi
fi

cd "$REPO_DIR"
log "Done."
