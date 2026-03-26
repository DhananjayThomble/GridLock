// src/components/lobby/GameModeButtons.jsx
// Action buttons for secondary game modes (Daily, Ranked, Join, Tournament).
// 3-tier hierarchy: Primary (Quick Play — in Lobby), Secondary (Daily/Ranked/Create/Tournament), Tertiary (Join).
// Renders as compact chip row (mobile) or full-size button rows (desktop).
import React from 'react';

/* ── Shared style helpers (CSS-variable based, works in dark + light) ─────── */

/** Secondary: muted accent tint — consistent across same-level actions */
const secondaryStyle = (active = false) => ({
  background: active
    ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
    : 'color-mix(in srgb, var(--accent) 10%, transparent)',
  border: `1px solid color-mix(in srgb, var(--accent) ${active ? '45%' : '25%'}, transparent)`,
  color: 'var(--accent)',
});

/** Tertiary: minimal outline — for utility actions like Join */
const tertiaryStyle = (active = false) => ({
  background: active ? 'color-mix(in srgb, var(--text-secondary) 8%, transparent)' : 'transparent',
  border: `1px solid ${active ? 'color-mix(in srgb, var(--text-secondary) 30%, transparent)' : 'var(--border-color-strong)'}`,
  color: 'var(--text-secondary)',
});

const GameModeButtons = ({
  // State
  tab, creating, quickPlaying, rankedPlaying, username,
  rankedProfile,
  // Callbacks
  onNavigateDaily, onRankedPlay, onSetTab,
}) => {
  const trimmedUsername = username.trim();

  return (
    <>
      {/* ── Secondary actions — compact chip row on mobile ── */}
      <div className="px-3 py-2 flex flex-wrap gap-1.5 sm:hidden" style={{ borderBottom: '1px solid var(--border-color)' }}>
        {/* Daily — SECONDARY */}
        <button
          onClick={onNavigateDaily}
          disabled={creating || !trimmedUsername}
          className="flex-1 min-w-[70px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1"
          style={secondaryStyle()}
        >
          🎯 Daily
        </button>
        {/* Ranked — SECONDARY */}
        <button
          onClick={onRankedPlay}
          disabled={rankedPlaying || creating || quickPlaying || !trimmedUsername}
          className="flex-1 min-w-[70px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1"
          style={rankedPlaying
            ? { background: 'var(--bg-surface)', border: '1px solid var(--border-color-strong)', color: 'var(--text-muted)' }
            : secondaryStyle()
          }
        >
          {rankedPlaying ? '⏳…' : '⚔️ Ranked'}
        </button>
        {/* Tournament — SECONDARY */}
        <button
          onClick={() => onSetTab(tab === 'tournament' ? '' : 'tournament')}
          aria-pressed={tab === 'tournament'}
          className="flex-1 min-w-[70px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 flex items-center justify-center gap-1"
          style={secondaryStyle(tab === 'tournament')}
        >
          🏆 Tourney
        </button>
        {/* Join — TERTIARY */}
        <button
          onClick={() => onSetTab(tab === 'join' ? '' : 'join')}
          aria-pressed={tab === 'join'}
          className="flex-1 min-w-[60px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 flex items-center justify-center gap-1"
          style={tertiaryStyle(tab === 'join')}
        >
          🔗 Join
        </button>
      </div>

      {/* Desktop: full-size Daily + Ranked row — SECONDARY */}
      <div className="hidden sm:flex px-5 py-3 gap-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <button
          onClick={onNavigateDaily}
          disabled={creating || !trimmedUsername}
          className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5"
          style={secondaryStyle()}
        >
          🎯 Daily Challenge
        </button>
        <button
          onClick={onRankedPlay}
          disabled={rankedPlaying || creating || quickPlaying || !trimmedUsername}
          className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-60 flex flex-col items-center justify-center gap-0.5"
          style={{
            minHeight: '44px',
            ...(rankedPlaying
              ? { background: 'var(--bg-surface)', border: '1px solid var(--border-color-strong)', color: 'var(--text-muted)' }
              : secondaryStyle()
            ),
          }}
        >
          <span>{rankedPlaying ? '⏳ Searching…' : '⚔️ Ranked'}</span>
          {rankedProfile && !rankedPlaying && (
            <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>
              {rankedProfile.tierIcon} {rankedProfile.elo} ELO · {rankedProfile.wins}W · {rankedProfile.losses}L · {rankedProfile.draws || 0}D
            </span>
          )}
        </button>
      </div>

      {/* Desktop: Join (TERTIARY) / Tournament (SECONDARY) tabs */}
      <div className="hidden sm:flex" style={{ borderBottom: '1px solid var(--border-color)' }}>
        {[
          { key: 'join',       label: '🔗 Join Game',   tier: 'tertiary' },
          { key: 'tournament', label: '🏆 Tournament',  tier: 'secondary' },
        ].map(({ key, label, tier }) => {
          const isActive = tab === key;
          const baseStyle = tier === 'tertiary' ? tertiaryStyle(isActive) : secondaryStyle(isActive);
          return (
            <button
              key={key}
              onClick={() => onSetTab(tab === key ? '' : key)}
              className={`flex-1 py-3 text-sm font-semibold transition-all lobby-tab ${
                isActive ? 'border-b-2' : ''
              }`}
              style={{
                color: baseStyle.color,
                background: isActive ? baseStyle.background : 'transparent',
                borderColor: isActive ? 'var(--accent)' : 'transparent',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
};

export default GameModeButtons;
