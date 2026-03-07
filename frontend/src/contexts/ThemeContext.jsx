import React, { createContext, useContext, useState, useLayoutEffect, useCallback } from 'react';

const ThemeContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('gridlock_theme') || 'dark';
  });

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gridlock_theme', theme);
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
