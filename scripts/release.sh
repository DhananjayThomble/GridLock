#!/usr/bin/env bash
# Usage: bash scripts/release.sh
# Must be run from develop branch AFTER version bump
set -euo pipefail

VERSION=$(jq -r '.version' package.json)
BRANCH=$(git branch --show-current)

echo "🚀 Release v${VERSION}"
echo ""

# Pre-flight checks
echo "Running pre-flight checks..."

# 1. Must be on develop
if [ "$BRANCH" != "develop" ]; then
  echo "❌ Must be on develop branch (currently on $BRANCH)"
  exit 1
fi

# 2. Working tree must be clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree not clean. Commit or stash changes first."
  exit 1
fi

# 3. Version must not already be tagged
if git tag -l "v${VERSION}" | grep -q "v${VERSION}"; then
  echo "❌ Tag v${VERSION} already exists"
  exit 1
fi

# 4. All package.json versions must match
ROOT_V=$(jq -r '.version' package.json)
FE_V=$(jq -r '.version' frontend/package.json)
BE_V=$(jq -r '.version' backend/package.json)
if [ "$ROOT_V" != "$FE_V" ] || [ "$ROOT_V" != "$BE_V" ]; then
  echo "❌ Version mismatch: root=$ROOT_V frontend=$FE_V backend=$BE_V"
  echo "   Run: bash scripts/bump-version.sh $ROOT_V"
  exit 1
fi

# 5. Tests must pass
echo "Running tests..."
cd backend && npm test && cd ..
cd frontend && npm run build && cd ..

echo ""
echo "✅ All pre-flight checks passed"
echo ""
echo "Version: v${VERSION}"
echo "This will:"
echo "  1. Tag develop as v${VERSION}-beta"
echo ""
echo "After the maintainer merges develop → main:"
echo "  2. Tag main as v${VERSION}"
echo "  3. Publish GitHub Release"
echo ""
read -p "Continue? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# Tag beta
git tag -a "v${VERSION}-beta" -m "v${VERSION}-beta — pre-release"
git push origin "v${VERSION}-beta"
echo "✅ Tagged v${VERSION}-beta"

# Generate changelog from PRs since last release
LAST_TAG=$(git tag --sort=-creatordate | grep -v beta | head -1)
if [ -z "$LAST_TAG" ]; then
  CHANGELOG=$(git log --oneline origin/main..HEAD)
else
  CHANGELOG=$(git log --oneline "${LAST_TAG}"..HEAD)
fi

echo ""
echo "📋 Changelog since ${LAST_TAG:-beginning}:"
echo "$CHANGELOG"
echo ""
echo "✅ Beta tagged. Create the PR to main, get a maintainer's approval, then after merge run:"
echo "   git tag -a v${VERSION} origin/main -m 'v${VERSION}'"
echo "   git push origin v${VERSION}"
echo "   gh release create v${VERSION} --title 'v${VERSION}' --notes-file CHANGELOG_ENTRY.md"
