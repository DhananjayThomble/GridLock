// src/components/DailyResult.jsx
// Results page after completing daily challenge — score, rank, percentile, share, leaderboard

import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL ||
  ''
).replace(/\/$/, '');

const apiUrl = (path) => `${API_BASE}${path}`;

/** Countdown timer formatting */
const formatCountdown = (ms) => {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

/** Star rating based on score percentage */
const getStars = (score, gridSize) => {
  const totalBoxes = gridSize * gridSize;
  if (totalBoxes === 0) return 1;
  const pct = score / totalBoxes;
  if (pct > 0.66) return 3;
  if (pct >= 0.33) return 2;
  return 1;
};

const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const DailyResult = ({ result, challenge, streak, countdown: initialCountdown, onBack }) => {
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [userPosition, setUserPosition] = useState(null);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(initialCountdown || 0);

  const gridSize = challenge?.gridSize || 3;
  const totalBoxes = gridSize * gridSize;
  const stars = getStars(result.score, gridSize);
  const dayNumber = result.dayNumber || challenge?.dayNumber || '?';
  const starStr = '⭐'.repeat(stars);

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async () => {
    const date = result.date || challenge?.date;
    if (!date) return;
    const username = result.username;
    try {
      setLeaderboardLoading(true);
      const res = await fetch(
        apiUrl(`/api/daily/leaderboard/${date}?limit=100${username ? `&username=${encodeURIComponent(username)}` : ''}`)
      );
      const data = await res.json();
      if (data.success) {
        setLeaderboard(data.leaderboard || []);
        setUserPosition(data.userPosition || null);
      }
    } catch {
      // Non-critical
    } finally {
      setLeaderboardLoading(false);
    }
  }, [result, challenge]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  // Share result
  const handleShare = async () => {
    const text = `GridLock Daily #${dayNumber}: ${result.score}/${totalBoxes} boxes in ${result.moves} moves ${starStr}\n\ngridlock.snapurl.in`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }

      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      // Fallback handled by clipboard
    }
  };

  const percentile = userPosition?.percentile ?? result.percentile ?? null;
  const rank = userPosition?.rank ?? result.rank ?? null;

  return (
    <div
      className="min-h-screen flex items-start justify-center p-3 pt-6 sm:p-4 sm:pt-8 sm:items-center safe-bottom"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 bg-clip-text text-transparent leading-tight">
            Daily #{dayNumber}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--label-color)' }}>
            Challenge Complete!
          </p>
        </div>

        {/* Result Card */}
        <div
          className="backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >
          {/* Stars */}
          <div className="p-5 text-center" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <div className="text-5xl mb-2">{starStr}</div>
            <div className="text-3xl font-extrabold" style={{ color: 'var(--text-primary)' }}>
              {result.score}/{totalBoxes} Boxes
            </div>
            <div className="text-lg mt-1" style={{ color: 'var(--text-secondary)' }}>
              in {result.moves} moves · {formatDuration(result.duration)}
            </div>
          </div>

          {/* Rank & Percentile */}
          {(rank || percentile !== null) && (
            <div className="px-5 py-3 flex items-center justify-center gap-6" style={{ borderBottom: '1px solid var(--border-color)' }}>
              {rank && (
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>
                    #{rank}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Rank</div>
                </div>
              )}
              {percentile !== null && (
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
                    Top {100 - percentile > 0 ? 100 - percentile : 1}%
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Percentile</div>
                </div>
              )}
            </div>
          )}

          {/* Streak */}
          {streak && streak.totalPlayed > 0 && (
            <div className="px-5 py-3 flex items-center justify-center gap-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: 'var(--warning)' }}>
                  🔥 {streak.current}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Streak</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {streak.best}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Best</div>
              </div>
              {streak.badges && streak.badges.length > 0 && (
                <div className="flex gap-1">
                  {streak.badges.map((b) => (
                    <span key={b.name} className="text-lg" title={b.label}>{b.name}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Share button */}
          <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={handleShare}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: copied
                  ? 'var(--success)'
                  : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                color: 'var(--text-on-accent)',
              }}
            >
              {copied ? '✅ Copied!' : '📤 Share Result'}
            </button>
          </div>

          {/* Leaderboard Preview */}
          <div className="p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--label-color)' }}>
              Today&apos;s Leaderboard
            </h3>
            {leaderboardLoading ? (
              <div className="text-center py-4">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              </div>
            ) : leaderboard.length === 0 ? (
              <p className="text-center text-sm py-2" style={{ color: 'var(--text-muted)' }}>No results yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {leaderboard.slice(0, 20).map((entry) => (
                  <div
                    key={entry.username}
                    className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{
                      background: entry.username === result.username
                        ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                        : 'var(--bg-card)',
                      border: entry.username === result.username
                        ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
                        : '1px solid var(--border-color)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold w-6 text-right" style={{ color: 'var(--text-muted)' }}>
                        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {entry.username}
                      </span>
                    </div>
                    <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {entry.score}/{totalBoxes} · {entry.moves}m
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Countdown to next */}
          <div className="px-5 pb-5 text-center">
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--label-color)' }}>
              Next Challenge In
            </div>
            <div className="text-2xl font-mono font-bold" style={{ color: 'var(--accent)' }}>
              {formatCountdown(countdown)}
            </div>
          </div>
        </div>

        {/* Back button */}
        <div className="text-center mt-4">
          <button
            onClick={onBack}
            className="text-sm font-semibold transition-all"
            style={{ color: 'var(--text-secondary)' }}
          >
            ← Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
};

export default DailyResult;
