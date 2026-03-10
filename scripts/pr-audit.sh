#!/bin/bash
# pr-audit.sh — Scans recently merged PRs for missing review cycles.
# Usage: ./scripts/pr-audit.sh [hours]
# Default: checks PRs merged in last 24 hours.
#
# Run during heartbeats to catch any PRs that bypassed the merge gate.

set -euo pipefail

REPO="DhananjayThomble/GridLock"
HOURS="${1:-24}"
REVIEW_PATTERN="## Review Cycle"
MIN_REVIEW_CYCLES=2

# Validate hours is a positive integer
if ! [[ "$HOURS" =~ ^[0-9]+$ ]]; then
  echo "Error: hours must be a positive integer"
  exit 1
fi

# Get PRs merged in the time window
SINCE=$(date -u -d "${HOURS} hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-${HOURS}H +%Y-%m-%dT%H:%M:%SZ)

# List recently merged PRs (limit 200 for large time windows)
MERGED_PRS=$(gh pr list --repo "$REPO" --state merged --limit 200 --json number,title,mergedAt,comments --jq \
  "[.[] | select(.mergedAt >= \"$SINCE\")] | .[] | {number, title, mergedAt, reviewCycles: ([.comments[].body | select(contains(\"$REVIEW_PATTERN\"))] | length)}")

if [ -z "$MERGED_PRS" ]; then
  echo "✅ No PRs merged in the last ${HOURS}h."
  exit 0
fi

VIOLATIONS=""
while IFS= read -r pr; do
  PR_NUM=$(echo "$pr" | jq -r '.number')
  PR_TITLE=$(echo "$pr" | jq -r '.title')
  CYCLES=$(echo "$pr" | jq -r '.reviewCycles')
  MERGED_AT=$(echo "$pr" | jq -r '.mergedAt')
  
  if [ "$CYCLES" -lt "$MIN_REVIEW_CYCLES" ]; then
    VIOLATIONS="${VIOLATIONS}$(printf '⚠️ PR #%s (%s) — merged at %s with only %s review cycle(s)\n' "$PR_NUM" "$PR_TITLE" "$MERGED_AT" "$CYCLES")"
  fi
done <<< "$(echo "$MERGED_PRS" | jq -c '.')"

if [ -n "$VIOLATIONS" ]; then
  echo "🚨 REVIEW VIOLATIONS FOUND (last ${HOURS}h):"
  echo "$VIOLATIONS"
  exit 1
else
  echo "✅ All ${HOURS}h merged PRs have ≥${MIN_REVIEW_CYCLES} review cycles."
  exit 0
fi
