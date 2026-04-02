// src/utils/onboarding.js — First-time user detection utilities

import { safeStorage } from './safeStorage';

export const PLAYED_KEY = 'gridlock_has_played';

/**
 * Returns true if this is the user's first visit (no completed game yet).
 */
export const isFirstTime = () => {
  try {
    const value = safeStorage.getItem(PLAYED_KEY);
    return value === null; // only null → first time (empty string is NOT first-time)
  } catch {
    return true; // localStorage unavailable → treat as first time
  }
};

/**
 * Mark the user as having completed their first game.
 * Safe to call multiple times (idempotent).
 */
export const markPlayed = () => {
  try {
    safeStorage.setItem(PLAYED_KEY, 'true');
  } catch {
    // Quota exceeded or private browsing — silently ignore
  }
};
