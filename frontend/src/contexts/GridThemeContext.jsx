// Grid theme selection persists locally and does not affect board sizing.
/* eslint-disable react-refresh/only-export-components */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { getGridTheme, GRID_THEMES } from '../themes/gridThemes';
import { safeStorage } from '../utils/safeStorage';

const THEME_KEY = 'gridlock_grid_theme';
const GridThemeContext = createContext(null);

export const useGridTheme = () => {
  const ctx = useContext(GridThemeContext);
  if (!ctx) throw new Error('useGridTheme must be used within <GridThemeProvider>');
  return ctx;
};

function loadThemeId() {
  const id = safeStorage.getItem(THEME_KEY);
  return Object.hasOwn(GRID_THEMES, id) ? id : 'clean';
}

export const GridThemeProvider = ({ children }) => {
  const [themeId, setThemeId] = useState(loadThemeId);

  const setTheme = useCallback((id) => {
    if (!Object.hasOwn(GRID_THEMES, id)) return;
    setThemeId(id);
    safeStorage.setItem(THEME_KEY, id);
  }, []);

  return (
    <GridThemeContext.Provider value={{ theme: getGridTheme(themeId), themeId, setTheme }}>
      {children}
    </GridThemeContext.Provider>
  );
};

export default GridThemeProvider;
