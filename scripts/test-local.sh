#!/bin/bash
set -e

echo "═══════════════════════════════════════"
echo "  GridLock Local CI"
echo "═══════════════════════════════════════"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

run_step() {
  local name="$1"
  shift
  echo -e "\n${YELLOW}▶ $name${NC}"
  if "$@"; then
    echo -e "${GREEN}✅ $name passed${NC}"
    ((PASS++))
  else
    echo -e "${RED}❌ $name failed${NC}"
    ((FAIL++))
    return 1
  fi
}

# 1. Frontend lint
run_step "Frontend ESLint" bash -c "cd frontend && npx eslint src/ --quiet" || true

# 2. Backend unit tests
run_step "Backend Unit Tests" bash -c "cd backend && npm test" || true

# 3. Frontend build check
run_step "Frontend Build" bash -c "cd frontend && npm run build" || true

# 4. E2E tests (if servers are running)
if curl -s http://localhost:5173 > /dev/null 2>&1 || curl -s http://localhost/beta > /dev/null 2>&1; then
  run_step "E2E Tests" bash -c "npm run test:e2e" || true
else
  echo -e "\n${YELLOW}⚠️  Skipping E2E tests — no dev server running${NC}"
  echo "Start servers first: cd frontend && npm run dev (and backend)"
fi

# Summary
echo -e "\n═══════════════════════════════════════"
echo -e "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "═══════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}❌ Local CI failed${NC}"
  exit 1
else
  echo -e "${GREEN}✅ All checks passed${NC}"
  exit 0
fi
