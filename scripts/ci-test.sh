#!/bin/bash
set -euo pipefail
# Local CI test runner
# Runs: backend tests + frontend lint + frontend build + E2E tests
# Exit code 0 = all pass, non-zero = failure
# Usage: scripts/ci-test.sh [--skip-e2e]

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_E2E=false
for arg in "$@"; do
  case "$arg" in
    --skip-e2e) SKIP_E2E=true ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "▶ Backend unit tests"
cd "$REPO_DIR/backend" && npm test -- --runInBand --forceExit

log "▶ Frontend lint"
cd "$REPO_DIR/frontend" && npm run lint --if-present

log "▶ Frontend build"
cd "$REPO_DIR/frontend" && npm run build

if [ "$SKIP_E2E" = false ]; then
  log "▶ E2E tests (against beta)"
  cd "$REPO_DIR" && TEST_ENV=beta npx playwright test --config=playwright.config.js 2>&1 || {
    log "❌ E2E tests failed"
    exit 1
  }
fi

log "✅ All CI checks passed"
