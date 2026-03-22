// src/components/lobby/GameModeButtons.jsx
// Action buttons for secondary game modes (Daily, Ranked, Join, Tournament).
// Renders as compact chip row (mobile) or full-size button rows (desktop).
import React from 'react';

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
        <button
          onClick={onNavigateDaily}
          disabled={creating || !trimmedUsername}
          className="flex-1 min-w-[70px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1"
          style={{
            background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
            color: 'var(--warning)',
          }}
        >
          🎯 Daily
        </button>
        <button
          onClick={onRankedPlay}
          disabled={rankedPlaying || creating || quickPlaying || !trimmedUsername}
          className="flex-1 min-w-[70px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1"
          style={{
            background: rankedPlaying ? 'var(--bg-surface)' : 'color-mix(in srgb, var(--danger) 12%, transparent)',
            border: `1px solid ${rankedPlaying ? 'var(--border-color-strong)' : 'color-mix(in srgb, var(--danger) 30%, transparent)'}`,
            color: rankedPlaying ? 'var(--text-muted)' : 'var(--danger)',
          }}
        >
          {rankedPlaying ? '⏳…' : '⚔️ Ranked'}
        </button>
        <button
          onClick={() => onSetTab(tab === 'join' ? '' : 'join')}
          aria-pressed={tab === 'join'}
          className="flex-1 min-w-[60px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 flex items-center justify-center gap-1"
          style={{
            background: tab === 'join' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'var(--bg-card)',
            border: `1px solid ${tab === 'join' ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'var(--border-color-strong)'}`,
            color: tab === 'join' ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          🔗 Join
        </button>
        <button
          onClick={() => onSetTab(tab === 'tournament' ? '' : 'tournament')}
          aria-pressed={tab === 'tournament'}
          className="flex-1 min-w-[70px] py-2 rounded-xl font-semibold text-xs transition-all active:scale-95 flex items-center justify-center gap-1"
          style={{
            background: tab === 'tournament' ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : 'var(--bg-card)',
            border: `1px solid ${tab === 'tournament' ? 'color-mix(in srgb, var(--warning) 40%, transparent)' : 'var(--border-color-strong)'}`,
            color: tab === 'tournament' ? 'var(--warning)' : 'var(--text-secondary)',
          }}
        >
          🏆 Tourney
        </button>
      </div>

      {/* Desktop: full-size Daily + Ranked row */}
      <div className="hidden sm:flex px-5 py-3 gap-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <button
          onClick={onNavigateDaily}
          disabled={creating || !trimmedUsername}
          className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5"
          style={{
            background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
            color: 'var(--warning)',
          }}
        >
          🎯 Daily Challenge
        </button>
        <button
          onClick={onRankedPlay}
          disabled={rankedPlaying || creating || quickPlaying || !trimmedUsername}
          className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-60 flex flex-col items-center justify-center gap-0.5"
          style={{
            minHeight: '44px',
            background: rankedPlaying ? 'var(--bg-surface)' : 'color-mix(in srgb, var(--danger) 15%, transparent)',
            border: `1px solid ${rankedPlaying ? 'var(--border-color-strong)' : 'color-mix(in srgb, var(--danger) 40%, transparent)'}`,
            color: rankedPlaying ? 'var(--text-muted)' : 'var(--danger)',
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

      {/* Desktop: Join / Tournament tabs */}
      <div className="hidden sm:flex" style={{ borderBottom: '1px solid var(--border-color)' }}>
        {[
          { key: 'join',   label: '🔗 Join Game' },
          { key: 'tournament', label: '🏆 Tournament' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onSetTab(tab === key ? '' : key)}
            className={`flex-1 py-3 text-sm font-semibold transition-all lobby-tab ${
              tab === key ? 'border-b-2' : ''
            }`}
            style={{
              color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: tab === key ? 'var(--bg-card)' : 'transparent',
              borderColor: tab === key ? 'var(--accent)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
};

export default GameModeButtons;
