// src/components/BottomNav.jsx
// Mobile bottom tab bar (#261, #506) — shown only on ≤768px via CSS

import React from 'react';
import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/',            label: 'Lobby',       icon: '🏠', end: true },
  { to: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { to: '/how-to-play', label: 'Rules',       icon: '📖' },
  { to: '/history',     label: 'History',     icon: '📜' },
  { to: '/settings',    label: 'Settings',    icon: '⚙️' },
];

const BottomNav = () => (
  <nav className="bottom-nav" aria-label="Mobile navigation">
    {tabs.map(({ to, label, icon, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={({ isActive }) => `bottom-nav-link ${isActive ? 'active' : ''}`}
      >
        <span className="bottom-nav-icon">{icon}</span>
        <span className="bottom-nav-label">{label}</span>
      </NavLink>
    ))}
  </nav>
);

export default BottomNav;
