// src/components/ChallengePage.jsx
// Landing page for challenge links — /play/:username
// Shows challenger name, name input, and accept button

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket';
import { initAudio } from '../utils/sounds';

const AVATARS = ['👦','👧','🧑','👩','🤖','🐱','🐶','🦊','🐻','🐼','🦁','🐯','🚀','⚽','🎮','🦄'];

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;
const validateUsername = (raw) => {
  const name = (raw || '').trim();
  if (!name) return 'Please enter your name';
  if (name.length < 2) return 'Name must be at least 2 characters';
  if (name.length > 16) return 'Name must be at most 16 characters';
  if (!USERNAME_RE.test(name)) return 'Only letters, numbers, underscores, and hyphens';
  return '';
};

const ChallengePage = () => {
  const { username: challengerUsername } = useParams();
  const navigate = useNavigate();
  const [myName, setMyName] = useState(() => localStorage.getItem('gridlock_username') || '');
  const [selectedAvatar, setSelectedAvatar] = useState(() => {
    const saved = localStorage.getItem('gridlock-avatar');
    return saved && AVATARS.includes(saved) ? saved : '👦';
  });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const joinedRef = useRef(false);

  // Listen for game_started after joining
  useEffect(() => {
    const onGameStarted = (data) => {
      if (joinedRef.current) return;
      joinedRef.current = true;
      setJoining(false);
      localStorage.setItem('gridlock_username', myName.trim());

      navigate('/game', {
        state: {
          username: myName.trim(),
          gameId: data.gameId,
          role: data.playerId,
          avatar: selectedAvatar,
          playerCount: data.playerCount,
          gridSize: data.gridSize,
          sessionToken: data.sessionToken,
        },
      });
    };

    socket.on('game_started', onGameStarted);
    return () => socket.off('game_started', onGameStarted);
  }, [navigate, myName, selectedAvatar]);

  const handleAcceptChallenge = () => {
    initAudio();
    const name = myName.trim();
    const nameErr = validateUsername(myName);
    if (nameErr) {
      setNameError(nameErr);
      return;
    }
    setNameError('');
    setError('');

    if (!socket.connected) socket.connect();
    setJoining(true);

    socket.emit('join_challenge', {
      challengerUsername,
      username: name,
      avatar: selectedAvatar,
    }, (res) => {
      if (res?.error) {
        setJoining(false);
        setError(res.error);
        return;
      }
      // If callback returns success with game data, navigate
      if (res?.success && res?.gameId) {
        if (joinedRef.current) return;
        joinedRef.current = true;
        setJoining(false);
        localStorage.setItem('gridlock_username', name);

        navigate(res.playerId ? '/game' : `/waiting/${res.gameId}`, {
          state: {
            username: name,
            gameId: res.gameId,
            role: res.playerId,
            avatar: selectedAvatar,
            playerCount: res.playerCount,
            gridSize: res.gridSize,
            sessionToken: res.sessionToken,
          },
        });
      }
    });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div
        className="w-full max-w-md backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
      >
        {/* Header */}
        <div className="p-6 text-center" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="text-5xl mb-3">⚔️</div>
          <h1
            className="text-2xl font-extrabold mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            You've Been Challenged!
          </h1>
          <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-bold" style={{ color: 'var(--accent)' }}>{challengerUsername}</span> wants to play GridLock with you
          </p>
        </div>

        {/* Form */}
        <div className="p-6 space-y-4">
          {/* Name input */}
          <div>
            <label
              className="block text-xs font-bold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--label-color)' }}
            >
              Your Name
            </label>
            <input
              type="text"
              value={myName}
              onChange={(e) => { setMyName(e.target.value); setNameError(''); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleAcceptChallenge()}
              placeholder="Enter your name…"
              maxLength={16}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="w-full rounded-xl px-4 py-3 text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
              style={{
                background: 'var(--input-bg)',
                border: nameError ? '1px solid var(--danger)' : '1px solid var(--border-color-strong)',
                color: 'var(--text-primary)',
              }}
            />
            {nameError && (
              <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{nameError}</p>
            )}
          </div>

          {/* Avatar picker (compact) */}
          <div>
            <label
              className="block text-xs font-bold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--label-color)' }}
            >
              Pick Avatar
            </label>
            <div className="flex flex-wrap gap-1.5">
              {AVATARS.map((av) => (
                <button
                  key={av}
                  onClick={() => setSelectedAvatar(av)}
                  className="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all active:scale-90"
                  style={selectedAvatar === av
                    ? { background: 'var(--accent)', border: '2px solid var(--accent)', boxShadow: '0 2px 8px color-mix(in srgb, var(--accent) 40%, transparent)' }
                    : { background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                  aria-label={`Select avatar ${av}`}
                >
                  {av}
                </button>
              ))}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div
              className="rounded-xl p-3 text-sm text-center"
              style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
            >
              {error}
            </div>
          )}

          {/* Accept button */}
          <button
            onClick={handleAcceptChallenge}
            disabled={joining || !myName.trim()}
            className="w-full py-3.5 rounded-xl font-bold text-base transition-all active:scale-95 disabled:opacity-60"
            style={{
              background: joining ? 'var(--bg-surface)' : 'var(--accent)',
              color: joining ? 'var(--text-muted)' : 'var(--text-on-accent)',
              boxShadow: joining ? 'none' : '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)',
            }}
          >
            {joining ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }}
                />
                Joining…
              </span>
            ) : (
              '⚔️ Accept Challenge'
            )}
          </button>

          {/* Game info */}
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            3×3 Grid · 2 Players · Real-time Match
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChallengePage;
