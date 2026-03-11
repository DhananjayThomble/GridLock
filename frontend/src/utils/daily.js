// src/utils/daily.js
// Shared utilities for daily challenge components

/** API base URL for daily challenge endpoints */
export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL ||
  ''
).replace(/\/$/, '');

/** Build full API URL from a path */
export const apiUrl = (path) => `${API_BASE}${path}`;

/**
 * Format countdown milliseconds as HH:MM:SS.
 * @param {number} ms - Milliseconds remaining
 * @returns {string}
 */
export const formatCountdown = (ms) => {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

/**
 * Star rating based on score percentage.
 * @param {number} score - Player score
 * @param {number} gridSize - Grid size
 * @returns {number} 1, 2, or 3 stars
 */
export const getStars = (score, gridSize) => {
  const totalBoxes = gridSize * gridSize;
  if (totalBoxes === 0) return 1;
  const pct = score / totalBoxes;
  if (pct > 0.66) return 3;
  if (pct >= 0.33) return 2;
  return 1;
};

/**
 * Format duration in seconds to a human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
export const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};
