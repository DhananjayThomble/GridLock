// src/components/SoundSettings.jsx
// Expandable sound & haptic settings panel for the lobby

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
    onClick={() => { if (disabled) return; onChange(); }}
    className="relative w-10 h-5 rounded-full transition-colors flex items-center px-0.5 cursor-pointer min-h-[44px] min-w-[44px]"
    style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--bg-card-hover)' }}
    role="switch"
    aria-checked={checked}
    aria-disabled={disabled}
    aria-label={label}
    tabIndex={disabled ? -1 : 0}
    data-testid={`toggle-${label.toLowerCase().replace(/\s+/g, '-')}`}
  >
    <div
      className={`w-4 h-4 rounded-full shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
      style={{ backgroundColor: 'var(--text-primary)' }}
    />
  </button>
);

const SoundSettings = () => {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(() => getSoundSettings());

  const update = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSoundSettings(next);
      return next;
    });
  }, []);

  return (
    <div className="mt-3">
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full py-2 text-xs font-semibold transition-all flex items-center justify-center gap-2"
        style={{ color: 'var(--text-muted)' }}
        data-testid="sound-settings-trigger"
      >
        <span>⚙️ Sound &amp; Haptic</span>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="backdrop-blur-md rounded-2xl p-4 mt-1 space-y-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
          data-testid="sound-settings-panel"
        >
          {/* Master Mute */}
          <div
            className="flex items-center justify-between py-2 px-3 rounded-xl"
            style={{ background: settings.masterMute ? 'rgba(239,68,68,0.15)' : 'var(--bg-card-hover)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{settings.masterMute ? '🔇' : '🔊'}</span>
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Master Mute</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Override all sounds</div>
              </div>
            </div>
            <Toggle
              checked={!settings.masterMute}
              onChange={() => update('masterMute', !settings.masterMute)}
              label="Master Mute"
            />
          </div>

          {/* Individual toggles */}
          <div
            className="space-y-1 rounded-xl overflow-hidden"
            style={{ opacity: settings.masterMute ? 0.4 : 1, pointerEvents: settings.masterMute ? 'none' : 'auto' }}
          >
            {TOGGLE_OPTIONS.map(({ key, label, icon, desc }) => (
              <div
                key={key}
                className="flex items-center justify-between py-2 px-3"
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
                  disabled={settings.masterMute}
                />
              </div>
            ))}
          </div>

          {/* Volume slider */}
          <div
            className="py-2 px-3 rounded-xl"
            style={{
              background: 'var(--bg-card-hover)',
              opacity: settings.masterMute ? 0.4 : 1,
              pointerEvents: settings.masterMute ? 'none' : 'auto',
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
