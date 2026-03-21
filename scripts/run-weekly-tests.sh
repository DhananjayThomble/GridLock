#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$REPO_DIR/tests/results/weekly-$(date +%Y-%m-%d)"
BETA_URL="${BETA_URL:-https://beta.gridlock.pro}"
BETA_API="${BETA_API:-https://beta-api.gridlock.pro}"
K6="${K6:-/snap/bin/k6}"

mkdir -p "$RESULTS_DIR"

echo "📅 Weekly Test Suite — $(date '+%Y-%m-%d %H:%M IST')"
echo "Target: $BETA_URL"
echo ""

# 1. Pre-flight: verify beta is alive
echo "📡 Pre-flight health check..."
HEALTH=$(curl -sf "$BETA_API/health" || echo '{"status":"error"}')
STATUS=$(echo "$HEALTH" | jq -r '.status')
if [ "$STATUS" != "ok" ]; then
  echo "❌ Beta is DOWN — aborting weekly tests"
  echo "$HEALTH" > "$RESULTS_DIR/health-failure.json"
  exit 1
fi
echo "✅ Beta healthy"

EXIT_CODE=0

# 2. Load test with k6
echo ""
echo "🔥 Running k6 load test..."
if [ -x "$K6" ] || command -v k6 &>/dev/null; then
  K6_CMD="${K6:-k6}"
  "$K6_CMD" run \
    --out json="$RESULTS_DIR/k6-output.json" \
    "$REPO_DIR/tests/weekly/load-test.k6.js" \
    2>&1 | tee "$RESULTS_DIR/k6.log" || {
    echo "⚠️ k6 load test had failures"
    EXIT_CODE=1
  }
else
  echo "⚠️ k6 not found at $K6 — skipping load test"
fi

# 3. Chaos tests (Playwright)
echo ""
echo "🌪️ Running chaos tests..."
cd "$REPO_DIR"
npx playwright test \
  --config tests/playwright.weekly.config.js \
  --grep "Chaos" \
  2>&1 | tee "$RESULTS_DIR/chaos.log" || {
  echo "⚠️ Chaos tests had failures"
  EXIT_CODE=1
}

# 4. Visual regression tests
echo ""
echo "📸 Running visual regression tests..."
npx playwright test \
  --config tests/playwright.weekly.config.js \
  --grep "Visual" \
  2>&1 | tee "$RESULTS_DIR/visual.log" || {
  echo "⚠️ Visual regression tests had failures"
  EXIT_CODE=1
}

# 5. Contract validation tests
echo ""
echo "📋 Running contract validation tests..."
npx playwright test \
  --config tests/playwright.weekly.config.js \
  --grep "Contract" \
  2>&1 | tee "$RESULTS_DIR/contract.log" || {
  echo "⚠️ Contract validation tests had failures"
  EXIT_CODE=1
}

# 6. Cleanup
echo ""
echo "🧹 Cleaning up test data..."
node "$REPO_DIR/tests/fixtures/cleanup.js" 2>&1 | tee "$RESULTS_DIR/cleanup.log"

# 7. Report
echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ Weekly tests PASSED — $(date '+%H:%M IST')"
else
  echo "❌ Weekly tests had failures (exit code: $EXIT_CODE) — see $RESULTS_DIR"
  echo "Review results in $RESULTS_DIR"
fi

exit "$EXIT_CODE"
