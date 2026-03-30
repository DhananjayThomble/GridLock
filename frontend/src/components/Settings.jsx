// src/components/Settings.jsx
// Polished iOS-style settings page with grouped sections

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { getSoundSettings, saveSoundSettings } from '../utils/sounds';
import { subscribeToPush, unsubscribeFromPush } from '../utils/pushManager';
import { getStats, getWinRate, getAvgTerritory, resetStats } from '../utils/sessionStats';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useGridTheme } from '../contexts/GridThemeContext';
import { GRID_THEMES, THEME_IDS, UNLOCK_CONDITIONS } from '../themes/gridThemes';
import axios from 'axios';
import socket from '../socket';
import { API_BASE as AUTH_API_BASE } from '../config';

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
      width: '48px',
      height: '28px',
      borderRadius: '14px',
      backgroundColor: checked ? 'var(--accent)' : 'var(--text-muted)',
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      position: 'relative',
      border: 'none',
      padding: 0,
      flexShrink: 0,
      transition: 'background-color 200ms ease',
      minWidth: '48px',
      minHeight: '28px',
    }}
  >
    <div
      style={{
        width: '22px',
        height: '22px',
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
      padding: '14px 16px',
      minHeight: '52px',
      cursor: onClick ? 'pointer' : 'default',
      borderBottom: showDivider ? '1px solid var(--border-color)' : 'none',
      transition: 'background-color 150ms ease',
      gap: '12px',
    }}
  >
    <span style={{ fontSize: '18px', width: '24px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: '20px' }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '16px', marginTop: '2px', wordBreak: 'break-word' }}>{subtitle}</div>
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
          padding: '10px 16px 10px 44px',
          minHeight: '48px',
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
    <div style={{ padding: '10px 16px 14px 44px' }}>
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
            padding: '10px 6px',
            fontSize: '13px',
            color: 'var(--danger)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            opacity: 0.8,
            minHeight: '44px',
          }}
        >
          Reset Stats
        </button>
      </div>
    )}
  </div>
);

/* ─── Grid Theme Picker ─── */
const ThemePreview = ({ theme, isActive, isLocked, unlockLabel, onClick }) => (
  <button
    onClick={onClick}
    disabled={isLocked}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      padding: '12px 8px',
      borderRadius: '12px',
      border: isActive ? '2px solid var(--accent)' : '2px solid var(--border-color)',
      backgroundColor: isActive ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-card))' : 'var(--bg-card)',
      cursor: isLocked ? 'not-allowed' : 'pointer',
      opacity: isLocked ? 0.6 : 1,
      transition: 'all 200ms ease',
      position: 'relative',
      width: '100%',
      minHeight: '100px',
    }}
  >
    {/* Mini board preview */}
    <div
      style={{
        width: '48px',
        height: '48px',
        borderRadius: '8px',
        backgroundColor: theme.boardBg || 'var(--bg-tertiary)',
        border: theme.boardBorder || '1px solid var(--border-color)',
        display: 'grid',
        gridTemplateColumns: `${Math.min(theme.visualDotSize, 6)}px 1fr ${Math.min(theme.visualDotSize, 6)}px`,
        gridTemplateRows: `${Math.min(theme.visualDotSize, 6)}px 1fr ${Math.min(theme.visualDotSize, 6)}px`,
        gap: '1px',
        padding: '4px',
        alignItems: 'center',
        justifyItems: 'center',
      }}
    >
      <div style={{ width: Math.min(theme.visualDotSize, 6), height: Math.min(theme.visualDotSize, 6), borderRadius: '50%', backgroundColor: theme.dotColor, ...theme.dotStyle }} />
      <div style={{ width: '100%', height: Math.min(theme.lineThickness, 3), backgroundColor: theme.players.p1.lineColor, ...theme.lineStyle }} />
      <div style={{ width: Math.min(theme.visualDotSize, 6), height: Math.min(theme.visualDotSize, 6), borderRadius: '50%', backgroundColor: theme.dotColor, ...theme.dotStyle }} />
      <div style={{ height: '100%', width: Math.min(theme.lineThickness, 3), backgroundColor: theme.players.p2.lineColor, ...theme.lineStyle }} />
      <div style={{ width: '100%', height: '100%', borderRadius: '2px', backgroundColor: theme.players.p1.boxBg }} />
      <div style={{ height: '100%', width: Math.min(theme.lineThickness, 3), backgroundColor: theme.emptyLineColor, ...theme.lineStyle }} />
      <div style={{ width: Math.min(theme.visualDotSize, 6), height: Math.min(theme.visualDotSize, 6), borderRadius: '50%', backgroundColor: theme.dotColor, ...theme.dotStyle }} />
      <div style={{ width: '100%', height: Math.min(theme.lineThickness, 3), backgroundColor: theme.emptyLineColor, ...theme.lineStyle }} />
      <div style={{ width: Math.min(theme.visualDotSize, 6), height: Math.min(theme.visualDotSize, 6), borderRadius: '50%', backgroundColor: theme.dotColor, ...theme.dotStyle }} />
    </div>

    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>
      {isLocked && '🔒 '}{theme.name}
    </div>
    <div style={{ fontSize: '10px', color: isActive ? 'var(--accent)' : 'var(--text-muted)', textAlign: 'center' }}>
      {isActive ? '✓ Active' : isLocked ? unlockLabel : 'Tap to apply'}
    </div>
  </button>
);

