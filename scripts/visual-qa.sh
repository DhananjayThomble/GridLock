#!/bin/bash
# Visual QA: Take screenshots of all production pages at multiple viewports
OUT_DIR=${1:-"/tmp/gridlock-visual-qa"}
mkdir -p "$OUT_DIR"
BASE="https://gridlock.pro"
BETA="https://beta.gridlock.pro"

PAGES=(
  "/"
  "/#/game/create"
  "/#/settings"
  "/#/profile"
  "/#/leaderboard"
  "/#/about"
)

echo "📸 Visual QA — $(date)"
echo "Screenshots: $OUT_DIR"

for url_base in "$BASE" "$BETA"; do
  label=$(echo "$url_base" | grep -q beta && echo "beta" || echo "prod")
  for page in "${PAGES[@]}"; do
    for viewport in "375x667" "768x1024" "1920x1080"; do
      fname="${label}-$(echo $page | tr '/#' '_')-${viewport}.png"
      echo "  📷 $label $page @ $viewport"
      # Use Playwright CLI for screenshots
      npx playwright screenshot --viewport-size="$viewport" "${url_base}${page}" "$OUT_DIR/$fname" 2>/dev/null
    done
  done
done

echo "📸 Done: $(ls "$OUT_DIR"/*.png 2>/dev/null | wc -l) screenshots"
