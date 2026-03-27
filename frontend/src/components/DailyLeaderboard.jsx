// src/components/DailyLeaderboard.jsx
// Mini-leaderboard for the Daily Challenge page (pre-game view)
// Issue #277: shows top 10 players, total player count, and user's own result

import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl, formatDuration } from '../utils/daily';

const DailyLeaderboard = ({ date, username, gridSize, alreadyPlayed }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const totalBoxes = (gridSize || 3) * (gridSize || 3);

  const fetchLeaderboard = useCallback(async () => {
    if (!date) return;
    try {
      setLoading(true);
      setError(false);
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (username) params.set('username', username);
      const res = await fetch(apiUrl(`/api/daily/leaderboard?${params.toString()}`));
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [date, username]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  if (loading) {
    return (
      <div
        className="backdrop-blur-md rounded-2xl overflow-hidden shadow-lg mt-4"
        style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
      >
        <div className="p-5 text-center">
          <div
            className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading leaderboard…</p>
        </div>
      </div>
    );
  }

  if (error || !data) return null;

  const { totalPlayers, leaderboard, userResult } = data;

  return (
    <div
      className="backdrop-blur-md rounded-2xl overflow-hidden shadow-lg mt-4"
      style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
    >
      {/* Header with player count */}
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <h3
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: 'var(--label-color)' }}
        >
          Today&apos;s Leaderboard
        </h3>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {totalPlayers} {totalPlayers === 1 ? 'player' : 'players'} completed today
        </span>
      </div>

      {/* Leaderboard list */}
      <div className="p-4">
        {leaderboard.length === 0 ? (
          <p className="text-center text-sm py-3" style={{ color: 'var(--text-muted)' }}>
            No one has played yet today. Be the first!
          </p>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.map((entry) => {
              const isUser = username && entry.username === username;
              return (
                <div
                  key={entry.username}
                  className="flex items-center justify-between px-3 py-2 rounded-lg transition-colors"
                  style={{
                    background: isUser
                      ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                      : 'var(--bg-card)',
                    border: isUser
                      ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
                      : '1px solid var(--border-color)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-bold w-7 text-right"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {entry.rank <= 3
                        ? ['🥇', '🥈', '🥉'][entry.rank - 1]
                        : `#${entry.rank}`}
                    </span>
                    <span
                      className="text-sm font-semibold"
                      style={{ color: isUser ? 'var(--accent)' : 'var(--text-primary)' }}
                    >
                      {entry.username}
                      {isUser && (
                        <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>
                          (you)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {entry.score}/{totalBoxes} · {entry.moves}m · {formatDuration(entry.duration)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* User's result if not in top 10 */}
        {userResult && !leaderboard.some((e) => e.username === userResult.username) && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <div
              className="flex items-center justify-between px-3 py-2 rounded-lg"
              style={{
                background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-bold w-7 text-right"
                  style={{ color: 'var(--text-muted)' }}
                >
                  #{userResult.rank}
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                  {userResult.username}
                  <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>
                    (you)
                  </span>
                </span>
              </div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {userResult.score}/{totalBoxes} · {userResult.moves}m · {formatDuration(userResult.duration)}
              </div>
            </div>
          </div>
        )}

        {/* CTA for users who haven't played */}
        {!alreadyPlayed && leaderboard.length > 0 && (
          <p
            className="text-center text-xs mt-3 pt-3"
            style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}
          >
            🎯 Play today&apos;s challenge to see how you compare!
          </p>
        )}
      </div>
    </div>
  );
};

export default DailyLeaderboard;
