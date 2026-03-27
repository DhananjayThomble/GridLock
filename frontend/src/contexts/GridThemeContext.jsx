// src/contexts/GridThemeContext.jsx
// Grid theme context — manages active grid visual theme and unlock state.
// Persists to localStorage. Does NOT affect layout sizing.
/* eslint-disable react-refresh/only-export-components */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { getGridTheme, THEME_IDS, checkUnlockCondition, GRID_THEMES } from '../themes/gridThemes';
import { getStats } from '../utils/sessionStats';

const THEME_KEY = 'gridlock_grid_theme';
const UNLOCKED_KEY = 'gridlock_unlocked_themes';
const DEFAULT_UNLOCKED = ['clean', 'classic'];

const GridThemeContext = createContext(null);

/**
 * Hook to access grid theme state.
 * @returns {{ theme: object, themeId: string, setTheme: (id: string) => void, unlockedThemes: string[], checkAndUnlockThemes: (stats?: object) => string|null }}
 */
export const useGridTheme = () => {
  const ctx = useContext(GridThemeContext);
  if (!ctx) throw new Error('useGridTheme must be used within <GridThemeProvider>');
  return ctx;
};

function loadUnlocked() {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = new Set([...DEFAULT_UNLOCKED, ...parsed]);
      return [...merged];
    }
  } catch { /* ignore */ }
  return [...DEFAULT_UNLOCKED];
}

function loadThemeId() {
  try {
    const id = localStorage.getItem(THEME_KEY);
    if (id && GRID_THEMES[id]) return id;
  } catch { /* ignore */ }
  return 'clean';
}

export const GridThemeProvider = ({ children }) => {
  const [themeId, setThemeId] = useState(loadThemeId);
  const [unlockedThemes, setUnlockedThemes] = useState(() => {
    // On mount, check unlocks against current stats and merge
    const base = loadUnlocked();
    const stats = getStats();
    try {
      stats.tournamentWins = parseInt(localStorage.getItem('gridlock_tournament_wins') || '0', 10);
    } catch { stats.tournamentWins = 0; }
    const updated = [...base];
    for (const id of THEME_IDS) {
      if (!updated.includes(id) && checkUnlockCondition(id, stats)) {
        updated.push(id);
      }
    }
    if (updated.length !== base.length) {
      try { localStorage.setItem(UNLOCKED_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
    }
    return updated;
  });

  const theme = getGridTheme(themeId);

  const setTheme = useCallback((id) => {
    if (!GRID_THEMES[id]) return;
    if (!unlockedThemes.includes(id)) return;
    setThemeId(id);
    try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
  }, [unlockedThemes]);

  // Check and unlock themes based on current stats. Returns newly unlocked theme id or null.
  const checkAndUnlockThemes = useCallback((statsOverride) => {
    const stats = statsOverride || getStats();
    let newlyUnlocked = null;

    setUnlockedThemes((prev) => {
      const updated = [...prev];
      for (const id of THEME_IDS) {
        if (!updated.includes(id) && checkUnlockCondition(id, stats)) {
          updated.push(id);
          newlyUnlocked = id;
        }
      }
      if (updated.length !== prev.length) {
        try { localStorage.setItem(UNLOCKED_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
        return updated;
      }
      return prev;
    });

    return newlyUnlocked;
  }, []);

  return (
    <GridThemeContext.Provider value={{ theme, themeId, setTheme, unlockedThemes, checkAndUnlockThemes }}>
      {children}
    </GridThemeContext.Provider>
  );
};

export default GridThemeProvider;
