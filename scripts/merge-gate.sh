#!/bin/bash
# merge-gate.sh — Enforces minimum review cycles before allowing PR merge.
# Usage: ./scripts/merge-gate.sh <PR_NUMBER> [--squash|--merge|--rebase]
#
# Rules:
#   - Minimum 2 review cycle comments on the PR
#   - Build must pass (CI check)
#   - If PR touches touch/gesture files → requires "phone-tested" label
#
# NOTE: This script is the ONLY merge path. Never call `gh pr merge` directly.
# It does not use --admin bypass. enforce_admins is enabled on develop.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO="DhananjayThomble/GridLock"
MIN_REVIEW_COMMENTS=2
MERGE_STRATEGY="${2:---squash}"
TOUCH_FILES=("Board.jsx" "BoardZoomWrapper.jsx")

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

# 1. Check review cycle comments (actual PR reviews, not just conversation comments)
REVIEW_COUNT=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json reviews --jq '[.reviews[] | select(.state == "COMMENTED" or .state == "APPROVED")] | length')
COMMENT_COUNT=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json comments --jq '.comments | length')
TOTAL_REVIEWS=$((REVIEW_COUNT + COMMENT_COUNT))
echo "   Reviews: ${REVIEW_COUNT}, Comments: ${COMMENT_COUNT}, Total: ${TOTAL_REVIEWS} (minimum: ${MIN_REVIEW_COMMENTS})"

if [ "$TOTAL_REVIEWS" -lt "$MIN_REVIEW_COMMENTS" ]; then
  echo -e "${RED}❌ BLOCKED: PR #${PR_NUMBER} has only ${TOTAL_REVIEWS} review/comments. Minimum ${MIN_REVIEW_COMMENTS} required.${NC}"
  echo -e "${YELLOW}   Run at least 2 review cycles before merging.${NC}"
  exit 1
fi

# 2. Check CI status via JSON API
echo "   Checking CI status..."
FAILED=$(gh pr checks "$PR_NUMBER" --repo "$REPO" --json state --jq '[.[] | select(.state != "SUCCESS" and .state != "SKIPPED")] | length' 2>/dev/null || echo "-1")

if [ "$FAILED" = "-1" ]; then
  echo -e "${YELLOW}⚠️  Could not query CI status (API error). Verify manually.${NC}"
  echo -e "${YELLOW}   Run: gh pr checks ${PR_NUMBER} --repo ${REPO}${NC}"
  read -p "   Continue anyway? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
elif [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}❌ BLOCKED: ${FAILED} CI check(s) not passing.${NC}"
  gh pr checks "$PR_NUMBER" --repo "$REPO" 2>/dev/null || true
  exit 1
else
  echo -e "   CI: ${GREEN}OK${NC}"
fi

# 3. Check if PR touches touch/gesture files → needs phone-tested label
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

# 4. Check PR is mergeable
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
