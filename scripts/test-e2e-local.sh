#!/usr/bin/env bash
# Run Playwright against a dedicated database and local ports.
# Usage: npm run test:e2e:local -- e2e/11-share-result.spec.js

set -euo pipefail

BACKEND_PORT="${TEST_BACKEND_PORT:-5105}"
FRONTEND_PORT="${TEST_FRONTEND_PORT:-4175}"
MONGO_URI="${TEST_MONGO_URI:-mongodb://127.0.0.1:27017/gridlock_e2e_local}"
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$(mktemp -d)"
cd "$ROOT_DIR"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

wait_for_server() {
  local url="$1" pid="$2" log="$3"
  for ((attempt = 0; attempt < 30; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Server did not start at $url. See $log" >&2
  tail -n 15 "$log" >&2
  return 1
}

for url in "$BACKEND_URL" "$FRONTEND_URL"; do
  if curl -sS --max-time 1 -o /dev/null "$url" 2>/dev/null; then
    echo "A server is already listening at $url. Set TEST_BACKEND_PORT or TEST_FRONTEND_PORT to use another port." >&2
    exit 1
  fi
done

PORT="$BACKEND_PORT" NODE_ENV=test MONGO_URI="$MONGO_URI" CORS_ORIGIN="$FRONTEND_URL" \
  node backend/server.js >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
wait_for_server "$BACKEND_URL/health" "$BACKEND_PID" "$LOG_DIR/backend.log"

VITE_SOCKET_URL="$BACKEND_URL" VITE_API_BASE_URL="$BACKEND_URL" npm --prefix frontend run build
(
  cd frontend
  exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort --base=/
) >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
wait_for_server "$FRONTEND_URL/" "$FRONTEND_PID" "$LOG_DIR/frontend.log"

TEST_BASE_URL="$FRONTEND_URL" TEST_API_URL="$BACKEND_URL" npx --no-install playwright test \
  --config=playwright.config.js "$@"