/* ─── Main Settings Component ─── */
const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, login, logout } = useAuth();
  const isDark = theme === 'dark';

  const [pushEnabled, setPushEnabled] = useState(() => localStorage.getItem('gridlock_push') === 'true');
  const { canInstall, install: handleInstall } = usePwaInstall();
  const { themeId: activeGridTheme, setTheme: setGridTheme, unlockedThemes } = useGridTheme();
  const [showSoundDetails, setShowSoundDetails] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(getStats);
  const [soundSettings, setSoundSettings] = useState(() => getSoundSettings());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteButtonRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const confirmButtonRef = useRef(null);

  // Focus trap: focus cancel button when modal opens
  useEffect(() => {
    if (showDeleteConfirm && cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }
  }, [showDeleteConfirm]);

  // Escape key to close modal + Tab focus trap
  useEffect(() => {
    if (!showDeleteConfirm) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setShowDeleteConfirm(false);
        deleteButtonRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = [cancelButtonRef.current, confirmButtonRef.current].filter(Boolean);
        if (focusable.length < 2) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showDeleteConfirm]);


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

        {/* ─── GRID THEME ─── */}
        <SectionHeader title="Grid Theme" />
        <SectionCard>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Customize how the game board looks. Unlock new themes by playing!
            </div>
            <div className="settings-theme-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {THEME_IDS.map((id) => {
                const theme = GRID_THEMES[id];
                const isActive = id === activeGridTheme;
                const isLocked = !unlockedThemes.includes(id);
                const condition = UNLOCK_CONDITIONS[id];
                return (
                  <ThemePreview
                    key={id}
                    theme={theme}
                    isActive={isActive}
                    isLocked={isLocked}
                    unlockLabel={condition?.label || ''}
                    onClick={() => !isLocked && setGridTheme(id)}
                  />
                );
              })}
            </div>
          </div>
        </SectionCard>

        {/* ─── APP ─── */}
        {canInstall && (
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
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: 'var(--accent)',
                      color: 'var(--text-on-accent)',
                      border: 'none',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'opacity 150ms',
                      minHeight: '44px',
                      minWidth: '44px',
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

        {/* ─── ACCOUNT (Auth) ─── */}
        <SectionHeader title="Account" />
        <SectionCard>
          {!user ? (
            /* Guest view */
            <SettingsRow
              icon="🔑"
              label="Sign in with Google"
              subtitle="Save your stats across devices"
              right={
                <button
                  onClick={login}
                  data-testid="auth-sign-in-button"
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    background: 'var(--accent)',
                    color: 'var(--text-on-accent)',
                    border: 'none',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'opacity 150ms',
                    minHeight: '44px',
                    minWidth: '44px',
                  }}
                >
                  Sign In
                </button>
              }
              showDivider={false}
            />
          ) : (
            /* Authenticated view */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.username}
                    referrerPolicy="no-referrer"
                    style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--accent)', color: 'var(--text-on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
                    {user.username?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{user.username}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{user.email}</div>
                </div>
              </div>
              <SettingsRow
                icon="🚪"
                label="Sign Out"
                subtitle="You'll still be able to play as a guest"
                right={
                  <button
                    onClick={logout}
                    data-testid="auth-sign-out-button"
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: 'var(--bg-card-hover)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      minHeight: '44px',
                      minWidth: '44px',
                    }}
                  >
                    Sign Out
                  </button>
                }
              />
              <SettingsRow
                icon="🗑️"
                label="Delete Account"
                subtitle="Permanently remove your account and data"
                right={
                  <button
                    onClick={() => { setDeleteError(''); setShowDeleteConfirm(true); }}
                    ref={deleteButtonRef}
                    data-testid="auth-delete-button"
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: 'none',
                      color: 'var(--danger)',
                      border: '1px solid var(--danger)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      minHeight: '44px',
                      minWidth: '44px',
                    }}
                  >
                    Delete
                  </button>
                }
                showDivider={false}
              />
            </>
          )}
        </SectionCard>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div
            data-testid="delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
            style={{
              position: 'fixed', inset: 0, zIndex: 2000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'var(--overlay-bg)', padding: '16px',
            }}
            onClick={() => { setShowDeleteConfirm(false); deleteButtonRef.current?.focus(); }}
          >
            <div
              style={{
                maxWidth: '360px', width: '100%', padding: '24px',
                backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: '16px', textAlign: 'center',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="delete-modal-title" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                Delete Account?
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
                This will permanently delete your account and disassociate all your game data. This cannot be undone.
              </p>
              {deleteError && (
                <p style={{ fontSize: '13px', color: 'var(--danger)', margin: '0 0 12px', textAlign: 'left' }} role="alert" data-testid="delete-error">
                  {deleteError}
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  ref={cancelButtonRef}
                  onClick={() => { setShowDeleteConfirm(false); deleteButtonRef.current?.focus(); }}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                    backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)', cursor: 'pointer', minHeight: '44px',
                  }}
                >
                  Cancel
                </button>
                <button
                  ref={confirmButtonRef}
                  onClick={async () => {
                    setDeleting(true);
                    setDeleteError('');
                    try {
                      await axios.delete(`${AUTH_API_BASE}/api/auth/account`);
                      setDeleting(false);
                      setShowDeleteConfirm(false);
                      logout();
                    } catch (err) {
                      setDeleteError(err.response?.data?.error || 'Failed to delete account. Please try again.');
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  data-testid="delete-confirm-button"
                  style={{
                    flex: 1, padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                    backgroundColor: 'var(--danger)', color: 'var(--text-on-accent)',
                    border: 'none', cursor: deleting ? 'not-allowed' : 'pointer',
                    opacity: deleting ? 0.5 : 1, minHeight: '44px',
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── SESSION STATS ─── */}
        <SectionHeader title="Session Stats" />
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
