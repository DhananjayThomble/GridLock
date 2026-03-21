#!/usr/bin/env bash
# Usage: bash scripts/bump-version.sh minor
# Usage: bash scripts/bump-version.sh 1.2.0
set -euo pipefail

BUMP_TYPE="${1:?Usage: bump-version.sh <major|minor|patch|X.Y.Z>}"

# Read current version from root package.json
CURRENT=$(jq -r '.version' package.json)

# Calculate new version based on bump type
case "$BUMP_TYPE" in
  major|minor|patch)
    # Use node to calculate semver bump
    NEW=$(node -e "
      const [ma,mi,pa] = '$CURRENT'.split('.').map(Number);
      if ('$BUMP_TYPE' === 'major') console.log(\`\${ma+1}.0.0\`);
      if ('$BUMP_TYPE' === 'minor') console.log(\`\${ma}.\${mi+1}.0\`);
      if ('$BUMP_TYPE' === 'patch') console.log(\`\${ma}.\${mi}.\${pa+1}\`);
    ")
    ;;
  *)
    # Explicit version — validate semver format
    if ! echo "$BUMP_TYPE" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
      echo "❌ Invalid semver: $BUMP_TYPE"
      exit 1
    fi
    NEW="$BUMP_TYPE"
    ;;
esac

# Validate new version is higher than current
HIGHER=$(node -e "
  const [ca,cb,cc] = '$CURRENT'.split('.').map(Number);
  const [na,nb,nc] = '$NEW'.split(/[-.]/).slice(0,3).map(Number);
  const curr = ca*1000000 + cb*1000 + cc;
  const next = na*1000000 + nb*1000 + nc;
  console.log(next > curr ? 'yes' : 'no');
")

if [ "$HIGHER" != "yes" ]; then
  echo "❌ New version $NEW is not higher than current $CURRENT"
  exit 1
fi

echo "Bumping version: $CURRENT → $NEW"

# Update all package.json files
for f in package.json frontend/package.json backend/package.json; do
  if [ -f "$f" ]; then
    jq --arg v "$NEW" '.version = $v' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "  Updated $f"
  fi
done

# Also update frontend/.env.production VITE_APP_VERSION if it exists
if grep -q "VITE_APP_VERSION" frontend/.env.production 2>/dev/null; then
  sed -i "s/VITE_APP_VERSION=.*/VITE_APP_VERSION=$NEW/" frontend/.env.production
  echo "  Updated frontend/.env.production VITE_APP_VERSION"
else
  echo "VITE_APP_VERSION=$NEW" >> frontend/.env.production
  echo "  Added VITE_APP_VERSION to frontend/.env.production"
fi

echo "✅ Version bumped to $NEW"
