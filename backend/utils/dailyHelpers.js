// utils/dailyHelpers.js
// Shared daily challenge helpers — used by routes/daily.js and socketHandlers.js

const LAUNCH_DATE = '2026-03-01'; // Day 1 of daily challenges
const DEFAULT_GRID_SIZE = 3;

/**
 * Get today's date string in YYYY-MM-DD (UTC).
 */
function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calculate day number from launch date.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {number} Day number (1-indexed)
 */
function getDayNumber(dateStr) {
  const launch = new Date(LAUNCH_DATE + 'T00:00:00Z');
  const target = new Date(dateStr + 'T00:00:00Z');
  const diffMs = target - launch;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic: same seed → same sequence.
 * @param {number} seed
 * @returns {function} Returns float in [0,1)
 */
function seededRng(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a date string to a numeric seed.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {number}
 */
function dateSeed(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Generate a deterministic board layout from a seed.
 * Returns arrays of pre-drawn horizontal and vertical lines.
 * Same seed always produces the same board.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} gridSize
 * @returns {{ predrawnH: number[][], predrawnV: number[][] }}
 */
function generateBoardFromSeed(dateStr, gridSize) {
  const rng = seededRng(dateSeed(dateStr));
  const rows = gridSize;
  const cols = gridSize;

  // Total possible lines
  const totalH = (rows + 1) * cols;
  const totalV = rows * (cols + 1);
  const totalLines = totalH + totalV;

  // Pre-draw ~15-25% of lines to create an interesting starting position
  const predrawnCount = Math.floor(totalLines * (0.15 + rng() * 0.10));

  // Build flat array of all line indices, shuffle, pick first N
  const allIndices = Array.from({ length: totalLines }, (_, i) => i);
  // Fisher-Yates shuffle with seeded RNG
  for (let i = allIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
  }
  const predrawnSet = new Set(allIndices.slice(0, predrawnCount));

  // Map back to grid positions
  const predrawnH = Array(rows + 1)
    .fill(null)
    .map(() => Array(cols).fill(0));
  const predrawnV = Array(rows)
    .fill(null)
    .map(() => Array(cols + 1).fill(0));

  let idx = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (predrawnSet.has(idx)) predrawnH[r][c] = 1;
      idx++;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (predrawnSet.has(idx)) predrawnV[r][c] = 1;
      idx++;
    }
  }

  // Post-process: remove any pre-drawn lines that would complete a box
  // (we want pre-drawn lines to set up the board, not score points)
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sides = [
          predrawnH[r][c],
          predrawnH[r + 1][c],
          predrawnV[r][c],
          predrawnV[r][c + 1],
        ];
        if (sides.every((s) => s === 1)) {
          // Box is complete — remove a random side
          const sideIdx = Math.floor(rng() * 4);
          if (sideIdx === 0) predrawnH[r][c] = 0;
          else if (sideIdx === 1) predrawnH[r + 1][c] = 0;
          else if (sideIdx === 2) predrawnV[r][c] = 0;
          else predrawnV[r][c + 1] = 0;
          changed = true;
        }
      }
    }
  }

  return { predrawnH, predrawnV };
}

module.exports = {
  LAUNCH_DATE,
  DEFAULT_GRID_SIZE,
  getTodayDateStr,
  getDayNumber,
  seededRng,
  dateSeed,
  generateBoardFromSeed,
};
