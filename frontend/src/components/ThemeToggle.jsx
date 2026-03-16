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
        className="relative rounded-full transition-colors flex items-center cursor-pointer shrink-0"
        style={{
          width: '44px',
          height: '26px',
          backgroundColor: isDark ? 'var(--accent)' : 'var(--bg-card-hover)',
        }}
        role="switch"
        aria-checked={isDark}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      >
        <div
          className="rounded-full shadow transition-transform"
          style={{
            width: '20px',
            height: '20px',
            backgroundColor: 'var(--text-primary)',
            transform: isDark ? 'translateX(21px)' : 'translateX(3px)',
          }}
        />
      </button>
    </div>
  );
};

export default ThemeToggle;
