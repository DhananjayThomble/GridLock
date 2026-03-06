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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4 safe-bottom">
      <div className="w-full max-w-sm">

        {/* Title */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            GridLock
          </h1>
          <p className="text-blue-300 text-xs mt-1 tracking-widest uppercase">Join Game</p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 overflow-hidden shadow-2xl">
          <div className="p-5 space-y-4">

            {/* Game ID display */}
            <div className="text-center">
              <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Game ID</span>
              <div className="mt-1 font-mono text-2xl font-extrabold text-white tracking-widest">
                {gameId.toUpperCase()}
              </div>
            </div>

            {/* Username */}
            <div>
              <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-1.5">Your Name</label>
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
                className="w-full bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
              />
            </div>

            {/* Avatar picker */}
            <div>
              <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-1.5">Pick Avatar</label>
              <div className="grid grid-cols-8 gap-1.5">
                {AVATARS.map((av) => (
                  <button
                    key={av}
                    onClick={() => setSelectedAvatar(av)}
                    className={`aspect-square rounded-lg text-lg flex items-center justify-center transition-all active:scale-90 ${
                      selectedAvatar === av
                        ? 'bg-blue-500 ring-2 ring-blue-300 scale-110 shadow-lg'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/20 border border-red-400/30 rounded-xl px-4 py-2.5 text-red-200 text-sm text-center">
                {error}
                <button
                  onClick={() => navigate('/')}
                  className="block mx-auto mt-2 text-xs text-blue-300 hover:text-blue-200 underline"
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
              style={{ background: joining ? '#6b7280' : 'linear-gradient(135deg,#10B981,#059669)' }}
            >
              {joining ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
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
                className="text-white/40 text-xs hover:text-white/70 transition-colors"
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
