#!/bin/bash
# rollback.sh — Quick revert of the last merge on a branch
# Usage: ./scripts/rollback.sh [branch] [commits-to-revert]
#
# Examples:
#   ./scripts/rollback.sh main      # Revert last commit on main
#   ./scripts/rollback.sh main 3    # Revert last 3 commits on main
#   ./scripts/rollback.sh develop   # Revert last commit on develop

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BRANCH="${1:-main}"
COUNT="${2:-1}"

# Validate count is a positive integer
if ! [[ "$COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo -e "${RED}Error: commit count must be a positive integer${NC}"
  exit 1
fi

# Trap for conflict recovery
trap 'echo -e "${RED}Revert hit a conflict. Resolve manually or run: git revert --abort${NC}"' ERR

echo -e "${YELLOW}⚠️  ROLLBACK: Reverting last ${COUNT} commit(s) on ${BRANCH}${NC}"
echo ""

# Checkout and pull first so preview is accurate
git checkout "$BRANCH"
git pull origin "$BRANCH"

# Show what we're reverting
echo "Commits to revert:"
git log "${BRANCH}" --oneline -n "$COUNT"
echo ""

read -p "Proceed with rollback? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

if [ "$COUNT" -eq 1 ]; then
  git revert HEAD --no-edit
else
  # Revert multiple commits (oldest first to avoid conflicts)
  git revert HEAD~${COUNT}..HEAD --no-edit
fi

echo ""
echo -e "${GREEN}✅ Reverted ${COUNT} commit(s) on ${BRANCH}. Push with:${NC}"
echo -e "   git push origin ${BRANCH}"
echo ""
echo -e "${YELLOW}⚠️  Review the revert commit before pushing!${NC}"
echo -e "   git log --oneline -n 1"
echo -e "   git diff HEAD~1"
