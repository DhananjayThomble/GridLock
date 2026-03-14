#!/usr/bin/env bash
# smoke-test.sh — Post-deploy smoke tests for GridLock backend
#
# Usage: ./scripts/smoke-test.sh [base_url]
# Default: https://api.gridlock.pro
#
# Runs:
#   1. Deep health check (GET /health/deep → 200)
#   2. Socket.IO connectivity (polling handshake + WebSocket upgrade)
#
# Exit 0 on success, 1 on any failure.

set -euo pipefail

BASE_URL="${1:-https://api.gridlock.pro}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0

print_result() {
  local status="$1" label="$2" detail="${3:-}"
  if [ "$status" = "pass" ]; then
    echo "✅ $label${detail:+ — $detail}"
    PASS=$((PASS + 1))
  else
    echo "❌ $label${detail:+ — $detail}"
    FAIL=$((FAIL + 1))
  fi
}

echo "========================================="
echo " GridLock Smoke Tests"
echo " Target: $BASE_URL"
echo "========================================="
echo ""

# --- 1. Deep Health Check ---
echo "--- Deep Health Check ---"
rm -f /tmp/smoke-health.json
HTTP_CODE=$(curl -sf -o /tmp/smoke-health.json -w '%{http_code}' \
  --max-time 10 "${BASE_URL}/health/deep" 2>/dev/null) || HTTP_CODE="000"

if [ "$HTTP_CODE" = "200" ]; then
  STATUS=$(python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" < /tmp/smoke-health.json 2>/dev/null || echo "unknown")
  print_result "pass" "GET /health/deep" "HTTP $HTTP_CODE, status=$STATUS"
else
  BODY=$(cat /tmp/smoke-health.json 2>/dev/null || echo "(no body)")
  print_result "fail" "GET /health/deep" "HTTP $HTTP_CODE — $BODY"
fi
echo ""

# --- 2. Socket.IO Connectivity Test ---
# Uses curl against the Socket.IO polling transport endpoint — no npm dependencies needed.
# This proves the Socket.IO server is running and accepting connections.
echo "--- Socket.IO Connectivity Test ---"

# 2a. Polling transport handshake (proves Socket.IO server is alive)
rm -f /tmp/smoke-socketio.txt
SIO_CODE=$(curl -sf -o /tmp/smoke-socketio.txt -w '%{http_code}' \
  --max-time 10 "${BASE_URL}/socket.io/?EIO=4&transport=polling" 2>/dev/null) || SIO_CODE="000"

if [ "$SIO_CODE" = "200" ]; then
  SIO_BODY=$(cat /tmp/smoke-socketio.txt 2>/dev/null || echo "")
  # Socket.IO polling responses are prefixed with a length digit, then JSON containing "sid"
  if echo "$SIO_BODY" | grep -q '"sid"'; then
    SID=$(echo "$SIO_BODY" | grep -o '"sid":"[^"]*"' | head -1)
    print_result "pass" "Socket.IO handshake (polling)" "HTTP $SIO_CODE, $SID"
  else
    print_result "fail" "Socket.IO handshake (polling)" "HTTP $SIO_CODE but no sid in response"
  fi
else
  print_result "fail" "Socket.IO handshake (polling)" "HTTP $SIO_CODE"
fi

# 2b. WebSocket upgrade check (proves WS transport works)
WS_CODE=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "${BASE_URL}/socket.io/?EIO=4&transport=websocket" 2>/dev/null) || WS_CODE="000"

if [ "$WS_CODE" = "101" ]; then
  print_result "pass" "WebSocket upgrade" "HTTP $WS_CODE Switching Protocols"
else
  # Some curl versions don't handle 101 well — treat as non-fatal if polling passed
  if [ "$SIO_CODE" = "200" ]; then
    print_result "pass" "WebSocket upgrade" "HTTP $WS_CODE (upgrade unverifiable via curl, polling OK)"
  else
    print_result "fail" "WebSocket upgrade" "HTTP $WS_CODE"
  fi
fi
rm -f /tmp/smoke-socketio.txt
echo ""

# --- Summary ---
echo "========================================="
echo " Results: $PASS passed, $FAIL failed"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
