#!/bin/bash
# GridLock 6-Hour Testing Marathon
# Cycles through: socket tests, E2E tests against production, browser visual QA
# Usage: bash marathon.sh [hours]

HOURS=${1:-6}
END_TIME=$(($(date +%s) + HOURS * 3600))
REPORT_DIR="/tmp/gridlock-marathon-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPORT_DIR"
CYCLE=0

echo "🏁 GridLock Testing Marathon — ${HOURS}h until $(date -d @$END_TIME '+%Y-%m-%d %H:%M:%S IST' 2>/dev/null || date -u -d @$END_TIME '+%Y-%m-%d %H:%M:%S UTC')"
echo "📁 Reports: $REPORT_DIR"
echo ""

cd /home/ubuntu/projects/GridLock

while [ $(date +%s) -lt $END_TIME ]; do
  CYCLE=$((CYCLE + 1))
  echo ""
  echo "═══════════════════════════════════════════"
  echo "🔄 CYCLE $CYCLE — $(date '+%H:%M:%S')"
  echo "═══════════════════════════════════════════"

  # --- Phase 1: Socket gameplay tests (all combos) ---
  echo ""
  echo "📡 Phase 1: Socket gameplay (36 configs)"
  node scripts/playtest-agent.js creator https://gridlock-api.snapurl.in "$REPORT_DIR/socket-cycle${CYCLE}.json" 2>&1 | tee "$REPORT_DIR/socket-cycle${CYCLE}.log"
  COMPLETED=$(cat "$REPORT_DIR/socket-cycle${CYCLE}.json" 2>/dev/null | jq -r '.gamesCompleted // 0')
  BUGS=$(cat "$REPORT_DIR/socket-cycle${CYCLE}.json" 2>/dev/null | jq -r '.bugs | length // 0')
  echo "  → Completed: $COMPLETED/36, Bugs: $BUGS"

  [ $(date +%s) -ge $END_TIME ] && break
  sleep 30 # cooldown for rate limiter

  # --- Phase 2: Chaos / fuzz testing ---
  echo ""
  echo "🔥 Phase 2: Chaos testing"
  node scripts/playtest-agent.js chaos https://gridlock-api.snapurl.in "$REPORT_DIR/chaos-cycle${CYCLE}.json" 2>&1 | tee "$REPORT_DIR/chaos-cycle${CYCLE}.log"
  CHAOS_BUGS=$(cat "$REPORT_DIR/chaos-cycle${CYCLE}.json" 2>/dev/null | jq -r '.bugs | length // 0')
  echo "  → Chaos bugs: $CHAOS_BUGS"

  [ $(date +%s) -ge $END_TIME ] && break
  sleep 30

  # --- Phase 3: Advanced scenarios (edge cases) ---
  echo ""
  echo "🧪 Phase 3: Advanced scenarios"
  node scripts/playtest-advanced.js https://gridlock-api.snapurl.in "$REPORT_DIR/advanced-cycle${CYCLE}.json" 2>&1 | tee "$REPORT_DIR/advanced-cycle${CYCLE}.log"
  ADV_BUGS=$(cat "$REPORT_DIR/advanced-cycle${CYCLE}.json" 2>/dev/null | jq -r '.bugs | length // 0')
  echo "  → Advanced bugs: $ADV_BUGS"

  [ $(date +%s) -ge $END_TIME ] && break
  sleep 30

  # --- Phase 4: E2E Playwright against beta ---
  echo ""
  echo "🎭 Phase 4: E2E tests against beta"
  cd /home/ubuntu/projects/GridLock
  TEST_BASE_URL=https://beta-gridlock.snapurl.in SOCKET_URL=https://gridlock-api.snapurl.in npx playwright test --reporter=json 2>"$REPORT_DIR/e2e-cycle${CYCLE}.err" > "$REPORT_DIR/e2e-cycle${CYCLE}.json"
  E2E_PASS=$(cat "$REPORT_DIR/e2e-cycle${CYCLE}.json" 2>/dev/null | jq '.stats.expected // 0')
  E2E_FAIL=$(cat "$REPORT_DIR/e2e-cycle${CYCLE}.json" 2>/dev/null | jq '.stats.unexpected // 0')
  echo "  → E2E: $E2E_PASS passed, $E2E_FAIL failed"

  [ $(date +%s) -ge $END_TIME ] && break
  sleep 30

  # --- Phase 5: Visual QA screenshots ---
  echo ""
  echo "📸 Phase 5: Visual QA screenshots"
  bash scripts/visual-qa.sh "$REPORT_DIR/screenshots-cycle${CYCLE}" 2>&1 | tee "$REPORT_DIR/visual-cycle${CYCLE}.log" | tail -10

  [ $(date +%s) -ge $END_TIME ] && break

  # --- Summary ---
  echo ""
  echo "📊 Cycle $CYCLE complete at $(date '+%H:%M:%S')"
  echo "  Socket: $COMPLETED games, $BUGS bugs"
  echo "  Advanced: $ADV_BUGS bugs"
  echo "  E2E: $E2E_PASS pass, $E2E_FAIL fail"
  echo "  Chaos: $CHAOS_BUGS bugs"
  echo "  Time remaining: $(( (END_TIME - $(date +%s)) / 60 )) min"
  
  sleep 60 # rest between cycles
done

# Final summary
echo ""
echo "═══════════════════════════════════════════"
echo "🏁 MARATHON COMPLETE — $CYCLE cycles"
echo "═══════════════════════════════════════════"
TOTAL_BUGS=$(cat "$REPORT_DIR"/*.json 2>/dev/null | jq -s '[.[].bugs | length] | add // 0')
TOTAL_GAMES=$(cat "$REPORT_DIR"/socket-*.json 2>/dev/null | jq -s '[.[].gamesCompleted] | add // 0')
echo "Total games: $TOTAL_GAMES"
echo "Total bugs: $TOTAL_BUGS"
echo "Reports: $REPORT_DIR"
echo "MARATHON_DONE cycles=$CYCLE games=$TOTAL_GAMES bugs=$TOTAL_BUGS"
