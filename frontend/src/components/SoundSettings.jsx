// src/components/SoundSettings.jsx
// Sound & haptic settings — inline toggle with expandable details

import React, { useState, useCallback } from 'react';
import { getSoundSettings, saveSoundSettings } from '../utils/sounds';

const TOGGLE_OPTIONS = [
  { key: 'moveSound',  label: 'Move Sound',  icon: '🔘', desc: 'Click when placing a line' },
  { key: 'scoreSound', label: 'Score Sound', icon: '🎉', desc: 'Box captured celebration' },
  { key: 'turnAlert',  label: 'Turn Alert',  icon: '🔔', desc: 'Your turn notification' },
  { key: 'vibration',  label: 'Vibration',   icon: '📳', desc: 'Haptic feedback on mobile' },
];

const Toggle = ({ checked, onChange, label, disabled = false }) => (
  <button
    onClick={() => { if (!disabled) onChange(); }}
    className="relative rounded-full transition-colors flex items-center cursor-pointer shrink-0"
    style={{
      width: '44px',
      height: '26px',
      backgroundColor: checked ? 'var(--accent)' : 'var(--bg-card-hover)',
      opacity: disabled ? 0.4 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
    }}
    role="switch"
    aria-checked={checked}
    aria-disabled={disabled}
    aria-label={label}
    tabIndex={disabled ? -1 : 0}
    data-testid={`toggle-${label.toLowerCase().replace(/\s+/g, '-')}`}
  >
    <div
      className="rounded-full shadow transition-transform"
      style={{
        width: '20px',
        height: '20px',
        backgroundColor: 'var(--text-primary)',
        transform: checked ? 'translateX(21px)' : 'translateX(3px)',
      }}
    />
  </button>
);

const SoundSettings = () => {
  const [showDetails, setShowDetails] = useState(false);
  const [settings, setSettings] = useState(() => getSoundSettings());

  const update = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSoundSettings(next);
      return next;
    });
  }, []);

  const isMuted = settings.masterMute;

  return (
    <div>
      {/* Master toggle — always visible */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isMuted ? '🔇 Muted' : '🔊 Sounds On'}
          </span>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {isMuted ? 'All sounds are off' : 'Game sounds & haptics enabled'}
          </p>
        </div>
        <Toggle
          checked={!isMuted}
          onChange={() => update('masterMute', !isMuted)}
          label="Master Sound"
        />
      </div>

      {/* Expand details */}
      <button
        onClick={() => setShowDetails((o) => !o)}
        className="w-full mt-3 py-1.5 text-xs font-medium transition-all flex items-center justify-center gap-1"
        style={{ color: 'var(--text-muted)' }}
        data-testid="sound-settings-trigger"
      >
        <span>{showDetails ? 'Hide details' : 'Customize sounds'}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{showDetails ? '▲' : '▼'}</span>
      </button>

      {showDetails && (
        <div className="mt-2 space-y-2">
          {/* Individual toggles */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ opacity: isMuted ? 0.4 : 1, pointerEvents: isMuted ? 'none' : 'auto' }}
          >
            {TOGGLE_OPTIONS.map(({ key, label, icon, desc }) => (
              <div
                key={key}
                className="flex items-center justify-between py-2.5 px-3"
                style={{ borderBottom: '1px solid var(--border-color)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{icon}</span>
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{desc}</div>
                  </div>
                </div>
                <Toggle
                  checked={settings[key]}
                  onChange={() => update(key, !settings[key])}
                  label={label}
                  disabled={isMuted}
                />
              </div>
            ))}
          </div>

          {/* Volume slider */}
          <div
            className="py-2.5 px-3 rounded-xl"
            style={{
              background: 'var(--bg-card-hover)',
              opacity: isMuted ? 0.4 : 1,
              pointerEvents: isMuted ? 'none' : 'auto',
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-base">🔉</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Volume</span>
              </div>
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: 'var(--accent)' }}
                data-testid="volume-display"
              >
                {settings.volume}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={settings.volume}
              onChange={(e) => update('volume', parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--accent) ${settings.volume}%, var(--bg-card) ${settings.volume}%)`,
              }}
              aria-label="Volume"
              data-testid="volume-slider"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default SoundSettings;
