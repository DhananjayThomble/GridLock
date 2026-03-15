// src/components/BottomNav.jsx
// Fixed bottom tab navigation for mobile — hidden during gameplay

import React from 'react';
import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/',            label: 'Lobby',       icon: '\u{1F3E0}', end: true },
  { to: '/leaderboard', label: 'Board',       icon: '\u{1F3C6}' },
  { to: '/history',     label: 'History',     icon: '\u{1F4DC}' },
  { to: '/how-to-play', label: 'Rules',       icon: '\u2753' },
  { to: '/settings',    label: 'Settings',    icon: '\u2699\uFE0F' },
];

const BottomNav = () => (
  <nav
    className="fixed bottom-0 left-0 right-0 z-50 flex justify-around items-stretch border-t backdrop-blur-xl sm:hidden"
    style={{
      backgroundColor: 'color-mix(in srgb, var(--bg-primary) 85%, transparent)',
      borderColor: 'var(--border-color)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      boxShadow: '0 -1px 4px rgba(0,0,0,0.15)',
    }}
    aria-label="Bottom navigation"
  >
    {tabs.map(({ to, label, icon, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={() =>
          `flex flex-col items-center justify-center flex-1 py-2 text-xs font-semibold transition-colors`
        }
        style={({ isActive }) => ({
          color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
          minHeight: '52px',
          textDecoration: 'none',
        })}
        aria-label={label}
      >
        <span className="text-lg leading-none mb-0.5">{icon}</span>
        <span>{label}</span>
      </NavLink>
    ))}
  </nav>
);

export default BottomNav;
