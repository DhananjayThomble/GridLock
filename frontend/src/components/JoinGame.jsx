// src/components/JoinGame.jsx
// Zero-friction invite link join page — /join/:gameId

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket';
import { initAudio } from '../utils/sounds';

const AVATARS = ['👦','👧','🧑','👩','🤖','🐱','🐶','🦊','🐻','🐼','🦁','🐯','🚀','⚽','🎮','🦄'];

const JoinGame = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState(() => localStorage.getItem('gridlock_username') || '');
  const [selectedAvatar, setSelectedAvatar] = useState('👦');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  // Redirect to lobby if no gameId
  useEffect(() => {
    if (!gameId) navigate('/', { replace: true });
  }, [gameId, navigate]);

  // Listen for socket events
  useEffect(() => {
    const onGameStarted = (data) => {
      setJoining(false);
      localStorage.setItem('gridlock_username', username.trim());

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
        });
      }
    };

    const onError = (msg) => {
      setJoining(false);
      setError(typeof msg === 'string' ? msg : 'Something went wrong');
    };

    socket.on('game_started', onGameStarted);
    socket.on('error', onError);
    return () => {
      socket.off('game_started', onGameStarted);
      socket.off('error', onError);
    };
  }, [navigate, username, selectedAvatar]);

  const handleJoin = () => {
    const name = username.trim();
    if (!name) return setError('Please enter a username');
    setError('');
    setJoining(true);
    initAudio();
    localStorage.setItem('gridlock_username', name);
    if (!socket.connected) socket.connect();
    // Include existing session token for rejoin scenarios
    const existingToken = localStorage.getItem(`gridlock:session:${gameId.toUpperCase()}:${name}`);
    socket.emit('join_game', {
      gameId: gameId.toUpperCase(),
      username: name,
      avatar: selectedAvatar,
      ...(existingToken ? { sessionToken: existingToken } : {}),
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
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
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

            {/* Avatar picker */}
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

            {/* Error */}
            {error && (
              <div className="rounded-xl px-4 py-2.5 text-sm text-center" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
                {error}
                <button
                  onClick={() => navigate('/')}
                  className="block mx-auto mt-2 text-xs underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Go to Lobby
                </button>
              </div>
            )}

            {/* Join button */}
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 disabled:opacity-60"
              style={{ background: joining ? 'var(--bg-surface)' : 'var(--success)', ...(joining && { color: 'var(--text-muted)' }) }}
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

            {/* Lobby link */}
            <p className="text-center">
              <button
                onClick={() => navigate('/')}
                className="text-xs transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                or go to Lobby →
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JoinGame;
