#!/bin/bash
set -euo pipefail
# Full CI + deploy pipeline
# Usage: scripts/ci-deploy.sh [beta|prod]
# Runs: ci-test.sh (with E2E) → deploy

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-beta}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "🧪 Running CI tests (including E2E)..."
bash "$REPO_DIR/scripts/ci-test.sh"

if [ "$TARGET" = "prod" ]; then
  log "🚀 Deploying to production..."
  bash "$REPO_DIR/scripts/deploy-backend.sh"
  bash "$REPO_DIR/scripts/deploy-frontend.sh"
  bash "$REPO_DIR/scripts/smoke-test.sh" https://api.gridlock.pro
elif [ "$TARGET" = "beta" ]; then
  log "🧪 Deploying to beta..."
  bash "$REPO_DIR/scripts/deploy-beta.sh"
fi

log "✅ CI + Deploy complete ($TARGET)"
