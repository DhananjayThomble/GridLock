import React, { createContext, useContext, useState, useLayoutEffect, useCallback } from 'react';
import { safeStorage } from '../utils/safeStorage';

const ThemeContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    const stored = safeStorage.getItem('gridlock_theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    safeStorage.setItem('gridlock_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    document.documentElement.setAttribute('data-theme-transitioning', '');
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
    setTimeout(() => {
      document.documentElement.removeAttribute('data-theme-transitioning');
    }, 400);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
