// src/utils/recentOpponents.js
// Manages recent opponents list in localStorage — no backend needed.

const STORAGE_KEY = 'gridlock_recent_opponents';
const MAX_OPPONENTS = 10;

/**
 * @typedef {object} RecentOpponent
 * @property {string} username       - Opponent's display name
 * @property {string} avatar         - Opponent's avatar emoji
 * @property {number} lastPlayed     - Timestamp of last game played
 * @property {number} wins           - Number of wins against this opponent
 * @property {number} losses         - Number of losses against this opponent
 * @property {number} draws          - Number of draws against this opponent
 */

/**
 * Get the list of recent opponents from localStorage.
 * @returns {RecentOpponent[]}
 */
export const getRecentOpponents = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Save recent opponents list to localStorage.
 * @param {RecentOpponent[]} opponents
 */
const saveRecentOpponents = (opponents) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opponents));
  } catch {
    // localStorage unavailable — silently fail
  }
};

/**
 * Record an opponent after a game ends.
 * Updates existing entry or creates new one. Enforces MAX_OPPONENTS limit.
 * @param {object} params
 * @param {string} params.username  - Opponent's username
 * @param {string} params.avatar    - Opponent's avatar emoji
 * @param {'win'|'loss'|'draw'} params.outcome - Game outcome from YOUR perspective
 * @returns {RecentOpponent[]} Updated list
 */
export const recordOpponent = ({ username, avatar, outcome }) => {
  if (!username) return getRecentOpponents();

  const opponents = getRecentOpponents();
  const existingIndex = opponents.findIndex(
    (o) => o.username.toLowerCase() === username.toLowerCase()
  );

  if (existingIndex !== -1) {
    // Update existing opponent
    const existing = opponents[existingIndex];
    existing.avatar = avatar || existing.avatar;
    existing.lastPlayed = Date.now();
    if (outcome === 'win') existing.wins = (existing.wins || 0) + 1;
    else if (outcome === 'loss') existing.losses = (existing.losses || 0) + 1;
    else if (outcome === 'draw') existing.draws = (existing.draws || 0) + 1;

    // Move to front (most recent)
    opponents.splice(existingIndex, 1);
    opponents.unshift(existing);
  } else {
    // Add new opponent at front
    opponents.unshift({
      username,
      avatar: avatar || '👤',
      lastPlayed: Date.now(),
      wins: outcome === 'win' ? 1 : 0,
      losses: outcome === 'loss' ? 1 : 0,
      draws: outcome === 'draw' ? 1 : 0,
    });
  }

  // Enforce max limit — remove oldest
  const trimmed = opponents.slice(0, MAX_OPPONENTS);
  saveRecentOpponents(trimmed);
  return trimmed;
};

/**
 * Clear all recent opponents.
 */
export const clearRecentOpponents = () => {
  saveRecentOpponents([]);
};

/**
 * Get the win/loss/draw record string against an opponent.
 * @param {RecentOpponent} opponent
 * @returns {string} e.g. "3W 1L 0D"
 */
export const getRecord = (opponent) => {
  const w = opponent.wins || 0;
  const l = opponent.losses || 0;
  const d = opponent.draws || 0;
  return `${w}W ${l}L ${d}D`;
};

/**
 * Format the last played date for display.
 * @param {number} timestamp
 * @returns {string}
 */
export const formatLastPlayed = (timestamp) => {
  if (!timestamp) return 'Never';
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(timestamp));
};
