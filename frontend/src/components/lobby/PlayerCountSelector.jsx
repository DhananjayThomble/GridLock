// src/components/lobby/PlayerCountSelector.jsx
// Player count selector — renders as compact pills (mobile) or card grid (desktop).
import React from 'react';

const PLAYER_COUNT_OPTIONS = [
  { value: 2, label: '2 Players', icon: '👥', desc: 'Classic duel' },
  { value: 3, label: '3 Players', icon: '👨\u200D👩\u200D👦', desc: 'Triple threat' },
  { value: 4, label: '4 Players', icon: '👨\u200D👩\u200D👧\u200D👦', desc: 'Party mode' },
];

const PlayerCountSelector = ({ playerCount, onSelect }) => (
  <div>
    <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 sm:mb-2" style={{ color: 'var(--label-color)' }}>
      <span className="hidden sm:inline">Number of Players</span>
      <span className="sm:hidden">Players</span>
    </label>
    {/* Mobile: horizontal pill row */}
    <div className="flex gap-1.5 sm:hidden" role="radiogroup" aria-label="Number of players">
      {PLAYER_COUNT_OPTIONS.map(({ value }) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          role="radio"
          aria-checked={playerCount === value}
          className="flex-1 py-1.5 rounded-xl text-center transition-all active:scale-95 text-xs font-bold"
          style={playerCount === value
            ? { background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--text-on-accent)', boxShadow: '0 2px 8px color-mix(in srgb, var(--accent) 30%, transparent)' }
            : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
        >
          {value}P
        </button>
      ))}
    </div>
    {/* Desktop: full card grid */}
    <div className="hidden sm:grid grid-cols-3 gap-2">
      {PLAYER_COUNT_OPTIONS.map(({ value, label, icon, desc }) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          className="py-2.5 px-2 rounded-xl text-center transition-all active:scale-95 lobby-option-card"
          style={playerCount === value
            ? { background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent)' }
            : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
        >
          <div className="text-lg">{icon}</div>
          <div className="text-xs font-bold">{label}</div>
          <div className="text-xs">{desc}</div>
        </button>
      ))}
    </div>
  </div>
);

export { PLAYER_COUNT_OPTIONS };
export default PlayerCountSelector;
