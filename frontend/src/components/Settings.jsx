// src/components/Settings.jsx
// Polished iOS-style settings page with grouped sections

import React, { useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { getSoundSettings, saveSoundSettings } from '../utils/sounds';
import { subscribeToPush, unsubscribeFromPush } from '../utils/pushManager';
import { getStats, getWinRate, getAvgTerritory, resetStats } from '../utils/sessionStats';
import socket from '../socket';

/* ─── Reusable Toggle Switch ─── */
const ToggleSwitch = ({ checked, onChange, disabled = false, label }) => (
  <button
    onClick={() => !disabled && onChange()}
    className="settings-toggle"
    role="switch"
    aria-checked={checked}
    aria-disabled={disabled}
    aria-label={label}
    tabIndex={disabled ? -1 : 0}
    style={{
      width: '44px',
      height: '24px',
      borderRadius: '12px',
      backgroundColor: checked ? 'var(--accent)' : 'var(--text-subtle)',
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      position: 'relative',
      border: 'none',
      padding: 0,
      flexShrink: 0,
      transition: 'background-color 200ms ease',
    }}
  >
    <div
      style={{
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        backgroundColor: '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        position: 'absolute',
        top: '3px',
        left: checked ? '23px' : '3px',
        transition: 'left 200ms ease',
      }}
    />
  </button>
);

/* ─── Settings Row ─── */
const SettingsRow = ({ icon, label, subtitle, right, onClick, showDivider = true, expandable = false, expanded = false }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      padding: '12px 16px',
      minHeight: '48px',
      cursor: onClick ? 'pointer' : 'default',
      borderBottom: showDivider ? '1px solid var(--border-color)' : 'none',
      transition: 'background-color 150ms ease',
      gap: '12px',
    }}
  >
    <span style={{ fontSize: '18px', width: '24px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: '20px' }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '16px', marginTop: '1px' }}>{subtitle}</div>
      )}
    </div>
    {right}
    {expandable && (
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px', transition: 'transform 200ms', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
    )}
  </div>
);

