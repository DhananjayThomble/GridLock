import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="flex items-center justify-between w-full">
      <div>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {isDark ? '🌙 Dark Mode' : '☀️ Light Mode'}
        </span>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Tap to switch to {isDark ? 'light' : 'dark'} theme
        </p>
      </div>
      <button
        onClick={toggleTheme}
        className="relative flex items-center cursor-pointer shrink-0"
        style={{
          width: '51px',
          height: '31px',
          borderRadius: '999px',
          backgroundColor: isDark ? 'var(--accent)' : 'var(--text-muted)',
          transition: 'background-color 200ms ease',
        }}
        role="switch"
        aria-checked={isDark}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      >
        <div
          style={{
            width: '27px',
            height: '27px',
            borderRadius: '50%',
            backgroundColor: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            transform: isDark ? 'translateX(22px)' : 'translateX(2px)',
            transition: 'transform 200ms ease',
          }}
        />
      </button>
    </div>
  );
};

export default ThemeToggle;
