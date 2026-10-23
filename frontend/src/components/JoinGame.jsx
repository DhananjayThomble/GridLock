// src/components/JoinGame.jsx
// Zero-friction invite link join page — /join/:gameId

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import socket from '../socket';
import { initAudio } from '../utils/sounds';
import { safeStorage } from '../utils/safeStorage';

const AVATARS = ['👦','👧','🧑','👩','🤖','🐱','🐶','🦊','🐻','🐼','🦁','🐯','🚀','⚽','🎮','🦄'];

// Room codes are 6-char uppercase hexadecimal strings (A-F, 0-9)
const ROOM_CODE_REGEX = /^[A-F0-9]{6}$/;
const isValidRoomCode = (code) => ROOM_CODE_REGEX.test((code || '').toUpperCase());

const JoinGame = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  // The lobby's "Rejoin Game" banner sends the player's own name/avatar and asks us to rejoin at once
  const routeState = useLocation().state || {};
  const [username, setUsername] = useState(() => routeState.username || safeStorage.getItem('gridlock_username') || '');
  const [selectedAvatar, setSelectedAvatar] = useState(routeState.avatar || '👦');
  // #420: Validate room code format on mount
  const invalidCode = gameId ? !isValidRoomCode(gameId) : false;
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(() => invalidCode ? 'Invalid room code format. Codes are 6-character hexadecimal (A-F, 0-9).' : '');
  const [permanentError, setPermanentError] = useState(invalidCode);
  const [isGameFull, setIsGameFull] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(null);
  const handleJoinRef = useRef(null);

  // Redirect to lobby if no gameId
  useEffect(() => {
    if (!gameId) navigate('/', { replace: true });
  }, [gameId, navigate]);

  // Auto-retry countdown for transient errors (e.g., "Game is full")
  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) return;
    const timer = setTimeout(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          setError('');
          // Fix #6: Actually re-attempt join when countdown hits 0
          setTimeout(() => handleJoinRef.current(), 0);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryCountdown]);

  // Listen for socket events
  useEffect(() => {
    const onGameStarted = (data) => {
      setJoining(false);
      safeStorage.setItem('gridlock_username', username.trim());

      // Check if joined as spectator (#365)
      if (data.role === 'spectator' || data.playerId === 'spectator') {
        navigate('/game', {
          state: {
            username: username.trim(),
            gameId: data.gameId || gameId.toUpperCase(),
            role: 'spectator',
            avatar: selectedAvatar,
            playerCount: data.playerCount,
            gridSize: data.gridSize,
            joinMode: 'spectator',
          },
        });
        return;
      }

      // Check if game is full — if not, go to waiting room
      const playerList = data.players || {};
      const totalSlots = data.playerCount || 2;
      const filledSlots = Object.values(playerList).filter(Boolean).length;

      if (filledSlots < totalSlots) {
        navigate(`/waiting/${data.gameId || gameId.toUpperCase()}`, {
          state: {
            username: username.trim(),
            gameId: data.gameId || gameId.toUpperCase(),
            role: data.playerId,
            avatar: selectedAvatar,
            playerCount: data.playerCount,
            gridSize: data.gridSize,
            sessionToken: data.sessionToken,
            isHost: false,
          },
          replace: true, // Back should not return to the join form
        });
      } else {
        navigate('/game', {
          state: {
            username: username.trim(),
            gameId: data.gameId,
            role: data.playerId,
            avatar: selectedAvatar,
            playerCount: data.playerCount,
            gridSize: data.gridSize,
            sessionToken: data.sessionToken,
          },
          replace: true, // Back should not return to the join form
        });
      }
    };

    const onError = (msg) => {
      setJoining(false);
      const message = typeof msg === 'string' ? msg : 'Something went wrong';
      setError(message);
      // Only truly permanent: game not found or already started (can't change)
      // "Game is full" is transient — someone may leave
      const trulyPermanentErrors = ['Game not found', 'Game has already started', 'Game is no longer available'];
      if (trulyPermanentErrors.some(pe => message.includes(pe))) {
        setPermanentError(true);
        setIsGameFull(false);
        // Clear active game from localStorage if game no longer exists (#374 review)
        try { safeStorage.removeItem('gridlock_active_game'); } catch { /* ignore */ }
      } else if (message.includes('Game is full')) {
        // Transient: auto-retry after 5 seconds
        setPermanentError(false);
        setIsGameFull(true);
        setRetryCountdown(5);
      } else {
        setIsGameFull(false);
      }
    };

    socket.on('game_started', onGameStarted);
    socket.on('error', onError);
    return () => {
      socket.off('game_started', onGameStarted);
      socket.off('error', onError);
    };
  }, [navigate, username, selectedAvatar]);

  const handleJoin = () => {
    if (invalidCode) return;
    const name = username.trim();
    if (!name) return setError('Please enter a username');
    setError('');
    setJoining(true);
    initAudio();
    safeStorage.setItem('gridlock_username', name);
    if (!socket.connected) socket.connect();
    // Include existing session token for rejoin scenarios
    const existingToken = safeStorage.getItem(`gridlock:session:${gameId.toUpperCase()}:${name}`);
    socket.emit('join_game', {
      gameId: gameId.toUpperCase(),
      username: name,
      avatar: selectedAvatar,
      ...(existingToken ? { sessionToken: existingToken } : {}),
    });
  };

  // Keep ref in sync for auto-retry
  useEffect(() => {
    handleJoinRef.current = handleJoin;
  });

  // One-tap rejoin: coming from the "unfinished game" banner with a stored session token, skip the
  // form and rejoin straight away. Any failure leaves the form on screen with the error shown.
  const autoRejoinedRef = useRef(false);
  useEffect(() => {
    if (autoRejoinedRef.current || !routeState.autoRejoin || invalidCode || !gameId || !username.trim()) return;
    if (!safeStorage.getItem(`gridlock:session:${gameId.toUpperCase()}:${username.trim()}`)) return;
    autoRejoinedRef.current = true;
    handleJoinRef.current?.();
  });

  // Watch Game as spectator (#365)
  const handleWatchGame = () => {
    const name = username.trim();
    if (!name) return setError('Please enter a username');
    // Cancel any active retry countdown to prevent race condition (#374 review)
    setRetryCountdown(null);
    setError('');
    setIsGameFull(false);
    setJoining(true);
    initAudio();
    safeStorage.setItem('gridlock_username', name);
    if (!socket.connected) socket.connect();
    socket.emit('join_game', {
      gameId: gameId.toUpperCase(),
      username: name,
      avatar: selectedAvatar,
      joinMode: 'spectator',
    });
  };

  if (!gameId) return null;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 safe-bottom"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-sm">

        {/* Title */}
        <div className="text-center mb-6">
          <h1
            className="gradient-title text-4xl font-extrabold bg-clip-text text-transparent"
          >
            GridLock
          </h1>
          <p className="text-xs mt-1 tracking-widest uppercase" style={{ color: 'var(--label-color)' }}>Join Game</p>
        </div>

        {/* Card */}
        <div
          className="backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >
          <div className="p-5 space-y-4">

            {/* Game ID display */}
            <div className="text-center">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Game ID</span>
              <div className="mt-1 font-mono text-2xl font-extrabold tracking-widest" style={{ color: 'var(--text-primary)' }}>
                {gameId.toUpperCase()}
              </div>
            </div>

            {/* Username */}
            {!permanentError && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Your Name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                placeholder="Enter your name…"
                maxLength={20}
                autoComplete="nickname"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="join"
                className="w-full rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
              />
            </div>
            )}

            {/* Avatar picker */}
            {!permanentError && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Pick Avatar</label>
              <div className="grid grid-cols-8 gap-1.5">
                {AVATARS.map((av) => (
                  <button
                    key={av}
                    onClick={() => setSelectedAvatar(av)}
                    className={`aspect-square rounded-lg text-lg flex items-center justify-center transition-all active:scale-90 ${
                      selectedAvatar === av
                        ? 'ring-2 scale-110 shadow-lg'
                        : ''
                    }`}
                    style={selectedAvatar === av
                      ? { background: 'var(--accent)', '--tw-ring-color': 'var(--accent-hover)' }
                      : { background: 'var(--bg-card-hover)' }}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl px-4 py-2.5 text-sm text-center" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
                {error}
                {retryCountdown > 0 && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Retrying in {retryCountdown}s...
                  </p>
                )}
                {/* Watch Game button when game is full (#365) */}
                {isGameFull && (
                  <div className="flex gap-2 mt-2 justify-center">
                    <button
                      onClick={handleWatchGame}
                      className="py-3 px-5 rounded-lg font-bold text-sm transition-all active:scale-95 min-h-[44px]"
                      style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                    >
                      👀 Watch Game
                    </button>
                    <button
                      onClick={() => navigate('/')}
                      className="py-3 px-5 rounded-lg font-bold text-sm transition-all active:scale-95 min-h-[44px]"
                      style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color-strong)' }}
                    >
                      🏠 Find Another Game
                    </button>
                  </div>
                )}
                {permanentError && (
                  <div className="flex gap-2 mt-2 justify-center">
                    <button
                      onClick={() => { setError(''); setPermanentError(false); }}
                      className="py-3 px-5 rounded-lg font-bold text-sm transition-all active:scale-95 min-h-[44px]"
                      style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color-strong)' }}
                    >
                      🔄 Try Again
                    </button>
                    <button
                      onClick={() => navigate('/')}
                      className="py-3 px-5 rounded-lg font-bold text-sm transition-all active:scale-95 min-h-[44px]"
                      style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                    >
                      🏠 Find Another Game
                    </button>
                  </div>
                )}
                {!permanentError && !isGameFull && !retryCountdown && (
                  <button
                    onClick={() => navigate('/')}
                    className="block mx-auto mt-2 text-xs underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Go to Lobby
                  </button>
                )}
              </div>
            )}

            {/* Join button */}
            {!permanentError && (
            <button
              onClick={handleJoin}
              disabled={joining || retryCountdown > 0}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: (joining || retryCountdown > 0) ? 'var(--bg-surface)' : 'var(--success)',
                color: (joining || retryCountdown > 0) ? 'var(--text-muted)' : 'var(--text-on-accent)',
              }}
            >
              {joining ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                  Joining…
                </span>
              ) : (
                '🎮 Join Game'
              )}
            </button>
            )}

            {/* Lobby link */}
            {!permanentError && (
            <p className="text-center">
              <button
                onClick={() => navigate('/')}
                className="text-xs transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                or go to Lobby →
              </button>
            </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default JoinGame;
