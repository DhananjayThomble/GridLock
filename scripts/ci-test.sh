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
  log "▶ E2E tests (local backend on :5105)"

  # Start a temporary backend on port 5105 using the test database
  MONGO_URI=mongodb://localhost:27017/gridlock-test PORT=5105 NODE_ENV=test \
    node "$REPO_DIR/backend/server.js" > /tmp/ci-e2e-backend.log 2>&1 &
  BACKEND_PID=$!

  # Cleanup trap: kill temp backend on exit (pass or fail)
  cleanup_backend() {
    if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      log "Cleaning up test backend (PID $BACKEND_PID)..."
      kill "$BACKEND_PID" 2>/dev/null || true
      wait "$BACKEND_PID" 2>/dev/null || true
    fi
  }
  trap cleanup_backend EXIT

  # Wait for backend to be ready (up to 30s)
  for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:5105/health > /dev/null 2>&1; then
      log "Test backend ready on :5105"
      break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      log "❌ Test backend exited prematurely"
      cat /tmp/ci-e2e-backend.log 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done

  # Verify backend actually started
  if ! curl -sf http://127.0.0.1:5105/health > /dev/null 2>&1; then
    log "❌ Test backend failed to start within 30s"
    cat /tmp/ci-e2e-backend.log 2>/dev/null || true
    exit 1
  fi

  cd "$REPO_DIR" && TEST_ENV=local CI=true npx playwright test --config=playwright.config.js 2>&1 || {
    log "❌ E2E tests failed"
    exit 1
  }
fi

log "✅ All CI checks passed"
