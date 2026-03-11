// src/hooks/useRecentOpponents.js
// Manages recent opponents list in localStorage — last 10 unique players

const STORAGE_KEY = 'gridlock_recent_opponents';
const MAX_OPPONENTS = 10;

/**
 * Opponent entry shape:
 * {
 *   username: string,
 *   avatar: string,
 *   lastPlayed: number (timestamp),
 *   wins: number (games you won against them),
 *   losses: number (games you lost to them),
 *   draws: number,
 * }
 */

/** Safely read opponents from localStorage */
export const getRecentOpponents = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

/** Safely persist opponents to localStorage */
const saveOpponents = (opponents) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opponents));
  } catch {
    // quota exceeded / private browsing — silently fail
  }
};

/**
 * Record an opponent after a game ends.
 * @param {string} opponentName - Opponent's username
 * @param {string} opponentAvatar - Opponent's avatar emoji
 * @param {'win'|'loss'|'draw'} outcome - Your outcome against this opponent
 */
export const recordOpponent = (opponentName, opponentAvatar, outcome) => {
  if (!opponentName) return;

  const opponents = getRecentOpponents();
  const existingIdx = opponents.findIndex(
    (o) => o.username.toLowerCase() === opponentName.toLowerCase()
  );

  let entry;
  if (existingIdx >= 0) {
    entry = opponents.splice(existingIdx, 1)[0];
    // Update avatar in case it changed
    entry.avatar = opponentAvatar || entry.avatar;
  } else {
    entry = {
      username: opponentName,
      avatar: opponentAvatar || '👤',
      wins: 0,
      losses: 0,
      draws: 0,
    };
  }

  entry.lastPlayed = Date.now();
  if (outcome === 'win') entry.wins += 1;
  else if (outcome === 'loss') entry.losses += 1;
  else if (outcome === 'draw') entry.draws += 1;

  // Prepend to front (most recent first), cap at MAX_OPPONENTS
  opponents.unshift(entry);
  saveOpponents(opponents.slice(0, MAX_OPPONENTS));
};

/** Clear all recent opponents */
export const clearRecentOpponents = () => {
  saveOpponents([]);
};
