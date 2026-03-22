// src/components/lobby/GridSizeSelector.jsx
// Grid size selector — renders as compact pills (mobile) or card grid (desktop).
import React from 'react';

const GRID_OPTIONS = [
  { value: 3, label: '3×3', desc: 'Quick' },
  { value: 4, label: '4×4', desc: 'Standard' },
  { value: 5, label: '5×5', desc: 'Pro' },
  { value: 6, label: '6×6', desc: 'Epic' },
];

const GridSizeSelector = ({ gridSize, onSelect, label, accentColor = 'var(--player4-color)' }) => (
  <div>
    <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 sm:mb-2" style={{ color: 'var(--label-color)' }}>
      {label || (
        <>
          <span className="hidden sm:inline">Grid Size</span>
          <span className="sm:hidden">Grid</span>
        </>
      )}
    </label>
    {/* Mobile: horizontal pill row */}
    <div className="flex gap-1.5 sm:hidden" role="radiogroup" aria-label="Grid size">
      {GRID_OPTIONS.map(({ value, label: optLabel }) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          role="radio"
          aria-checked={gridSize === value}
          className="flex-1 py-1.5 rounded-xl text-center transition-all active:scale-95 text-xs font-bold"
          style={gridSize === value
            ? { background: accentColor, border: `1px solid ${accentColor}`, color: 'var(--text-on-accent)', boxShadow: `0 2px 8px color-mix(in srgb, ${accentColor} 30%, transparent)` }
            : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
        >
          {optLabel}
        </button>
      ))}
    </div>
    {/* Desktop: full card grid */}
    <div className="hidden sm:grid grid-cols-4 gap-2">
      {GRID_OPTIONS.map(({ value, label: optLabel, desc }) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          className="py-2 rounded-xl text-center transition-all active:scale-95 lobby-option-card"
          style={gridSize === value
            ? { background: accentColor, border: `1px solid ${accentColor}`, color: 'var(--text-on-accent)', boxShadow: `0 4px 12px color-mix(in srgb, ${accentColor} 30%, transparent)` }
            : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
        >
          <div className="text-sm font-bold">{optLabel}</div>
          <div className="text-xs">{desc}</div>
        </button>
      ))}
    </div>
  </div>
);

export { GRID_OPTIONS };
export default GridSizeSelector;
