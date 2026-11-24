#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root after building frontend with SENTRY_SOURCEMAPS=1.
project="${1:?Sentry project slug is required}"
org="${2:?Sentry organization slug is required}"
: "${SENTRY_AUTH_TOKEN:?A Sentry source-map upload token is required}"
: "${VITE_SENTRY_RELEASE:?The release must match the frontend build}"
export SENTRY_URL="${SENTRY_URL:-https://sentry.io}"

dist=frontend/dist/assets
cli=frontend/node_modules/.bin/sentry-cli
if ! compgen -G "$dist/*.map" >/dev/null; then
  echo "No frontend source maps found in $dist" >&2
  exit 1
fi

"$cli" sourcemaps inject "$dist"
"$cli" sourcemaps upload --org "$org" --project "$project" \
  --release "$VITE_SENTRY_RELEASE" --url-prefix '~/assets' --wait-for 60 "$dist"
rm -f "$dist"/*.map
