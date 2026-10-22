#!/usr/bin/env bash
# Usage: bash scripts/sync-main-into-develop.sh
#
# Repairs a main/develop history split (typically after a squash-merged
# release PR) by preparing a history-only merge of main into develop. The
# result keeps develop's files exactly as they are, so run this only when
# main has no changes that develop lacks (no direct hotfixes on main).
#
# It pushes a branch; open a PR to develop and merge it with a MERGE COMMIT.
set -euo pipefail

git fetch origin main develop --quiet

if git merge-base --is-ancestor origin/main origin/develop; then
  echo "✅ develop already contains main. Nothing to do."
  exit 0
fi

echo "Commits on main that develop does not contain:"
git log --oneline origin/develop..origin/main
echo ""
echo "Files where main differs from develop (should only be changes develop has made since):"
git diff --stat origin/develop origin/main | tail -15
echo ""
read -r -p "main has no unique changes that must be kept? Continue (y/N) " ok
[ "$ok" = "y" ] || { echo "Aborted."; exit 1; }

BRANCH="sync/main-into-develop-$(date +%Y%m%d-%H%M%S)"
git checkout -B "$BRANCH" origin/develop --quiet
git merge -s ours origin/main -m "chore: merge main back into develop

History-only merge after a squash-merged release; develop already
contains every change on main."

if [ -n "$(git diff --name-only origin/develop HEAD)" ]; then
  echo "❌ Merge changed files unexpectedly; aborting."
  exit 1
fi

git push -u origin "$BRANCH"
echo ""
echo "✅ Pushed $BRANCH."
echo "Next: open a PR into develop and merge it with 'Create a merge commit'."
