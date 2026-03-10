// src/utils/postGameUtils.js
// Shared utility functions for post-game stats (extracted from PostGameStatsCard)

/**
 * Format a duration in seconds to a human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
export const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

/**
 * Count total placed lines in a game state.
 * @param {object} state - Game state with horizontalLines and verticalLines
 * @returns {number}
 */
export const countLines = (state) => {
  let total = 0;
  if (state?.horizontalLines) state.horizontalLines.forEach(row => row.forEach(v => { if (v) total++; }));
  if (state?.verticalLines) state.verticalLines.forEach(row => row.forEach(v => { if (v) total++; }));
  return total;
};

/**
 * Calculate ELO change with proper draw support.
 * @param {number} playerElo
 * @param {number} opponentElo
 * @param {'win'|'draw'|'loss'} outcome
 * @returns {number} ELO delta (rounded)
 */
export const calcEloChange = (playerElo, opponentElo, outcome) => {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const actual = outcome === 'win' ? 1.0 : outcome === 'draw' ? 0.5 : 0.0;
  return Math.round(K * (actual - expected));
};
