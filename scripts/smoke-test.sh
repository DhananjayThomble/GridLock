#!/usr/bin/env bash
# smoke-test.sh — Post-deploy smoke tests for GridLock backend
#
# Usage: ./scripts/smoke-test.sh [base_url]
# Default: https://gridlock-api.snapurl.in
#
# Runs:
#   1. Deep health check (GET /health/deep → 200)
#   2. WebSocket smoke test (create_game flow)
#
# Exit 0 on success, 1 on any failure.

set -euo pipefail

BASE_URL="${1:-https://gridlock-api.snapurl.in}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0

print_result() {
  local status="$1" label="$2" detail="${3:-}"
  if [ "$status" = "pass" ]; then
    echo "✅ $label${detail:+ — $detail}"
    ((PASS++))
  else
    echo "❌ $label${detail:+ — $detail}"
    ((FAIL++))
  fi
}

echo "========================================="
echo " GridLock Smoke Tests"
echo " Target: $BASE_URL"
echo "========================================="
echo ""

# --- 1. Deep Health Check ---
echo "--- Deep Health Check ---"
HTTP_CODE=$(curl -s -o /tmp/smoke-health.json -w '%{http_code}' \
  --max-time 10 "${BASE_URL}/health/deep" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  STATUS=$(cat /tmp/smoke-health.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
  print_result "pass" "GET /health/deep" "HTTP $HTTP_CODE, status=$STATUS"
else
  BODY=$(cat /tmp/smoke-health.json 2>/dev/null || echo "(no body)")
  print_result "fail" "GET /health/deep" "HTTP $HTTP_CODE — $BODY"
fi
echo ""

# --- 2. WebSocket Smoke Test ---
echo "--- WebSocket Smoke Test ---"
if node "$SCRIPT_DIR/smoke-test.js" "$BASE_URL"; then
  print_result "pass" "WebSocket create_game flow"
else
  print_result "fail" "WebSocket create_game flow"
fi
echo ""

# --- Summary ---
echo "========================================="
echo " Results: $PASS passed, $FAIL failed"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
