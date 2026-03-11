// src/components/RankBadge.jsx
// Displays a tier badge with icon and name for ranked mode
import React from 'react';

const TIER_COLORS = {
  Bronze:   '#CD7F32',
  Silver:   'var(--text-secondary)',
  Gold:     '#FFD700',
  Platinum: 'var(--accent)',
  Diamond:  'var(--accent-hover)',
};

/**
 * Compact rank tier badge component.
 * @param {{ tier: string, tierIcon: string, elo?: number, size?: 'sm'|'md'|'lg', showElo?: boolean }} props
 */
const RankBadge = ({ tier, tierIcon, elo, size = 'md', showElo = false }) => {
  if (!tier) return null;

  const color = TIER_COLORS[tier] || 'var(--text-secondary)';

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5 gap-1',
    md: 'text-sm px-2 py-1 gap-1.5',
    lg: 'text-base px-3 py-1.5 gap-2',
  };

  return (
    <span
      className={`inline-flex items-center rounded-lg font-bold ${sizeClasses[size] || sizeClasses.md}`}
      style={{
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        color,
      }}
      title={`${tier} — ELO ${elo || '?'}`}
    >
      <span aria-hidden="true">{tierIcon}</span>
      <span>{tier}</span>
      {showElo && elo != null && (
        <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>
          {elo}
        </span>
      )}
    </span>
  );
};

export default RankBadge;
