// src/components/RecentPlayers.jsx
// Recent opponents list with one-tap invite — lobby section

import React, { useState, useCallback } from 'react';
import socket from '../socket';
import {
  getRecentOpponents,
  clearRecentOpponents,
  getRecord,
  formatLastPlayed,
} from '../utils/recentOpponents';

/**
 * RecentPlayers — shows last 10 unique opponents with invite functionality.
 * @param {object} props
 * @param {string} props.username   - Current user's username
 * @param {string} props.avatar     - Current user's avatar
 * @param {number} props.gridSize   - Selected grid size for new games
 * @param {number} props.playerCount - Selected player count
 */
const RecentPlayers = ({ username, avatar, gridSize, playerCount }) => {
  const [opponents, setOpponents] = useState(() => getRecentOpponents());
  const [invitingUser, setInvitingUser] = useState(null);
  const [toast, setToast] = useState(null);

  /** Clear all recent opponents. */
  const handleClear = useCallback(() => {
    clearRecentOpponents();
    setOpponents([]);
  }, []);

  /**
   * Invite an opponent — creates a game room and shows the code.
   * @param {string} opponentName
   */
  const handleInvite = useCallback(
    (opponentName) => {
      if (!username?.trim() || invitingUser) return;

      setInvitingUser(opponentName);
      if (!socket.connected) socket.connect();

      socket.emit(
        'create_game',
        {
          gridSize,
          username: username.trim(),
          avatar,
          playerCount,
          cpuPlayers: 0,
          cpuDifficulty: 'medium',
        },
        (res) => {
          setInvitingUser(null);
          if (res?.gameId) {
            setToast(`Room created! Share code: ${res.gameId}`);
            setTimeout(() => setToast(null), 5000);
          } else if (res?.error) {
            setToast(`Error: ${res.error}`);
            setTimeout(() => setToast(null), 3000);
          }
        }
      );
    },
    [username, avatar, gridSize, playerCount, invitingUser]
  );

  if (opponents.length === 0) return null;

  return (
    <div
      className="mt-4 rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <h2
          className="text-sm font-bold uppercase tracking-wider flex items-center gap-2"
          style={{ color: 'var(--label-color)' }}
        >
          <span>👥</span> Recent Players
        </h2>
        <button
          onClick={handleClear}
          className="text-xs px-3 py-1.5 rounded-lg transition-all active:scale-95"
          style={{
            background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
            color: 'var(--danger)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          }}
          aria-label="Clear recent opponents"
        >
          🗑️ Clear
        </button>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className="mx-4 mt-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-center transition-all recent-players-toast"
          style={{
            background: toast.startsWith('Error')
              ? 'color-mix(in srgb, var(--danger) 15%, transparent)'
              : 'color-mix(in srgb, var(--success) 15%, transparent)',
            color: toast.startsWith('Error') ? 'var(--danger)' : 'var(--success)',
            border: `1px solid color-mix(in srgb, ${
              toast.startsWith('Error') ? 'var(--danger)' : 'var(--success)'
            } 30%, transparent)`,
          }}
        >
          {toast}
        </div>
      )}

      {/* Opponents list */}
      <div className="p-3 space-y-2">
        {opponents.map((opp) => (
          <div
            key={opp.username}
            className="flex items-center gap-3 p-3 rounded-xl transition-all recent-player-card"
            style={{
              background: 'var(--bg-card-hover)',
              border: '1px solid var(--border-color)',
            }}
          >
            {/* Avatar */}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
              style={{
                background: 'color-mix(in srgb, var(--accent) 20%, transparent)',
              }}
            >
              {opp.avatar || '👤'}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div
                className="font-semibold text-sm truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {opp.username}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {formatLastPlayed(opp.lastPlayed)}
                </span>
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {getRecord(opp)}
                </span>
              </div>
            </div>

            {/* Invite button */}
            <button
              onClick={() => handleInvite(opp.username)}
              disabled={invitingUser === opp.username || !username?.trim()}
              className="px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex-shrink-0 disabled:opacity-60 invite-btn"
              style={{
                background:
                  invitingUser === opp.username
                    ? 'var(--bg-surface)'
                    : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                color:
                  invitingUser === opp.username
                    ? 'var(--text-muted)'
                    : 'var(--text-on-accent)',
              }}
              aria-label={`Invite ${opp.username}`}
            >
              {invitingUser === opp.username ? '⏳' : '🎮 Invite'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentPlayers;
