#!/usr/bin/env bash
# scripts/test-e2e-local.sh
#
# Run Playwright E2E tests locally WITHOUT touching the PM2/production server.
#
# PROBLEM: PM2 already owns port 5000. If the test backend tries to bind there,
# it crashes silently — and the frontend ends up talking to stale PM2 game state.
# Spectator/multiplayer tests then fail because games already have wrong players.
#
# SOLUTION: Use isolated ports (5105 backend, 4175 frontend preview) that never
# conflict with PM2. Uses a dedicated local MongoDB test database name.
#
# Usage:
#   ./scripts/test-e2e-local.sh                   # run all tests
#   ./scripts/test-e2e-local.sh e2e/08-spectator-mode.spec.js
#   ./scripts/test-e2e-local.sh --grep "spectator"

set -euo pipefail

BACKEND_PORT=5105
FRONTEND_PORT=4175
MONGO_URI="mongodb://127.0.0.1:27017/gridlock_e2e_local"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "▶  Starting isolated test backend on port $BACKEND_PORT..."
PORT=$BACKEND_PORT NODE_ENV=test MONGO_URI="$MONGO_URI" node backend/server.js \
  > /tmp/gridlock_e2e_backend.log 2>&1 &
BACKEND_PID=$!

# Kill both servers on exit, regardless of success/failure
cleanup() {
  echo "▶  Cleaning up background processes..."
  kill "$BACKEND_PID" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for backend to be ready (up to 30s)
echo "▶  Waiting for backend health..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$BACKEND_PORT/health" > /dev/null; then
    echo "   ✓ Backend ready"
    break
  fi
  [ "$i" -eq 30 ] && { echo "✘ Backend failed to start. Check /tmp/gridlock_e2e_backend.log"; exit 1; }
  sleep 1
done

echo "▶  Building frontend (socket → localhost:$BACKEND_PORT)..."
(
  cd frontend
  VITE_SOCKET_URL="http://127.0.0.1:$BACKEND_PORT" npm run build --silent
)
echo "   ✓ Frontend built"

echo "▶  Starting Vite preview on port $FRONTEND_PORT..."
npx --prefix frontend vite preview --port "$FRONTEND_PORT" --base=/ \
  > /tmp/gridlock_e2e_frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for frontend preview to be ready
for i in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$FRONTEND_PORT/" > /dev/null; then
    echo "   ✓ Frontend ready"
    break
  fi
  [ "$i" -eq 20 ] && { echo "✘ Frontend failed to start. Check /tmp/gridlock_e2e_frontend.log"; exit 1; }
  sleep 1
done

echo "▶  Running Playwright tests..."
TEST_BASE_URL="http://127.0.0.1:$FRONTEND_PORT" npx playwright test \
  --config=playwright.config.js "$@"
