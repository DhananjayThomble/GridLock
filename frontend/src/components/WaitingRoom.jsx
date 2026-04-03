// src/components/WaitingRoom.jsx
// Real-time waiting room — shows player slots, share link, admin controls

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import socket from '../socket';

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy', icon: '😊' },
  { value: 'medium', label: 'Medium', icon: '🧐' },
  { value: 'hard', label: 'Hard', icon: '🧠' },
];

const WaitingRoom = () => {
  const { gameId: paramGameId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};

  const gameId = (state.gameId || paramGameId || '').toUpperCase();
  const username = state.username || '';
  const sessionToken = state.sessionToken || '';
  const isHost = state.isHost || false;
  const gridSize = state.gridSize || 3;
  const playerCount = state.playerCount || 2;
  const avatar = state.avatar || '👦';

  const [slots, setSlots] = useState([]);
  const [filled, setFilled] = useState(0);
  const [cpuDifficulty, setCpuDifficulty] = useState(state.cpuDifficulty || 'medium');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [starting, setStarting] = useState(false);
  const [roomFull, setRoomFull] = useState(false);
  const [autoStartAt, setAutoStartAt] = useState(null);
  const [autoStartCountdown, setAutoStartCountdown] = useState(null);
  const [disconnectTimers, setDisconnectTimers] = useState({});
  const [sessionConflictMessage, setSessionConflictMessage] = useState(null);
  const [showQR, setShowQR] = useState(false);

  // Prevent double-navigate
  const navigatedRef = useRef(false);
  const conflictRedirectRef = useRef(null);

  const shareUrl = `https://gridlock.pro/join/${gameId}`;

  // Request lobby state on mount
  useEffect(() => {
    if (!gameId) { navigate('/', { replace: true }); return; }
    if (!socket.connected) socket.connect();
    socket.emit('lobby_state', { gameId });
  }, [gameId, navigate]);

  // Socket event listeners
  useEffect(() => {
    const onLobbyState = (data) => {
      if (data.gameId !== gameId) return;
      setSlots(data.slots || []);
      setFilled(data.filled || 0);
      if (data.cpuDifficulty) setCpuDifficulty(data.cpuDifficulty);
      // Fix #2: Derive roomFull from lobby_state — clear when room becomes not-full
      const isFull = data.filled === (data.playerCount || playerCount);
      const hasCPUs = (data.slots || []).some((s) => s.isCPU && s.username);
      if (isFull && !hasCPUs) {
        setRoomFull(true);
      } else {
        setRoomFull(false);
        setAutoStartAt(null);
        setAutoStartCountdown(null);
      }
    };

    const onPlayerJoined = (data) => {
      if (data.gameId !== gameId) return;
      setFilled(data.filled || 0);
      socket.emit('lobby_state', { gameId });
    };

    const onPlayerDisconnected = () => {
      socket.emit('lobby_state', { gameId });
    };

    const onPlayerReconnected = () => {
      socket.emit('lobby_state', { gameId });
    };

    const onGameStarted = (data) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      navigate('/game', {
        state: {
          username,
          gameId: data.gameId || gameId,
          role: data.playerId || 'player1',
          avatar,
          playerCount: data.playerCount || playerCount,
          gridSize: data.gridSize || gridSize,
          sessionToken: data.sessionToken || sessionToken,
          cpuDifficulty: data.cpuDifficulty || cpuDifficulty,
        },
      });
    };

    const onAllPlayersJoined = (data) => {
      if (data.gameId !== gameId) return;
      socket.emit('lobby_state', { gameId });
    };

    const onRoomFull = (data) => {
      if (data.gameId !== gameId) return;
      setRoomFull(true);
      if (data.autoStartAt) setAutoStartAt(data.autoStartAt);
      socket.emit('lobby_state', { gameId });
    };

    const onSessionConflict = () => {
      socket.io.opts.reconnection = false;
      socket.disconnect();
      setSessionConflictMessage('This game is open in another tab. Redirecting to lobby…');
      conflictRedirectRef.current = setTimeout(() => navigate('/'), 3000);
    };

    socket.on('lobby_state', onLobbyState);
    socket.on('player_joined', onPlayerJoined);
    socket.on('player_disconnected', onPlayerDisconnected);
    socket.on('player_reconnected', onPlayerReconnected);
    socket.on('game_started', onGameStarted);
    socket.on('all_players_joined', onAllPlayersJoined);
    socket.on('room_full', onRoomFull);
    socket.on('session_conflict', onSessionConflict);

    return () => {
      socket.off('lobby_state', onLobbyState);
      socket.off('player_joined', onPlayerJoined);
      socket.off('player_disconnected', onPlayerDisconnected);
      socket.off('player_reconnected', onPlayerReconnected);
      socket.off('game_started', onGameStarted);
      socket.off('all_players_joined', onAllPlayersJoined);
      socket.off('room_full', onRoomFull);
      socket.off('session_conflict', onSessionConflict);

      // Fix #6: Leave the waiting room on unmount if we didn't navigate to game
      if (!navigatedRef.current) {
        socket.emit('leave_waiting_room', { gameId });
      }
      if (conflictRedirectRef.current) clearTimeout(conflictRedirectRef.current);
    };
  }, [gameId, navigate, username, avatar, playerCount, gridSize, sessionToken, cpuDifficulty]);

  // Disconnect countdown timers
  // Fix #10: Uses client clock vs server disconnectedAt — countdown may drift
  // if client clock is skewed. Server enforces the actual timeout independently.
  useEffect(() => {
    const interval = setInterval(() => {
      setDisconnectTimers((prev) => {
        const next = {};
        let changed = false;
        slots.forEach((s) => {
          if (s.username && !s.connected && s.disconnectedAt) {
            const elapsed = (Date.now() - new Date(s.disconnectedAt).getTime()) / 1000;
            const remaining = Math.max(0, 30 - Math.floor(elapsed));
            next[s.slot] = remaining;
            if (prev[s.slot] !== remaining) changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [slots]);

  // Auto-start countdown tick
  useEffect(() => {
    if (!autoStartAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((autoStartAt - Date.now()) / 1000));
      setAutoStartCountdown(remaining);
    }, 500);
    return () => clearInterval(interval);
  }, [autoStartAt]);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(gameId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fix #9: document.execCommand('copy') is deprecated but kept as fallback
      // for older browsers without navigator.clipboard API support.
      const ta = document.createElement('textarea');
      ta.value = gameId;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [gameId]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my GridLock game!',
          text: `Join my GridLock game! Code: ${gameId}`,
          url: shareUrl,
        });
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      } catch { /* ignore */ }
    }
  }, [gameId, shareUrl]);

  const handleReplaceWithCPU = useCallback((slot) => {
    socket.emit('replace_with_cpu', {
      gameId, sessionToken, slot,
      difficulty: cpuDifficulty,
    });
  }, [gameId, sessionToken, cpuDifficulty]);

  const handleStartGame = useCallback(() => {
    setStarting(true);
    if (roomFull) {
      // All slots filled with humans — use start_game
      socket.emit('start_game', { gameId, sessionToken });
    } else {
      // Empty slots will be filled with CPU
      socket.emit('start_game_early', { gameId, sessionToken, cpuDifficulty });
    }
  }, [gameId, sessionToken, cpuDifficulty, roomFull]);

  const handleLeave = useCallback(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  const canStart = isHost && filled >= 2;
  const allFilled = filled === playerCount;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 safe-bottom"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-md">

        {/* Session conflict banner */}
        {sessionConflictMessage && (
          <div
            className="mb-4 rounded-xl p-4 text-center text-sm font-semibold"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--danger) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
              color: 'var(--danger)',
            }}
          >
            ⚠️ {sessionConflictMessage}
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            GridLock
          </h1>
          <p className="text-xs mt-1 tracking-widest uppercase" style={{ color: 'var(--label-color)' }}>
            Waiting Room
          </p>
        </div>

        {/* Card */}
        <div
          className="backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >

          {/* Game Code */}
          <div className="p-5 text-center" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>
              Room Code
            </span>
            <div
              className="mt-2 font-mono font-extrabold tracking-[0.12em] select-all text-[28px] sm:text-4xl"
              style={{ color: 'var(--text-primary)' }}
            >
              {gameId}
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              {gridSize}×{gridSize} · {playerCount} Players
            </div>
            <button
              onClick={handleCopyCode}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
              style={{
                background: copied ? 'var(--success)' : 'var(--bg-card)',
                border: '1px solid var(--border-color-strong)',
                color: copied ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              }}
            >
              {copied ? '✅ Copied!' : '📋 Copy Code'}
            </button>
          </div>

          {/* Share / Copy Buttons */}
          <div className="p-4 flex gap-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={handleShare}
              className="flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: shared ? 'var(--success)' : 'linear-gradient(135deg, var(--accent), var(--player4-color))',
                color: 'var(--text-on-accent)',
              }}
            >
              {shared ? '✅ Shared!' : (<><span className="hidden sm:inline">📤 Share Invite Link</span><span className="sm:hidden">📤 Share</span></>)}
            </button>
            <button
              onClick={handleCopyCode}
              className="py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{
                background: copied ? 'var(--success)' : 'var(--bg-card)',
                border: '1px solid var(--border-color-strong)',
                color: copied ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              }}
            >
              {copied ? '✅' : '📋'}
            </button>
          </div>

          {/* QR Code Section */}
          <div className="p-4 text-center" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setShowQR((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
              style={{
                background: showQR ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg-card)',
                border: `1px solid ${showQR ? 'var(--accent)' : 'var(--border-color-strong)'}`,
                color: showQR ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {showQR ? '✕ Hide QR Code' : '📱 Show QR Code'}
            </button>

            {showQR && (
              <div className="mt-3 flex flex-col items-center">
                <div className="bg-white rounded-2xl p-4 shadow-lg inline-block">
                  <QRCodeSVG
                    value={shareUrl}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#0F172A"
                    level="M"
                    includeMargin={true}
                    className="w-[180px] h-[180px] sm:w-[220px] sm:h-[220px]"
                  />
                </div>
                <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Scan to join · <span className="font-mono" style={{ color: 'var(--accent)' }}>{gameId}</span>
                </p>
              </div>
            )}
          </div>

          {/* Player Slots */}
          <div className="p-4 space-y-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>
              Players ({filled}/{playerCount})
            </span>

            {slots.map((slot) => (
              <div
                key={slot.slot}
                className="flex items-center gap-3 p-3 rounded-xl transition-all"
                style={{
                  background: slot.username
                    ? (slot.connected !== false || slot.isCPU
                      ? 'color-mix(in srgb, var(--success) 10%, transparent)'
                      : 'color-mix(in srgb, var(--danger) 10%, transparent)')
                    : 'var(--bg-card)',
                  border: `1px solid ${slot.username
                    ? (slot.connected !== false || slot.isCPU
                      ? 'color-mix(in srgb, var(--success) 25%, transparent)'
                      : 'color-mix(in srgb, var(--danger) 25%, transparent)')
                    : 'var(--border-color)'}`,
                }}
              >
                {/* Avatar */}
                <span className="text-2xl w-9 text-center flex-shrink-0">
                  {slot.username
                    ? (slot.isCPU ? '🤖' : (slot.avatar || '👤'))
                    : '👤'}
                </span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-sm font-semibold truncate waiting-room-player-text"
                      style={{ color: slot.username ? 'var(--text-primary)' : 'var(--text-muted)' }}
                    >
                      {slot.username
                        ? (slot.isCPU
                          ? `${slot.username} (${cpuDifficulty ? cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1) : 'Medium'})`
                          : (slot.username === username ? `${slot.username} (you)` : slot.username))
                        : 'Waiting for player\u2026'}
                    </span>
                  </div>
                  {slot.isHost && (
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Host</span>
                  )}
                  {slot.username && !slot.isCPU && !slot.connected && disconnectTimers[slot.slot] !== undefined && (
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>
                      Disconnected · {disconnectTimers[slot.slot]}s
                    </span>
                  )}
                </div>

                {/* Status + Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {slot.username ? (
                    slot.connected !== false || slot.isCPU ? (
                      <span className="text-sm">✅</span>
                    ) : (
                      <span className="text-sm">❌</span>
                    )
                  ) : (
                    <span className="text-sm animate-pulse">⏳</span>
                  )}

                  {isHost && !slot.isCPU && (!slot.username || (!slot.connected && slot.username !== username)) && slot.slot !== 'player1' && (
                    <button
                      onClick={() => handleReplaceWithCPU(slot.slot)}
                      className="text-[10px] font-bold px-2 py-1 rounded-lg transition-all active:scale-95"
                      style={{
                        background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
                        color: 'var(--warning)',
                        minHeight: '44px',
                        minWidth: '44px',
                      }}
                      title="Replace with CPU"
                    >
                      🤖 CPU
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Placeholder slots before lobby_state arrives */}
            {slots.length === 0 && Array.from({ length: playerCount }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
              >
                <span className="text-2xl w-9 text-center flex-shrink-0">
                  {i === 0 ? (avatar || '👦') : '👤'}
                </span>
                <div className="flex-1">
                  <span className="text-sm font-semibold waiting-room-player-text" style={{ color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {i === 0 ? `${username} (you)` : 'Waiting for player\u2026'}
                  </span>
                  {i === 0 && (
                    <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Host</span>
                  )}
                </div>
                <span className="text-sm">{i === 0 ? '✅' : '⏳'}</span>
              </div>
            ))}
          </div>

          {/* Fix #7: Non-host context message */}
          {!isHost && (
            <p className="text-center text-sm py-3 px-4" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
              {autoStartCountdown != null && autoStartCountdown > 0
                ? `⏳ Auto-starting in ${autoStartCountdown}s...`
                : autoStartCountdown === 0
                  ? '🚀 Starting now...'
                  : '⏳ Waiting for the host to start the game...'}
            </p>
          )}

          {/* Admin Controls */}
          {isHost && (
            <div className="p-4 space-y-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div>
                {/* Fix #11: CPU difficulty is local state — not synced to other players
                    until a CPU is added or game starts. Only host controls difficulty. */}
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>
                  CPU Difficulty
                </span>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {DIFFICULTY_OPTIONS.map(({ value, label, icon }) => (
                    <button
                      key={value}
                      onClick={() => setCpuDifficulty(value)}
                      className="py-2 rounded-xl text-center text-xs font-bold transition-all active:scale-95"
                      style={cpuDifficulty === value
                        ? { background: 'var(--warning)', border: '1px solid var(--warning)', color: 'var(--text-on-warning)', minHeight: '44px', minWidth: '44px' }
                        : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)', minHeight: '44px', minWidth: '44px' }}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleStartGame}
                disabled={!canStart || starting}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
                style={{
                  background: canStart && !starting
                    ? 'linear-gradient(135deg, var(--success), var(--accent))'
                    : 'var(--bg-surface)',
                  color: canStart && !starting ? 'var(--text-on-accent)' : 'var(--text-muted)',
                }}
              >
                {starting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span
                      className="w-4 h-4 border-2 rounded-full animate-spin"
                      style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }}
                    />
                    Starting...
                  </span>
                ) : allFilled ? (
                  '🚀 Start Game'
                ) : canStart ? (
                  '🚀 Start Game (fill empty with CPU)'
                ) : (
                  '🚀 Waiting for players...'
                )}
              </button>
            </div>
          )}

          {/* Leave */}
          <div className="p-4 text-center">
            <button
              onClick={handleLeave}
              className="text-xs transition-colors"
              style={{ color: 'var(--text-muted)', minHeight: '44px', minWidth: '44px' }}
            >
              ← Leave Waiting Room
            </button>
          </div>

        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-secondary)' }}>
          Share the code or link with friends to start playing!
        </p>
      </div>
    </div>
  );
};

export default WaitingRoom;
