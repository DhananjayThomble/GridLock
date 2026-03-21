#!/usr/bin/env bash
# Upload source maps to self-hosted Sentry after a frontend build.
# Usage: bash scripts/upload-sourcemaps.sh [project] [org]
#
# Requires:
#   - SENTRY_AUTH_TOKEN env var or ~/.sentry-token file
#   - sentry-cli (via npx @sentry/cli)
#   - Frontend built with SENTRY_SOURCEMAPS=1 (hidden source maps)
#
# The vite plugin's chunk-upload hits 413 on self-hosted Sentry's relay,
# so we use sentry-cli's file-by-file upload instead.
set -euo pipefail

PROJECT="${1:-gridlock-prod}"
ORG="${2:-sentry}"
SENTRY_URL="${SENTRY_URL:-http://localhost:9000}"
DIST_DIR="frontend/dist/assets"
RELEASE="$(git rev-parse HEAD)"

# Resolve auth token
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  if [ -f "$HOME/.sentry-token" ]; then
    SENTRY_AUTH_TOKEN="$(cat "$HOME/.sentry-token")"
    export SENTRY_AUTH_TOKEN
  else
    echo "❌ No SENTRY_AUTH_TOKEN set and ~/.sentry-token not found"
    exit 1
  fi
fi

export SENTRY_URL

# Check source maps exist
if ! ls "$DIST_DIR"/*.map &>/dev/null; then
  echo "⚠️  No .map files in $DIST_DIR — build with SENTRY_SOURCEMAPS=1"
  exit 0
fi

echo "📦 Uploading source maps to Sentry..."
echo "   Org: $ORG | Project: $PROJECT"
echo "   Release: $RELEASE"
echo "   URL: $SENTRY_URL"

npx @sentry/cli sourcemaps upload \
  --org "$ORG" \
  --project "$PROJECT" \
  --release "$RELEASE" \
  "$DIST_DIR"

echo "🗑️  Removing .map files from build output..."
rm -f "$DIST_DIR"/*.map

echo "✅ Source maps uploaded and cleaned up."
