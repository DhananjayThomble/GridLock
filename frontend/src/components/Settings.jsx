// src/components/Settings.jsx
// Standalone settings page — extracted from Lobby footer

import React, { useState } from 'react';
import ThemeToggle from './ThemeToggle';
import SoundSettings from './SoundSettings';
import { subscribeToPush, unsubscribeFromPush } from '../utils/pushManager';
import { getStats, getWinRate, getAvgTerritory, resetStats } from '../utils/sessionStats';
import socket from '../socket';

const Settings = () => {
  const [pushEnabled, setPushEnabled] = useState(() => localStorage.getItem('gridlock_push') === 'true');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(getStats());

  // PWA install prompt
  React.useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;

    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
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

  return (
    <div
      className="min-h-screen p-3 pt-6 sm:p-4 sm:pt-8"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-lg mx-auto space-y-4">

        {/* Page Title */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-primary)' }}>
            ⚙️ Settings
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Customize your experience
          </p>
        </div>

        {/* Theme */}
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <ThemeToggle />
        </div>

        {/* Sound & Haptic */}
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <SoundSettings />
        </div>

        {/* Push Notifications */}
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>🔔 Push Notifications</span>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {localStorage.getItem('gridlock_username')
                  ? 'Get notified when it\'s your turn'
                  : 'Set a username in the lobby first'}
              </p>
            </div>
            <button
              onClick={handlePushToggle}
              disabled={!localStorage.getItem('gridlock_username')}
              className="relative w-10 h-5 rounded-full transition-colors flex items-center px-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: pushEnabled ? 'var(--warning)' : 'var(--bg-card-hover)' }}
              aria-label="Toggle push notifications"
            >
              <div
                className={`w-4 h-4 rounded-full shadow transition-transform ${pushEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                style={{ backgroundColor: 'var(--text-primary)' }}
              />
            </button>
          </div>
        </div>

        {/* Install App */}
        {installPrompt && (
          <div
            className="rounded-2xl p-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
          >
            <button
              onClick={handleInstall}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
            >
              📲 Install App
            </button>
            <p className="text-xs text-center mt-1.5" style={{ color: 'var(--text-muted)' }}>Add GridLock to your home screen</p>
          </div>
        )}

        {/* Stats */}
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <button
            onClick={() => {
              const next = !showStats;
              if (next) setStats(getStats());
              setShowStats(next);
            }}
            className="w-full py-2 text-xs font-semibold transition-all flex items-center justify-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span>📊 Your Stats</span>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{showStats ? '▲' : '▼'}</span>
          </button>

          {showStats && (
            <div className="mt-3 space-y-3">
              {stats.gamesPlayed === 0 ? (
                <p className="text-center text-xs py-2" style={{ color: 'var(--text-subtle)' }}>No games played yet this session.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Games', value: stats.gamesPlayed },
                      { label: 'Wins', value: stats.wins },
                      { label: 'Win Rate', value: getWinRate() },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl py-2" style={{ background: 'var(--bg-card-hover)' }}>
                        <div className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{value}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Avg Territory', value: getAvgTerritory() },
                      { label: 'Best Territory', value: `${stats.bestTerritory}%` },
                      { label: 'Best Streak', value: `${stats.bestStreak} 🔥` },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl py-2" style={{ background: 'var(--bg-card-hover)' }}>
                        <div className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{value}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {stats.currentStreak > 0 && (
                    <div className="text-center text-sm font-bold" style={{ color: 'var(--warning)' }}>
                      🔥 {stats.currentStreak} game win streak!
                    </div>
                  )}

                  {stats.history.length > 0 && (
                    <div>
                      <p className="text-xs mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Last {Math.min(stats.history.length, 5)} Games</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {stats.history.slice(0, 5).map((g, i) => (
                          <div
                            key={i}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold"
                            style={
                              g.outcome === 'win'
                                ? { backgroundColor: 'color-mix(in srgb, var(--success) 25%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)' }
                                : g.outcome === 'draw'
                                ? { backgroundColor: 'color-mix(in srgb, var(--warning) 25%, transparent)', color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }
                                : { backgroundColor: 'color-mix(in srgb, var(--danger) 25%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }
                            }
                            title={`${g.gridSize}×${g.gridSize} · ${g.players}P`}
                          >
                            {g.outcome === 'win' ? 'W' : g.outcome === 'draw' ? 'D' : 'L'} {g.territoryPct}%
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => { if (window.confirm('Reset all session stats? This cannot be undone.')) { resetStats(); setStats(getStats()); } }}
                    className="w-full text-xs transition-all py-1"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    Reset stats
                  </button>
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default Settings;
