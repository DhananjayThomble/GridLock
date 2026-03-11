// src/components/DailyChallenge.jsx
// Daily challenge — seeded puzzle, play vs Hard CPU, one attempt per day

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import { initAudio } from '../utils/sounds';
import DailyResult from './DailyResult';

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

const DailyChallenge = () => {
  const [username] = useState(() => localStorage.getItem('gridlock_username') || '');
  const [avatar] = useState(() => localStorage.getItem('gridlock-avatar') || '👦');
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);
  const [existingResult, setExistingResult] = useState(null);
  const [gameResult, setGameResult] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [streak, setStreak] = useState(null);
  const [starting, setStarting] = useState(false);
  const startTimeRef = useRef(null);
  const navigate = useNavigate();

  // Fetch today's challenge
  const fetchChallenge = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(apiUrl(`/api/daily/today?username=${encodeURIComponent(username)}`));
      const data = await res.json();
      if (data.success) {
        setChallenge(data.challenge);
        setAlreadyPlayed(data.alreadyPlayed);
        setExistingResult(data.existingResult);
        setCountdown(data.nextPuzzleIn);
      } else {
        setError(data.error || 'Failed to load challenge');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [username]);

  // Fetch streak
  const fetchStreak = useCallback(async () => {
    if (!username) return;
    try {
      const res = await fetch(apiUrl(`/api/daily/streak/${encodeURIComponent(username)}`));
      const data = await res.json();
      if (data.success) {
        setStreak(data.streak);
      }
    } catch {
      // Streak fetch is non-critical
    }
  }, [username]);

  useEffect(() => {
    fetchChallenge();
    fetchStreak();
  }, [fetchChallenge, fetchStreak]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(interval);
          // Refresh challenge at midnight
          fetchChallenge();
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown, fetchChallenge]);

  // Listen for game completion
  useEffect(() => {
    const onGameOver = async (data) => {
      if (!playing) return;
      setPlaying(false);

      const endTime = Date.now();
      const duration = Math.round((endTime - startTimeRef.current) / 1000);
      const myScore = data.scores?.player1 || 0;
      const totalMoves = data.totalMoves || 0;

      // Submit result
      try {
        const res = await fetch(apiUrl('/api/daily/result'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            score: myScore,
            moves: totalMoves,
            duration,
            date: challenge.date,
          }),
        });
        const result = await res.json();
        if (result.success) {
          setGameResult(result.result);
          setAlreadyPlayed(true);
          fetchStreak(); // Refresh streak
        } else {
          setError(result.error || 'Failed to submit result');
        }
      } catch {
        setError('Failed to submit result');
      }
    };

    socket.on('game_over', onGameOver);
    return () => socket.off('game_over', onGameOver);
  }, [playing, username, challenge, fetchStreak]);

  // Start daily challenge
  const handleStart = () => {
    if (!username || !challenge) return;
    initAudio();
    if (!socket.connected) socket.connect();

    setStarting(true);
    startTimeRef.current = Date.now();

    // Create a CPU game with the seeded board
    socket.emit(
      'create_game',
      {
        gridSize: challenge.gridSize,
        username,
        avatar,
        playerCount: 2,
        cpuPlayers: 1,
        cpuDifficulty: 'hard',
        dailyChallenge: true,
        dailySeed: challenge.seed,
        dailyBoard: challenge.board,
      },
      (res) => {
        setStarting(false);
        if (res?.error) {
          setError(res.error);
          return;
        }
        if (res?.gameId) {
          setPlaying(true);
          navigate('/game', {
            state: {
              username,
              gridSize: challenge.gridSize,
              gameId: res.gameId,
              role: res.playerId,
              avatar,
              playerCount: 2,
              sessionToken: res.sessionToken,
              cpuDifficulty: 'hard',
              dailyChallenge: true,
              dailySeed: challenge.seed,
              dailyBoard: challenge.board,
            },
          });
        }
      }
    );
  };

  // Already played — show result
  if (alreadyPlayed && (existingResult || gameResult)) {
    const result = gameResult || {
      ...existingResult,
      dayNumber: challenge?.dayNumber,
    };
    return (
      <DailyResult
        result={result}
        challenge={challenge}
        streak={streak}
        countdown={countdown}
        onBack={() => navigate('/')}
      />
    );
  }

  // No username
  if (!username) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Set Your Name First</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Go to the lobby and enter a username to play the daily challenge.</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 rounded-xl font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            Go to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-start justify-center p-3 pt-6 sm:p-4 sm:pt-8 sm:items-center safe-bottom"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 bg-clip-text text-transparent leading-tight">
            Daily Challenge
          </h1>
          <p className="text-sm mt-1 tracking-widest uppercase" style={{ color: 'var(--label-color)' }}>
            One Puzzle · One Chance · Global Rank
          </p>
        </div>

        {/* Card */}
        <div
          className="backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >
          {loading ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              <p style={{ color: 'var(--text-muted)' }}>Loading today&apos;s challenge…</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-lg mb-2" style={{ color: 'var(--danger)' }}>⚠️ {error}</p>
              <button onClick={fetchChallenge} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
                Retry
              </button>
            </div>
          ) : challenge ? (
            <>
              {/* Day info */}
              <div className="p-5 text-center" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div className="text-3xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Day #{challenge.dayNumber}
                </div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {challenge.gridSize}×{challenge.gridSize} Grid · Hard CPU
                </div>
                <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  {challenge.date}
                </div>
              </div>

              {/* Streak display */}
              {streak && streak.totalPlayed > 0 && (
                <div className="px-5 py-3 flex items-center justify-center gap-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: 'var(--warning)' }}>
                      🔥 {streak.current}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Current Streak</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                      {streak.best}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Best Streak</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                      {streak.totalPlayed}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Played</div>
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

              {/* Play button */}
              <div className="p-5">
                <button
                  onClick={handleStart}
                  disabled={starting || alreadyPlayed}
                  className="w-full py-4 rounded-xl font-bold text-lg transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{
                    background: starting
                      ? 'var(--bg-surface)'
                      : 'linear-gradient(135deg, var(--warning), var(--danger))',
                    color: starting ? 'var(--text-muted)' : 'var(--text-on-accent)',
                    boxShadow: starting
                      ? 'none'
                      : '0 4px 16px color-mix(in srgb, var(--warning) 40%, transparent)',
                  }}
                >
                  {starting ? (
                    <>
                      <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Starting…
                    </>
                  ) : (
                    '🎯 Play Today\'s Challenge'
                  )}
                </button>
                <p className="text-xs text-center mt-2" style={{ color: 'var(--text-muted)' }}>
                  Same board for everyone · One attempt only
                </p>
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
            </>
          ) : null}
        </div>

        {/* Back to lobby */}
        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/')}
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

export default DailyChallenge;
