#!/bin/bash
# merge-gate.sh — Enforces minimum review cycles before allowing PR merge.
# Usage: ./scripts/merge-gate.sh <PR_NUMBER> [--squash|--merge|--rebase]
#
# Rules:
#   - Minimum 2 review cycle comments matching "## Review Cycle" pattern
#   - Local CI must pass (lint + build + tests)
#   - If PR touches touch/gesture files → requires "phone-tested" label
#
# NOTE: This script is the ONLY merge path. Never call `gh pr merge` directly.
# enforce_admins + required PRs are enabled on develop.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO="DhananjayThomble/GridLock"
MIN_REVIEW_CYCLES=2
REVIEW_PATTERN="## Review Cycle"
MERGE_STRATEGY="${2:---squash}"
TOUCH_FILES=("Board.jsx" "BoardZoomWrapper.jsx")

REPO_ROOT=$(git rev-parse --show-toplevel)
ORIGINAL_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)

# Restore original branch on exit (success or failure)
cleanup() {
  git -C "$REPO_ROOT" checkout "$ORIGINAL_BRANCH" > /dev/null 2>&1 || true
}
trap cleanup EXIT

if [ -z "${1:-}" ]; then
  echo -e "${RED}Usage: ./scripts/merge-gate.sh <PR_NUMBER> [--squash|--merge|--rebase]${NC}"
  exit 1
fi

PR_NUMBER="$1"

# Validate PR number is a positive integer
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo -e "${RED}Error: PR number must be a positive integer${NC}"
  exit 1
fi

echo "🔍 Checking PR #${PR_NUMBER} merge readiness..."

# 1. Check for actual review cycle comments (must contain "## Review Cycle" pattern)
# This prevents gaming with dummy comments like "lgtm" or emoji
REVIEW_CYCLE_COUNT=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json comments --jq "[.comments[].body | select(contains(\"$REVIEW_PATTERN\"))] | length")
echo "   Review cycle comments: ${REVIEW_CYCLE_COUNT} (minimum: ${MIN_REVIEW_CYCLES})"

if [ "$REVIEW_CYCLE_COUNT" -lt "$MIN_REVIEW_CYCLES" ]; then
  echo -e "${RED}❌ BLOCKED: PR #${PR_NUMBER} has only ${REVIEW_CYCLE_COUNT} review cycle comments.${NC}"
  echo -e "${RED}   Need ${MIN_REVIEW_CYCLES} comments containing '${REVIEW_PATTERN}'.${NC}"
  echo -e "${YELLOW}   Run at least ${MIN_REVIEW_CYCLES} review cycles using scripts/review-prompt.md before merging.${NC}"
  exit 1
fi

# 2. Checkout the PR branch before running CI (ensure we test the actual PR code)
PR_BRANCH=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefName --jq '.headRefName')
echo "   Checking out PR branch: ${PR_BRANCH}..."

if ! (cd "$REPO_ROOT" && git fetch origin "$PR_BRANCH" && git checkout "$PR_BRANCH" && git pull origin "$PR_BRANCH"); then
  echo -e "${RED}❌ BLOCKED: Failed to checkout PR branch '${PR_BRANCH}'.${NC}"
  exit 1
fi

# Verify checkout actually succeeded (belt-and-suspenders)
CURRENT_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)
if [ "$CURRENT_BRANCH" != "$PR_BRANCH" ]; then
  echo -e "${RED}❌ BLOCKED: Expected branch '${PR_BRANCH}' but on '${CURRENT_BRANCH}'.${NC}"
  exit 1
fi

# 3. Run CI locally (GitHub Actions quota exhausted — all checks run here)
echo "   Running local CI on branch ${PR_BRANCH}..."

# Frontend build + lint
echo "   → Frontend lint..."
if ! (cd "$REPO_ROOT/frontend" && npx eslint src/ --quiet 2>&1); then
  echo -e "${RED}❌ BLOCKED: Frontend lint failed.${NC}"
  exit 1
fi
echo "   → Frontend build..."
if ! (cd "$REPO_ROOT/frontend" && npm run build --silent 2>&1 | tail -3); then
  echo -e "${RED}❌ BLOCKED: Frontend build failed.${NC}"
  exit 1
fi
echo -e "   → Frontend: ${GREEN}OK${NC}"

# Backend tests
echo "   → Backend tests..."
if ! (cd "$REPO_ROOT/backend" && npm test --silent 2>&1 | tail -5); then
  echo -e "${RED}❌ BLOCKED: Backend tests failed.${NC}"
  exit 1
fi
echo -e "   → Backend: ${GREEN}OK${NC}"

echo -e "   Local CI: ${GREEN}ALL PASSED${NC}"

# 4. Check if PR touches touch/gesture files → needs phone-tested label
CHANGED_FILES=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json files --jq '.files[].path')
NEEDS_PHONE_TEST=false

for touch_file in "${TOUCH_FILES[@]}"; do
  if echo "$CHANGED_FILES" | grep -qE "(^|/)${touch_file}$"; then
    NEEDS_PHONE_TEST=true
    break
  fi
done

if [ "$NEEDS_PHONE_TEST" = true ]; then
  LABELS=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json labels --jq '.labels[].name')
  if ! echo "$LABELS" | grep -q "phone-tested"; then
    echo -e "${RED}❌ BLOCKED: PR touches touch/gesture files but missing 'phone-tested' label.${NC}"
    echo -e "${YELLOW}   DJ must test on phone and add 'phone-tested' label before merge.${NC}"
    exit 1
  fi
  echo -e "   Phone test: ${GREEN}Verified${NC}"
fi

# 5. Check PR is mergeable
MERGEABLE=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json mergeable --jq '.mergeable')
if [ "$MERGEABLE" != "MERGEABLE" ]; then
  echo -e "${RED}❌ BLOCKED: PR is not mergeable (state: ${MERGEABLE}). Fix conflicts.${NC}"
  exit 1
fi
echo -e "   Mergeable: ${GREEN}OK${NC}"

# All checks passed — merge
echo ""
echo -e "${GREEN}✅ All gates passed. Merging PR #${PR_NUMBER}...${NC}"
gh pr merge "$PR_NUMBER" --repo "$REPO" "$MERGE_STRATEGY" --delete-branch

echo -e "${GREEN}🎉 PR #${PR_NUMBER} merged successfully.${NC}"
