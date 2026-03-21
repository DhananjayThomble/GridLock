#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$REPO_DIR/tests/results/nightly-$(date +%Y-%m-%d)"
BETA_URL="${BETA_URL:-https://beta.gridlock.pro}"
BETA_API="${BETA_API:-https://beta-api.gridlock.pro}"

mkdir -p "$RESULTS_DIR"

echo "🌙 Nightly Test Suite — $(date '+%Y-%m-%d %H:%M IST')"
echo "Target: $BETA_URL"
echo ""

# 1. Pre-flight: verify beta is alive
echo "📡 Pre-flight health check..."
HEALTH=$(curl -sf "$BETA_API/health" || echo '{"status":"error"}')
STATUS=$(echo "$HEALTH" | jq -r '.status')
if [ "$STATUS" != "ok" ]; then
  echo "❌ Beta is DOWN — aborting nightly tests"
  echo "$HEALTH" > "$RESULTS_DIR/health-failure.json"
  exit 1
fi
echo "✅ Beta healthy"

# 2. Seed test data
echo "🌱 Seeding test data..."
node "$REPO_DIR/tests/fixtures/seed-data.js" 2>&1 | tee "$RESULTS_DIR/seed.log"

# 3. Run nightly Playwright tests
echo "🎭 Running nightly tests..."
cd "$REPO_DIR"
EXIT_CODE=0
npx playwright test \
  --config tests/playwright.nightly.config.js \
  2>&1 | tee "$RESULTS_DIR/playwright.log" || EXIT_CODE=$?

# 4. Cleanup
echo "🧹 Cleaning up test data..."
node "$REPO_DIR/tests/fixtures/cleanup.js" 2>&1 | tee "$RESULTS_DIR/cleanup.log"

# 5. Copy results
if [ -f "tests/results/nightly-results.json" ]; then
  cp tests/results/nightly-results.json "$RESULTS_DIR/results.json" 2>/dev/null || true
fi

# 6. Performance comparison
echo "📊 Checking performance trends..."
node -e "
const fs = require('fs');
const baselinesPath = '$REPO_DIR/tests/baselines/performance.json';
try {
  const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf8'));
  console.log('  Last updated:', baselines.updatedAt || 'unknown');
  if (baselines.pageLoad) {
    for (const [page, metrics] of Object.entries(baselines.pageLoad)) {
      console.log('  ' + page + ':', JSON.stringify(metrics));
    }
  }
} catch (e) {
  console.log('  No baselines found');
}
console.log('Performance check complete');
"

# 7. Report
echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ Nightly tests PASSED — $(date '+%H:%M IST')"
else
  echo "❌ Nightly tests FAILED (exit code: $EXIT_CODE) — see $RESULTS_DIR"
  echo "Failures will be reported to #beta-alerts"
fi

exit "$EXIT_CODE"
