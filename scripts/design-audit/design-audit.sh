#!/bin/bash
set -e

echo "🎨 GridLock Design Audit System"
echo "================================"

# Resolve project root (script lives in scripts/design-audit/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

AUDIT_DIR="$PROJECT_ROOT/frontend/tests/design-audit"
REPORTS_DIR="$AUDIT_DIR/reports"
mkdir -p "$REPORTS_DIR"

cd "$PROJECT_ROOT"

# Layer 1: Capture screenshots + accessibility
echo ""
echo "📸 Layer 1: Capturing screenshots..."
cd frontend && npx playwright test tests/design-audit/capture.spec.js --reporter=list
cd "$PROJECT_ROOT"

# Layer 2: Gemini agentic vision (if API key available)
echo ""
if [ -n "$GEMINI_API_KEY" ]; then
  echo "🔬 Layer 2: Gemini pixel analysis..."
  node scripts/design-audit/gemini-analyze.js
else
  echo "⚠️  Layer 2 skipped: GEMINI_API_KEY not set"
fi

# Layer 3: Opus strategic review
echo ""
echo "🧠 Layer 3: Opus UX review..."
node scripts/design-audit/opus-review.js

# Layer 4: Regression check (optional, run with --regression flag)
if [ "$1" = "--regression" ]; then
  echo ""
  echo "📊 Layer 4: Visual regression..."
  cd frontend && npx playwright test tests/design-audit/regression.spec.js --reporter=list --update-snapshots
  cd "$PROJECT_ROOT"
fi

echo ""
echo "✅ Audit complete! Reports in $REPORTS_DIR/"
echo "   - accessibility.json (axe-core)"
echo "   - gemini-analysis.json (pixel analysis)"
echo "   - ux-review.json (strategic review)"
