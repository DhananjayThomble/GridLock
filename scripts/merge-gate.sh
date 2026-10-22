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
REVIEW_PATTERN="## Review"
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

# ── Version validation for release PRs targeting main ──
# Must run AFTER checkout so we check versions from the PR branch, not the current branch
PR_BASE=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json baseRefName --jq '.baseRefName')
if [ "$PR_BASE" = "main" ]; then
  echo "   Release PR detected (target: main) — running version checks..."

  # All 3 package.json versions must match
  ROOT_V=$(jq -r '.version' package.json)
  FE_V=$(jq -r '.version' frontend/package.json)
  BE_V=$(jq -r '.version' backend/package.json)
  if [ "$ROOT_V" != "$FE_V" ] || [ "$ROOT_V" != "$BE_V" ]; then
    echo -e "${RED}❌ BLOCKED: Version mismatch: root=$ROOT_V frontend=$FE_V backend=$BE_V${NC}"
    echo -e "${YELLOW}   Run: bash scripts/bump-version.sh $ROOT_V${NC}"
    exit 1
  fi
  echo -e "   Version consistency: ${GREEN}OK${NC} ($ROOT_V)"

  # Version must be valid semver
  if ! echo "$ROOT_V" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
    echo -e "${RED}❌ BLOCKED: Version '$ROOT_V' is not valid semver${NC}"
    exit 1
  fi
  echo -e "   Semver format: ${GREEN}OK${NC}"

  # Version tag must not already exist
  if git tag -l "v${ROOT_V}" | grep -q "v${ROOT_V}"; then
    echo -e "${RED}❌ BLOCKED: Tag v${ROOT_V} already exists${NC}"
    exit 1
  fi
  echo -e "   Tag available: ${GREEN}OK${NC}"

  # Version must be higher than latest git tag
  LATEST_TAG=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 | sed 's/^v//')
  if [ -n "$LATEST_TAG" ]; then
    IS_HIGHER=$(node -e "
      const [ca,cb,cc] = '$LATEST_TAG'.split('.').map(Number);
      const [na,nb,nc] = '$ROOT_V'.split('.').map(Number);
      console.log((na*1000000+nb*1000+nc) > (ca*1000000+cb*1000+cc) ? 'yes' : 'no');
    ")
    if [ "$IS_HIGHER" != "yes" ]; then
      echo -e "${RED}❌ BLOCKED: Version $ROOT_V is not higher than latest tag v${LATEST_TAG}${NC}"
      exit 1
    fi
    echo -e "   Version bump: ${GREEN}OK${NC} (v${LATEST_TAG} → v${ROOT_V})"
  fi

  # CHANGELOG.md must have an entry for this version
  if ! grep -q "\[${ROOT_V}\]" CHANGELOG.md 2>/dev/null; then
    echo -e "${RED}❌ BLOCKED: CHANGELOG.md has no entry for version ${ROOT_V}${NC}"
    echo -e "${YELLOW}   Add a ## [${ROOT_V}] section to CHANGELOG.md${NC}"
    exit 1
  fi
  echo -e "   CHANGELOG entry: ${GREEN}OK${NC}"
fi

# 3. CI must pass on GitHub (.github/workflows/ci.yml, GitHub-hosted runners)
echo "   Waiting for GitHub CI checks on PR #${PR_NUMBER}..."
if ! gh pr checks "$PR_NUMBER" --repo "$REPO" --watch --fail-fast; then
  echo -e "${RED}❌ BLOCKED: GitHub CI checks failed or are missing.${NC}"
  exit 1
fi
echo -e "   GitHub CI: ${GREEN}PASSED${NC}"

# Optional local re-run — heavy, never do this on the production server
if [ "${MERGE_GATE_LOCAL_CI:-0}" != "1" ]; then
  echo "   Skipping local CI (set MERGE_GATE_LOCAL_CI=1 to run it)"
else
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
fi

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
    echo -e "${YELLOW}   A maintainer must test on a phone and add 'phone-tested' label before merge.${NC}"
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
