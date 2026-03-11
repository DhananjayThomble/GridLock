// src/components/RecentOpponents.jsx
// Shows last 10 unique opponents with one-tap invite functionality

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecentOpponents, clearRecentOpponents } from '../utils/recentOpponentsStore';
import socket from '../socket';

/** Format a timestamp as a relative date string */
const formatRelativeDate = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const RecentOpponents = ({ username, avatar, gridSize, playerCount }) => {
  const [opponents, setOpponents] = useState(() => getRecentOpponents());
  const [expanded, setExpanded] = useState(false);
  const [invitingId, setInvitingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Timer IDs stored as refs — they don't affect rendering (#5)
  const toastTimerRef = useRef(null);
  const confirmTimerRef = useRef(null);
  const copiedTimerRef = useRef(null);
  const navigate = useNavigate();

  const refreshOpponents = useCallback(() => {
    setOpponents(getRecentOpponents());
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // #11: Listen for storage events to refresh list when updated from other tabs
  // Also refresh on window focus for same-tab updates
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'gridlock_recent_opponents') {
        refreshOpponents();
      }
    };
    const handleFocus = () => {
      if (expanded) refreshOpponents();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  }, [expanded, refreshOpponents]);

  const handleInvite = (opponentName) => {
    // #6: Guard username before .trim()
    const name = username?.trim() || '';
    if (!name || invitingId) return;

    if (!socket.connected) socket.connect();
    setInvitingId(opponentName);

    // Use callback-based create_game to get the room code without triggering
    // the Lobby's game_created listener navigation
    socket.emit('create_game', {
      gridSize: gridSize || 3,
      username: name,
      avatar: avatar || '👦',
      playerCount: playerCount || 2,
      cpuPlayers: 0,
    }, (res) => {
      setInvitingId(null);

      if (res?.error) {
        return;
      }

      if (res?.gameId) {
        // Show toast with room code
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({
          gameId: res.gameId,
          opponent: opponentName,
          playerId: res.playerId,
          sessionToken: res.sessionToken,
        });
        toastTimerRef.current = setTimeout(() => setToast(null), 8000);
      }
    });

    // TODO: If a user registry/push notification system exists, send an invite
    // notification to the opponent here. Currently no backend user registry
    // exists, so we only create the room and show the code.
  };

  const handleGoToGame = () => {
    if (!toast) return;
    // #6: Guard username before .trim()
    navigate('/game', {
      state: {
        username: username?.trim() || '',
        gridSize: gridSize || 3,
        gameId: toast.gameId,
        role: toast.playerId,
        avatar: avatar || '👦',
        playerCount: playerCount || 2,
        sessionToken: toast.sessionToken,
      },
    });
  };

  // #3: Two-tap confirm pattern for destructive clear action
  const handleClear = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      // Auto-reset after 3 seconds if not confirmed
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmingClear(false), 3000);
      return;
    }
    // Second tap — actually clear
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingClear(false);
    clearRecentOpponents();
    setOpponents([]);
  };

  // #10: Visual feedback for copy
  const handleCopyCode = (code) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  if (opponents.length === 0 && !expanded) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => {
          const next = !expanded;
          if (next) refreshOpponents();
          setExpanded(next);
        }}
        className="w-full py-2 text-xs font-semibold transition-all flex items-center justify-center gap-2"
        style={{ color: 'var(--text-muted)' }}
        aria-expanded={expanded}
        aria-controls="recent-opponents-list"
      >
        <span>⚔️ Recent Opponents ({opponents.length})</span>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div
          id="recent-opponents-list"
          role="list"
          aria-label="Recent opponents"
          className="backdrop-blur-md rounded-2xl p-4 mt-1 space-y-2"
          style={{
            background: 'var(--bg-card-hover)',
            border: '1px solid var(--border-color)',
          }}
        >
          {opponents.length === 0 ? (
            <p
              className="text-center text-xs py-2"
              style={{ color: 'var(--text-subtle)' }}
            >
              No recent opponents yet. Play some games!
            </p>
          ) : (
            <>
              {opponents.map((opp) => (
                <div
                  key={opp.username}
                  role="listitem"
                  className="flex items-center gap-3 rounded-xl p-3 transition-all"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xl"
                    style={{ background: 'var(--bg-card-hover)' }}
                    aria-hidden="true"
                  >
                    {opp.avatar}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-bold truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {opp.username}
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{formatRelativeDate(opp.lastPlayed)}</span>
                      <span style={{ color: 'var(--border-color-strong)' }}>·</span>
                      {/* #9: Always show draws count (0D) for consistent column width */}
                      <span>
                        <span style={{ color: 'var(--success)' }}>{opp.wins}W</span>
                        {' '}
                        <span style={{ color: 'var(--danger)' }}>{opp.losses}L</span>
                        {' '}
                        <span style={{ color: 'var(--warning)' }}>{opp.draws}D</span>
                      </span>
                    </div>
                  </div>

                  {/* Invite button */}
                  <button
                    onClick={() => handleInvite(opp.username)}
                    disabled={!!invitingId}
                    className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    style={{
                      background: invitingId === opp.username
                        ? 'var(--bg-surface)'
                        : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                      color: invitingId === opp.username
                        ? 'var(--text-muted)'
                        : 'var(--text-on-accent)',
                      boxShadow: invitingId === opp.username
                        ? 'none'
                        : '0 2px 8px color-mix(in srgb, var(--accent) 30%, transparent)',
                    }}
                    aria-label={`Invite ${opp.username} to a game`}
                  >
                    {invitingId === opp.username ? (
                      <span
                        className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin"
                        style={{
                          borderColor: 'color-mix(in srgb, currentColor 40%, transparent)',
                          borderTopColor: 'currentColor',
                        }}
                      />
                    ) : (
                      '✉️ Invite'
                    )}
                  </button>
                </div>
              ))}

              {/* #3: Clear history with two-tap confirm */}
              <button
                onClick={handleClear}
                className="w-full text-xs transition-all py-1 mt-1"
                style={{
                  color: confirmingClear ? 'var(--danger)' : 'var(--text-subtle)',
                  fontWeight: confirmingClear ? '600' : 'normal',
                }}
                aria-label={confirmingClear ? 'Confirm clear recent opponents' : 'Clear recent opponents history'}
              >
                {confirmingClear ? 'Are you sure? Tap again to clear' : 'Clear recent opponents'}
              </button>
            </>
          )}

          {/* Toast notification */}
          {/* #8: role="status" + aria-live="polite" — room creation isn't critical enough for assertive alert */}
          {toast && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl p-3 mt-2 space-y-2"
              style={{
                background: 'color-mix(in srgb, var(--success) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--success) 40%, transparent)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--success)' }}>
                    Room created! Share code: {toast.gameId}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Send this code to {toast.opponent}
                  </p>
                </div>
                {/* #10: Visual feedback on copy */}
                <button
                  onClick={() => handleCopyCode(toast.gameId)}
                  className="flex-shrink-0 px-3 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  style={{
                    background: copied ? 'var(--success)' : 'var(--bg-card)',
                    border: `1px solid ${copied ? 'var(--success)' : 'var(--border-color-strong)'}`,
                    color: copied ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  }}
                  aria-label={copied ? 'Copied!' : `Copy room code ${toast.gameId}`}
                >
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <button
                onClick={handleGoToGame}
                className="w-full py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 min-h-[44px]"
                style={{
                  background: 'var(--success)',
                  color: 'var(--text-on-accent)',
                }}
              >
                🎮 Go to Game Room
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecentOpponents;