/* ─── Section Header ─── */
const SectionHeader = ({ title }) => (
  <div style={{ padding: '24px 16px 8px', fontSize: '12px', fontWeight: 600, letterSpacing: '0.8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
    {title}
  </div>
);

/* ─── Section Card ─── */
const SectionCard = ({ children }) => (
  <div
    style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
);

/* ─── Sound Detail Rows (expandable) ─── */
const SOUND_OPTIONS = [
  { key: 'moveSound', label: 'Move Sound', icon: '🔘', desc: 'Click when placing a line' },
  { key: 'scoreSound', label: 'Score Sound', icon: '🎉', desc: 'Box captured celebration' },
  { key: 'turnAlert', label: 'Turn Alert', icon: '🔔', desc: 'Your turn notification' },
  { key: 'vibration', label: 'Vibration', icon: '📳', desc: 'Haptic feedback on mobile' },
];

const SoundDetails = ({ settings, onUpdate, muted }) => (
  <div
    style={{
      borderTop: '1px solid var(--border-color)',
      backgroundColor: 'color-mix(in srgb, var(--bg-card-hover) 50%, transparent)',
      opacity: muted ? 0.4 : 1,
      pointerEvents: muted ? 'none' : 'auto',
    }}
  >
    {SOUND_OPTIONS.map(({ key, label, icon, desc }, i) => (
      <div
        key={key}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px 10px 52px',
          minHeight: '44px',
          gap: '12px',
          borderBottom: i < SOUND_OPTIONS.length - 1 ? '1px solid var(--border-color)' : 'none',
        }}
      >
        <span style={{ fontSize: '16px', width: '20px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{desc}</div>
        </div>
        <ToggleSwitch
          checked={settings[key]}
          onChange={() => onUpdate(key, !settings[key])}
          label={label}
          disabled={muted}
        />
      </div>
    ))}

    {/* Volume slider */}
    <div style={{ padding: '10px 16px 14px 52px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px', width: '20px', textAlign: 'center' }}>🔉</span>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>Volume</span>
        </div>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
          {settings.volume}%
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={settings.volume}
        onChange={(e) => onUpdate('volume', parseInt(e.target.value, 10))}
        className="settings-volume-slider"
        style={{
          width: '100%',
          height: '4px',
          borderRadius: '2px',
          appearance: 'none',
          WebkitAppearance: 'none',
          cursor: 'pointer',
          background: `linear-gradient(to right, var(--accent) ${settings.volume}%, var(--bg-surface) ${settings.volume}%)`,
        }}
        aria-label="Volume"
        data-testid="volume-slider"
      />
    </div>
  </div>
);

/* ─── Stats Panel ─── */
const StatsPanel = ({ stats, onReset }) => (
  <div style={{ borderTop: '1px solid var(--border-color)', padding: '12px 16px' }}>
    {stats.gamesPlayed === 0 ? (
      <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', padding: '8px 0' }}>
        No games played yet this session.
      </p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          {[
            { label: 'Games', value: stats.gamesPlayed },
            { label: 'Wins', value: stats.wins },
            { label: 'Win Rate', value: getWinRate() },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                textAlign: 'center',
                padding: '10px 4px',
                borderRadius: '10px',
                background: 'var(--bg-card-hover)',
              }}
            >
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          {[
            { label: 'Avg Territory', value: getAvgTerritory() },
            { label: 'Best Territory', value: `${stats.bestTerritory}%` },
            { label: 'Best Streak', value: `${stats.bestStreak} 🔥` },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                textAlign: 'center',
                padding: '10px 4px',
                borderRadius: '10px',
                background: 'var(--bg-card-hover)',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{value}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>

        {stats.currentStreak > 0 && (
          <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 700, color: 'var(--warning)' }}>
            🔥 {stats.currentStreak} game win streak!
          </div>
        )}

        {stats.history.length > 0 && (
          <div>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Last {Math.min(stats.history.length, 5)} Games
            </p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {stats.history.slice(0, 5).map((g, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    ...(g.outcome === 'win'
                      ? { backgroundColor: 'color-mix(in srgb, var(--success) 25%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)' }
                      : g.outcome === 'draw'
                      ? { backgroundColor: 'color-mix(in srgb, var(--warning) 25%, transparent)', color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }
                      : { backgroundColor: 'color-mix(in srgb, var(--danger) 25%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }),
                  }}
                  title={`${g.gridSize}×${g.gridSize} · ${g.players}P`}
                >
                  {g.outcome === 'win' ? 'W' : g.outcome === 'draw' ? 'D' : 'L'} {g.territoryPct}%
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => { if (window.confirm('Reset all session stats? This cannot be undone.')) { onReset(); } }}
          style={{
            width: '100%',
            padding: '6px',
            fontSize: '12px',
            color: 'var(--danger)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            opacity: 0.8,
          }}
        >
          Reset Stats
        </button>
      </div>
    )}
  </div>
);

/* ─── Main Settings Component ─── */
const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const [pushEnabled, setPushEnabled] = useState(() => localStorage.getItem('gridlock_push') === 'true');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showSoundDetails, setShowSoundDetails] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(getStats);
  const [soundSettings, setSoundSettings] = useState(() => getSoundSettings());

  // PWA install prompt
  React.useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handlePushToggle = async () => {
    if (!pushEnabled) {
      const username = localStorage.getItem('gridlock_username') || '';
      if (!username.trim()) return;
      try {
        const sub = await subscribeToPush(username.trim(), socket.id);
        if (sub) { setPushEnabled(true); localStorage.setItem('gridlock_push', 'true'); }
      } catch { /* push subscribe failed */ }
    } else {
      try { await unsubscribeFromPush(); } catch { /* ignore */ }
      setPushEnabled(false);
      localStorage.removeItem('gridlock_push');
    }
  };

  const updateSound = useCallback((key, value) => {
    setSoundSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSoundSettings(next);
      return next;
    });
  }, []);

  const isMuted = soundSettings.masterMute;
  const hasUsername = !!localStorage.getItem('gridlock_username');

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))',
        paddingBottom: '80px',
      }}
    >
      <div style={{ maxWidth: '512px', margin: '0 auto', padding: '0 16px' }}>
        {/* Page Header */}
        <div style={{ textAlign: 'center', padding: '32px 0 8px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Settings
          </h1>
        </div>

        {/* ─── PREFERENCES ─── */}
        <SectionHeader title="Preferences" />
        <SectionCard>
          <SettingsRow
            icon={isDark ? '🌙' : '☀️'}
            label={isDark ? 'Dark Mode' : 'Light Mode'}
            subtitle={`Tap to switch to ${isDark ? 'light' : 'dark'} theme`}
            right={<ToggleSwitch checked={isDark} onChange={toggleTheme} label="Theme toggle" />}
          />
          <SettingsRow
            icon={isMuted ? '🔇' : '🔊'}
            label={isMuted ? 'Sounds Off' : 'Sounds On'}
            subtitle={isMuted ? 'All sounds are off' : 'Game sounds & haptics'}
            right={<ToggleSwitch checked={!isMuted} onChange={() => updateSound('masterMute', !isMuted)} label="Master Sound" />}
            onClick={() => setShowSoundDetails((o) => !o)}
            expandable
            expanded={showSoundDetails}
            showDivider={!showSoundDetails}
          />
          {showSoundDetails && (
            <SoundDetails settings={soundSettings} onUpdate={updateSound} muted={isMuted} />
          )}
          <SettingsRow
            icon="🔔"
            label="Push Notifications"
            subtitle={hasUsername ? "Get notified when it's your turn" : 'Set a username in the lobby first'}
            right={<ToggleSwitch checked={pushEnabled} onChange={handlePushToggle} disabled={!hasUsername} label="Push notifications" />}
            showDivider={false}
          />
        </SectionCard>

        {/* ─── APP ─── */}
        {installPrompt && (
          <>
            <SectionHeader title="App" />
            <SectionCard>
              <SettingsRow
                icon="📲"
                label="Install App"
                subtitle="Add GridLock to your home screen"
                right={
                  <button
                    onClick={handleInstall}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: 'var(--accent)',
                      color: 'var(--text-on-accent)',
                      border: 'none',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'opacity 150ms',
                    }}
                  >
                    Install
                  </button>
                }
                showDivider={false}
              />
            </SectionCard>
          </>
        )}

        {/* ─── ACCOUNT ─── */}
        <SectionHeader title="Account" />
        <SectionCard>
          <SettingsRow
            icon="📊"
            label="Your Stats"
            subtitle={stats.gamesPlayed > 0 ? `${stats.gamesPlayed} games · ${getWinRate()} win rate` : 'No games played yet'}
            onClick={() => {
              const next = !showStats;
              if (next) setStats(getStats());
              setShowStats(next);
            }}
            expandable
            expanded={showStats}
            showDivider={false}
          />
          {showStats && <StatsPanel stats={stats} onReset={() => { resetStats(); setStats(getStats()); }} />}
        </SectionCard>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '24px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
          GridLock — Territory Strategy Game
        </div>
      </div>
    </div>
  );
};

export default Settings;
