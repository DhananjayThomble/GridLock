// src/hooks/useGridSizes.js
// Shared responsive grid sizing hook — single source of truth for Board + ReplayPage.
// Uses window dimensions directly to avoid chicken-and-egg timing issues with
// container refs (the ref's layout depends on the grid, which depends on the
// ref measurement — causing the board to render tiny on first mount).

import { useState, useEffect } from 'react';

export default function useGridSizes(gridSize) {
  const [sizes, setSizes] = useState({ dot: 8, visualDot: 8, line: 48, box: 48, lineThickness: 8, gridTotal: 0 });

  useEffect(() => {
    function calculate() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cells = gridSize || 3;

      // Phone in landscape: the board sits left of a ~240px info column (see index.css),
      // so it is height-limited by little more than the fixed ScoreBar and some padding.
      const landscapePhone = h <= 500 && w > h;
      // Horizontal: full width minus small padding (8px each side on mobile)
      const reservedW = landscapePhone ? 280 : w < 640 ? 24 : w < 768 ? 48 : 64;
      // Vertical: everything around the board (ScoreBar, header, score cards, toolbar, padding).
      // Measured at 344-351px for 2-4 players from tablets to 1080p desktops (322px on phones), so
      // reserving less than that pushed the Leave button below the fold and made the game scroll.
      const reservedH = landscapePhone ? 96 : w < 640 ? 320 : 356;

      const availW = w - reservedW;
      const availH = h - reservedH;

      // Dot size is proportional to box: dot ≈ max(minDot, box * 0.22)
      // Grid width = (cells+1) * dot + cells * box
      // With dot = dotRatio * box: grid = box * ((cells+1)*dotRatio + cells)
      // So: box = avail / ((cells+1)*dotRatio + cells)
      // #419: Enforce minimum 44px touch target for dots on narrow viewports
      // (Apple HIG 44×44, Material 48×48dp). Larger grids on small screens
      // need bigger minimum dots to remain tappable.
      const needsLargerDot = w <= 400 && cells >= 5;
      const minDot = needsLargerDot ? 14 : w < 640 ? 10 : 8;
      const dotRatio = 0.22;

      // First pass: estimate box assuming dot = dotRatio * box
      const effectiveUnits = (cells + 1) * dotRatio + cells;
      const fromW = availW / effectiveUnits;
      const fromH = availH / effectiveUnits;
      let box = Math.floor(Math.min(fromW, fromH));

      // Cap: min 24px, max 180px
      box = Math.max(24, Math.min(box, 180));

      // Compute visual dot size (original small size, 10-14px)
      const visualDot = Math.max(minDot, Math.round(box * dotRatio));

      // Layout dot: grid-size-aware minimum touch target
      // 3×3: keep 24px for comfortable spacing
      // 4×4+: reduce to 16px — lines are the primary tap target, not dots
      const minTouchTarget = cells <= 3 ? 24 : 16;
      let dot = Math.max(visualDot, minTouchTarget);

      // Second pass: if dot minimum kicked in, recalculate box to fit
      // Grid width = (cells+1)*dot + cells*box ≤ availW
      if (dot > box * dotRatio) {
        const maxBoxFromW = Math.floor((availW - (cells + 1) * dot) / cells);
        const maxBoxFromH = Math.floor((availH - (cells + 1) * dot) / cells);
        box = Math.min(box, maxBoxFromW, maxBoxFromH);
        box = Math.max(24, box); // maintain minimum
      }

      // Safety clamp: verify total grid dimensions actually fit the viewport
      const totalGridW = (cells + 1) * dot + cells * box;
      const totalGridH = (cells + 1) * dot + cells * box;
      if (totalGridH > availH || totalGridW > availW) {
        const scale = Math.min(availW / totalGridW, availH / totalGridH);
        box = Math.max(24, Math.floor(box * scale));
      }

      // Line thickness: proportional to box size, minimum 8px
      const lineThickness = Math.max(8, Math.round(box * 0.12));

      // Total grid dimension: (cells+1) dots + cells boxes — identical in both axes → square
      const gridTotal = (cells + 1) * dot + cells * box;

      setSizes({ dot, visualDot, line: box, box, lineThickness, gridTotal });
    }

    calculate();
    window.addEventListener('resize', calculate);
    return () => window.removeEventListener('resize', calculate);
  }, [gridSize]);

  return sizes;
}
