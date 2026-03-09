// src/components/Lobby.jsx
// Production-ready lobby — mobile-first, fully adaptive

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { initAudio } from '../utils/sounds';
import socket from '../socket';
import { getStats, getWinRate, getAvgTerritory, resetStats } from '../utils/sessionStats';
import { subscribeToPush, unsubscribeFromPush } from '../utils/pushManager';
import ThemeToggle from './ThemeToggle';
import SoundSettings from './SoundSettings';
import QuickPlay from './QuickPlay';

const AVATARS = ['👦','👧','🧑','👩','🤖','🐱','🐶','🦊','🐻','🐼','🦁','🐯','🚀','⚽','🎮','🦄'];

/** Safely persist to localStorage — swallows quota/private-browsing errors. */
const safePersist = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* quota exceeded / private browsing */ }
};

const PLAYER_COUNT_OPTIONS = [
  { value: 2, label: '2 Players', icon: '👥', desc: 'Classic duel' },
  { value: 3, label: '3 Players', icon: '👨👩👦', desc: 'Triple threat' },
  { value: 4, label: '4 Players', icon: '👨👩👧👦', desc: 'Party mode' },
];

const GRID_OPTIONS = [
  { value: 3, label: '3×3', desc: 'Quick' },
  { value: 4, label: '4×4', desc: 'Standard' },
  { value: 5, label: '5×5', desc: 'Pro' },
  { value: 6, label: '6×6', desc: 'Epic' },
];

const DIFFICULTY_OPTIONS = [
  { value: 'easy',   label: 'Easy',   icon: '😊', desc: 'Random moves' },
  { value: 'medium', label: 'Medium', icon: '🧐', desc: 'Smart plays' },
  { value: 'hard',   label: 'Hard',   icon: '🧠', desc: 'Chain strategy' },
];

const TOURNAMENT_SIZE_OPTIONS = [
  { value: 4, label: '4 Players', icon: '🏟️', desc: 'Quick bracket' },
  { value: 8, label: '8 Players', icon: '🏆', desc: 'Full bracket' },
];

// ── Username validation (module-level — pure & static) ──────────────────────
const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;
const validateUsername = (raw) => {
  const name = raw.trim();
  if (!name) return 'Please enter a username';
  if (name.length < 2) return 'Username must be at least 2 characters';
  if (name.length > 16) return 'Username must be at most 16 characters';
  if (!USERNAME_RE.test(name)) return 'Only letters, numbers, underscores, and hyphens allowed';
  return '';
};

const Lobby = () => {
  const [username,      setUsername]      = useState(() => localStorage.getItem('gridlock_username') || '');
  const [gridSize,      setGridSize]      = useState(() => {
    const saved = parseInt(localStorage.getItem('gridlock-gridSize'), 10);
    return saved >= 3 && saved <= 6 ? saved : 3;
  });
  const [playerCount,   setPlayerCount]   = useState(() => {
    const saved = parseInt(localStorage.getItem('gridlock-playerCount'), 10);
    return saved >= 2 && saved <= 4 ? saved : 2;
  });
  const [selectedAvatar, setSelectedAvatar] = useState(() => {
    const saved = localStorage.getItem('gridlock-avatar');
    return saved && AVATARS.includes(saved) ? saved : '👦';
  });
  const [gameId,        setGameId]        = useState('');
  const [creating,      setCreating]      = useState(false);
  const [joining,       setJoining]       = useState(false);
  const [joinMode,      setJoinMode]      = useState('player'); // 'player' | 'spectator'
  const [tab,           setTab]           = useState('create'); // 'create' | 'join' | 'tournament'
  const [showStats,     setShowStats]     = useState(false);
  const [stats,         setStats]         = useState(getStats());
  const [cpuEnabled,    setCpuEnabled]    = useState(() => localStorage.getItem('gridlock-cpuEnabled') === 'true');
  const [cpuCount,      setCpuCount]      = useState(() => {
    const saved = parseInt(localStorage.getItem('gridlock-cpuCount'), 10);
    const validSaved = saved >= 1 && saved <= 3 ? saved : 1;
    const savedPlayerCount = parseInt(localStorage.getItem('gridlock-playerCount'), 10) || 2;
    return Math.min(validSaved, savedPlayerCount - 1);
  });
  const [cpuDifficulty, setCpuDifficulty] = useState(() => {
    const saved = localStorage.getItem('gridlock-cpuDifficulty');
    return ['easy', 'medium', 'hard'].includes(saved) ? saved : 'medium';
  });
  const [tournamentSize, setTournamentSize] = useState(() => {
    const saved = parseInt(localStorage.getItem('gridlock-tournamentSize'), 10);
    return [4, 8].includes(saved) ? saved : 4;
  });
  const [tournamentGridSize, setTournamentGridSize] = useState(() => {
    const saved = parseInt(localStorage.getItem('gridlock-tournamentGridSize'), 10);
    return saved >= 3 && saved <= 6 ? saved : 4;
  });
  const [tournamentId, setTournamentId]   = useState('');
  const [creatingTournament, setCreatingTournament] = useState(false);
  const [joiningTournament, setJoiningTournament]   = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(() => localStorage.getItem('gridlock_push') === 'true');
  const [quickPlaying, setQuickPlaying] = useState(false);
  const [queueSize, setQueueSize] = useState(1);
  const [usernameError, setUsernameError] = useState('');
  const [gameIdError, setGameIdError] = useState('');
  const [tournamentIdError, setTournamentIdError] = useState('');
  const navigate = useNavigate();

  // ── Socket: game_created ack ────────────────────────────────────────────────
  useEffect(() => {
    const onCreated = ({ gameId: gid, playerId, sessionToken }) => {
      setCreating(false);
      navigate('/game', {
        state: { username, gridSize, gameId: gid, role: playerId, avatar: selectedAvatar, playerCount, sessionToken },
      });
    };

    const onError = (msg) => {
      setCreating(false);
      setJoining(false);
      setCreatingTournament(false);
      setJoiningTournament(false);
      setUsernameError(typeof msg === 'string' ? msg : 'Something went wrong');
    };

    socket.on('game_created', onCreated);
    socket.on('error',        onError);
    return () => {
      socket.off('game_created', onCreated);
      socket.off('error',        onError);
    };
  }, [navigate, username, gridSize, selectedAvatar, playerCount]);

  // ── Socket: tournament events ─────────────────────────────────────────────
  useEffect(() => {
    const onTournamentCreated = ({ tournament }) => {
      setCreatingTournament(false);
      navigate('/tournament', {
        state: { tournament, tournamentId: tournament.tournamentId, username: username.trim(), avatar: selectedAvatar },
      });
    };

    const onTournamentJoined = ({ tournament }) => {
      setJoiningTournament(false);
      navigate('/tournament', {
        state: { tournament, tournamentId: tournament.tournamentId, username: username.trim(), avatar: selectedAvatar },
      });
    };

    socket.on('tournament_created', onTournamentCreated);
    socket.on('tournament_joined',  onTournamentJoined);
    return () => {
      socket.off('tournament_created', onTournamentCreated);
      socket.off('tournament_joined',  onTournamentJoined);
    };
  }, [navigate, username, selectedAvatar]);

  // ── Socket: Quick Play matchmaking events ─────────────────────────────────
  useEffect(() => {
    const onQueueMatched = ({ gameId: gid, playerId, sessionToken, gridSize: gs, playerCount: pc }) => {
      setQuickPlaying(false);
      navigate('/game', {
        state: {
          username: username.trim(),
          gridSize: gs,
          gameId: gid,
          role: playerId,
          avatar: selectedAvatar,
          playerCount: pc,
          sessionToken,
        },
      });
    };

    const onQueueStatus = ({ queueSize: qs }) => {
      setQueueSize(qs);
    };

    const onQueueTimeout = () => {
      // QuickPlay component handles UI — this is just for logging
    };

    socket.on('queue_matched', onQueueMatched);
    socket.on('queue_status', onQueueStatus);
    socket.on('queue_timeout', onQueueTimeout);
    return () => {
      socket.off('queue_matched', onQueueMatched);
      socket.off('queue_status', onQueueStatus);
      socket.off('queue_timeout', onQueueTimeout);
    };
  }, [navigate, username, selectedAvatar, gridSize, playerCount]);

  // ── Ref for unmount cleanup (captures latest quickPlaying value) ──────────
  const quickPlayingRef = useRef(quickPlaying);
  useEffect(() => { quickPlayingRef.current = quickPlaying; }, [quickPlaying]);

  // ── Cleanup: emit queue_leave on unmount if still in queue ──────────────
  useEffect(() => {
    return () => {
      if (quickPlayingRef.current) {
        socket.emit('queue_leave');
      }
    };
  }, []);

  // ── Persist lobby settings to localStorage ──────────────────────────────────
  useEffect(() => { safePersist('gridlock-avatar', selectedAvatar); }, [selectedAvatar]);
  useEffect(() => { safePersist('gridlock-gridSize', String(gridSize)); }, [gridSize]);
  useEffect(() => { safePersist('gridlock-playerCount', String(playerCount)); }, [playerCount]);
  useEffect(() => { safePersist('gridlock-cpuEnabled', String(cpuEnabled)); }, [cpuEnabled]);
  useEffect(() => { safePersist('gridlock-cpuCount', String(cpuCount)); }, [cpuCount]);
  useEffect(() => { safePersist('gridlock-cpuDifficulty', cpuDifficulty); }, [cpuDifficulty]);
  useEffect(() => { safePersist('gridlock-tournamentSize', String(tournamentSize)); }, [tournamentSize]);
  useEffect(() => { safePersist('gridlock-tournamentGridSize', String(tournamentGridSize)); }, [tournamentGridSize]);

  // Clamp cpuCount when playerCount changes (covers mount + runtime)
  useEffect(() => {
    const maxCpu = Math.max(1, playerCount - 1);
    if (cpuCount > maxCpu) setCpuCount(maxCpu);
  }, [playerCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PWA Install Prompt ──────────────────────────────────────────────────────
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;

    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  // ── Create Tournament ───────────────────────────────────────────────────────
  const handleCreateTournament = () => {
    const name = username.trim();
    const nameErr = validateUsername(username); if (nameErr) { setUsernameError(nameErr); return; }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    setCreatingTournament(true);
    socket.emit('create_tournament', { username: name, avatar: selectedAvatar, tournamentSize, gridSize: tournamentGridSize });
  };

  // ── Join Tournament ─────────────────────────────────────────────────────────
  const handleJoinTournament = () => {
    const name = username.trim();
    const id = tournamentId.trim().toUpperCase();
    const nameErr = validateUsername(username); if (nameErr) { setUsernameError(nameErr); return; }
    setUsernameError('');
    if (!id) { setTournamentIdError('Please enter a Tournament ID'); return; }
    setTournamentIdError('');
    if (!socket.connected) socket.connect();
    setJoiningTournament(true);
    socket.emit('join_tournament', { tournamentId: id, username: name, avatar: selectedAvatar });
  };

  // ── Quick Play ───────────────────────────────────────────────────────────
  const handleQuickPlay = () => {
    initAudio();
    const name = username.trim();
    const nameErr = validateUsername(username); if (nameErr) { setUsernameError(nameErr); return; }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    localStorage.setItem('gridlock_username', name);
    setQuickPlaying(true);
    setQueueSize(1);
    socket.emit('queue_join', { username: name, avatar: selectedAvatar, gridSize, playerCount });
  };

  const handleQuickPlayCancel = () => {
    socket.emit('queue_leave');
    setQuickPlaying(false);
  };

  const handleQuickPlayCPU = () => {
    socket.emit('queue_leave');
    setQuickPlaying(false);
    // Create a CPU game with current preferences
    const name = username.trim();
    const nameErr = validateUsername(username); if (nameErr) { setUsernameError(nameErr); return; }
    if (!socket.connected) socket.connect();
    setCreating(true);
    socket.emit('create_game', { gridSize, username: name, avatar: selectedAvatar, playerCount, cpuPlayers: playerCount - 1, cpuDifficulty: 'medium' }, (res) => {
      if (res?.error) {
        setCreating(false);
        setUsernameError(res.error);
        return;
      }
      if (res?.gameId) {
        setCreating(false);
        navigate('/game', {
          state: {
            username: name,
            gridSize,
            gameId: res.gameId,
            role: res.playerId,
            avatar: selectedAvatar,
            playerCount,
            sessionToken: res.sessionToken,
            cpuDifficulty: 'medium',
          },
        });
      } else {
        setCreating(false);
        setUsernameError('Failed to create CPU game. Please try again.');
      }
    });
  };

  // ── Create ──────────────────────────────────────────────────────────────────
  const handleCreate = () => {
    initAudio(); // Unlock AudioContext from user gesture (before gameplay)
    const name = username.trim();
    const nameErr = validateUsername(username); if (nameErr) { setUsernameError(nameErr); return; }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    setCreating(true);
    localStorage.setItem('gridlock_username', name);
    // Auto-prompt push subscription on first game action
    if (!localStorage.getItem('gridlock_push_prompted')) {
      localStorage.setItem('gridlock_push_prompted', 'true');
      subscribeToPush(name).then((sub) => {
        if (sub) { setPushEnabled(true); localStorage.setItem('gridlock_push', 'true'); }
      }).catch(() => {});
    }
    const cpuPlayers = cpuEnabled ? cpuCount : 0;
    socket.emit('create_game', { gridSize, username: name, avatar: selectedAvatar, playerCount, cpuPlayers, cpuDifficulty }, (res) => {
      if (res?.gameId) {
        setCreating(false);
        navigate('/game', {
          state: {
            username: name,
            gridSize,
            gameId: res.gameId,
            role: res.playerId,
            avatar: selectedAvatar,
            playerCount,
            sessionToken: res.sessionToken,
            cpuDifficulty: cpuEnabled ? cpuDifficulty : null,
          },
        });
      }
    });
  };

  // ── Join ────────────────────────────────────────────────────────────────────
  const handleJoin = () => {
    initAudio(); // Unlock AudioContext from user gesture (before gameplay)
    const name = username.trim();
    const id   = gameId.trim().toUpperCase();
    const nameErr = validateUsername(username); if (nameErr) { setUsernameError(nameErr); return; }
    setUsernameError('');
    if (!id) { setGameIdError('Please enter a Game ID'); return; }
    setGameIdError('');

    const tokenKey = `gridlock:session:${id}:${name}`;
    const existingToken = localStorage.getItem(tokenKey) || null;

    setJoining(true);
    localStorage.setItem('gridlock_username', name);
    // Auto-prompt push subscription on first game action
    if (!localStorage.getItem('gridlock_push_prompted')) {
      localStorage.setItem('gridlock_push_prompted', 'true');
      subscribeToPush(name).then((sub) => {
        if (sub) { setPushEnabled(true); localStorage.setItem('gridlock_push', 'true'); }
      }).catch(() => {});
    }
    if (!socket.connected) {
      socket.connect();
    }
    navigate('/game', {
      state: {
        username: name,
        gameId: id,
        role: joinMode === 'spectator' ? 'spectator' : 'player_joining',
        avatar: selectedAvatar,
        sessionToken: existingToken,
        joinMode,
      },
    });
  };

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex items-start justify-center p-3 pt-6 sm:p-4 sm:pt-8 sm:items-center safe-bottom lobby-container"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-lg md:max-w-[720px] lg:max-w-[960px]">

        {/* ── Title ── */}
        <div className="text-center mb-6">
          <h1 className="text-5xl sm:text-6xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent leading-tight">
            GridLock
          </h1>
          <p className="text-sm mt-1 tracking-widest uppercase" style={{ color: 'var(--label-color)' }}>Multiplayer · 2–4 Players</p>
        </div>

        {/* ── Card ── */}
        <div
          className="backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >

          {/* ── Username + Avatar ── */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Your Name</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setUsernameError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleJoin())}
              placeholder="Enter your name…"
              minLength={2}
              maxLength={16}
              pattern="[a-zA-Z0-9_\-]+"
              autoComplete="nickname"
              autoCorrect="off"
              autoCapitalize="words"
              spellCheck={false}
              inputMode="text"
              enterKeyHint={tab === 'create' ? 'done' : 'next'}
              className="w-full rounded-xl px-4 py-3 text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
              style={{
                background: 'var(--input-bg)',
                border: usernameError ? '1px solid var(--danger)' : '1px solid var(--border-color-strong)',
                color: 'var(--text-primary)',
              }}
            />
            <div className="flex justify-between mt-1">
              {usernameError ? (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>{usernameError}</p>
              ) : <span />}
              <p className="text-xs" style={{ color: username.length >= 14 ? 'var(--warning)' : 'var(--text-muted)' }}>
                {username.length}/16
              </p>
            </div>

            <label className="block text-xs font-bold uppercase tracking-wider mt-3 mb-1.5" style={{ color: 'var(--label-color)' }}>Pick Avatar</label>
            <div className="grid grid-cols-8 gap-1.5">
              {AVATARS.map((av) => (
                <button
                  key={av}
                  onClick={() => setSelectedAvatar(av)}
                  className={`aspect-square rounded-lg text-lg flex items-center justify-center transition-all active:scale-90 min-w-[44px] min-h-[44px] ${
                    selectedAvatar === av
                      ? 'ring-2 ring-offset-2 scale-110 shadow-lg'
                      : ''
                  }`}
                  style={selectedAvatar === av
                    ? { background: 'var(--accent)', '--tw-ring-color': 'var(--accent-hover)', '--tw-ring-offset-color': 'var(--bg-secondary)' }
                    : { background: 'var(--bg-card-hover)' }}
                >
                  {av}
                </button>
              ))}
            </div>
            {username && (
              <p className="text-center mt-2 text-xs lobby-playing-as" style={{ color: 'var(--text-muted)' }}>
                Playing as {selectedAvatar} <span className="font-bold lobby-username" style={{ color: 'var(--text-primary)' }}>{username}</span>
              </p>
            )}
          </div>

          {/* ── Quick Play Button ── */}
          <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={handleQuickPlay}
              disabled={quickPlaying || creating || !username.trim()}
              aria-label="Quick Play — instant match with random opponents"
              className="w-full py-3.5 rounded-xl font-bold text-base transition-all active:scale-95 min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-60"
              style={{
                background: (quickPlaying || creating)
                  ? 'var(--bg-surface)'
                  : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                color: (quickPlaying || creating) ? 'var(--text-muted)' : 'var(--text-on-accent)',
                boxShadow: (quickPlaying || creating) ? 'none' : '0 4px 16px color-mix(in srgb, var(--accent) 40%, transparent)',
              }}
            >
              {quickPlaying ? '⏳ Searching…' : '⚡ Quick Play'}
            </button>
            <p className="text-xs text-center mt-1.5" style={{ color: 'var(--text-secondary)' }}>
              Instant match with random opponents
            </p>
          </div>

          {/* ── Tabs ── */}
          <div className="flex" style={{ borderBottom: '1px solid var(--border-color)' }}>
            {[
              { key: 'create', label: '🎮 Create Game' },
              { key: 'join',   label: '🔗 Join Game' },
              { key: 'tournament', label: '🏆 Tournament' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 py-3 text-sm font-semibold transition-all ${
                  tab === key ? 'border-b-2' : ''
                }`}
                style={{
                  color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: tab === key ? 'var(--bg-card)' : 'transparent',
                  borderColor: tab === key ? 'var(--accent)' : 'transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Create Tab ── */}
          {tab === 'create' && (
            <div className="p-5 space-y-4">
              {/* Players */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>Number of Players</label>
                <div className="grid grid-cols-3 gap-2">
                  {PLAYER_COUNT_OPTIONS.map(({ value, label, icon, desc }) => (
                    <button
                      key={value}
                      onClick={() => {
                        setPlayerCount(value);
                        const maxCpu = Math.max(1, value - 1);
                        if (cpuCount > maxCpu) setCpuCount(maxCpu);
                      }}
                      className="py-2.5 px-2 rounded-xl text-center transition-all active:scale-95"
                      style={playerCount === value
                        ? { background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent)' }
                        : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                    >
                      <div className="text-lg">{icon}</div>
                      <div className="text-xs font-bold">{label}</div>
                      <div className="text-xs">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid size */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>Grid Size</label>
                <div className="grid grid-cols-4 gap-2">
                  {GRID_OPTIONS.map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => setGridSize(value)}
                      className="py-2 rounded-xl text-center transition-all active:scale-95"
                      style={gridSize === value
                        ? { background: 'var(--player4-color)', border: '1px solid var(--player4-color)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--player4-color) 30%, transparent)' }
                        : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                    >
                      <div className="text-sm font-bold">{label}</div>
                      <div className="text-xs">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* CPU Toggle */}
              <div>
                <button
                  onClick={() => setCpuEnabled(!cpuEnabled)}
                  className="w-full py-2.5 px-4 rounded-xl text-left transition-all active:scale-[0.98] flex items-center justify-between"
                  style={cpuEnabled
                    ? { background: 'color-mix(in srgb, var(--warning) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)', color: 'var(--warning)' }
                    : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-lg">🤖</span>
                    <span className="text-sm font-semibold">Play vs CPU</span>
                  </span>
                  <span className={`w-10 h-5 rounded-full transition-all flex items-center ${cpuEnabled ? 'justify-end' : 'justify-start'}`} style={{ background: cpuEnabled ? 'var(--warning)' : 'var(--bg-card-hover)' }}>
                    <span className="w-4 h-4 rounded-full shadow mx-0.5 transition-all" style={{ backgroundColor: 'var(--text-primary)' }} />
                  </span>
                </button>
              </div>

              {/* CPU Settings (visible when enabled) */}
              {cpuEnabled && (
                <div className="space-y-3 rounded-xl p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  {/* CPU count */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>
                      CPU Opponents ({cpuCount})
                    </label>
                    <div className="flex gap-2">
                      {Array.from({ length: playerCount - 1 }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          onClick={() => setCpuCount(n)}
                          className="flex-1 py-2 rounded-xl text-center text-sm font-bold transition-all active:scale-95"
                          style={cpuCount === n
                            ? { background: 'var(--warning)', border: '1px solid var(--warning)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--warning) 30%, transparent)' }
                            : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                        >
                          {n} 🤖
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Difficulty selector */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>Difficulty</label>
                    <div className="grid grid-cols-3 gap-2">
                      {DIFFICULTY_OPTIONS.map(({ value, label, icon, desc }) => (
                        <button
                          key={value}
                          onClick={() => setCpuDifficulty(value)}
                          className="py-2 px-2 rounded-xl text-center transition-all active:scale-95"
                          style={cpuDifficulty === value
                            ? { background: 'var(--warning)', border: '1px solid var(--warning)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--warning) 30%, transparent)' }
                            : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                        >
                          <div className="text-lg">{icon}</div>
                          <div className="text-xs font-bold">{label}</div>
                          <div className="text-xs">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={creating || !username.trim()}
                className="w-full py-3 rounded-xl font-bold text-[var(--text-on-accent)] text-sm transition-all active:scale-95 disabled:opacity-60"
                style={{ background: creating ? 'var(--bg-surface)' : 'linear-gradient(135deg, var(--accent), var(--player4-color))', ...(creating && { color: 'var(--text-muted)' }) }}
              >
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                    Creating…
                  </span>
                ) : (
                  '🚀 Create Game'
                )}
              </button>
            </div>
          )}

          {/* ── Join Tab ── */}
          {tab === 'join' && (
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Game ID</label>
                <input
                  type="text"
                  value={gameId}
                  onChange={(e) => { setGameId(e.target.value.toUpperCase()); setGameIdError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  placeholder="e.g. AB3XYZ"
                  maxLength={8}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="join"
                  className="w-full rounded-xl px-4 py-3 text-base font-mono uppercase placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
                  style={{
                    background: 'var(--input-bg)',
                    border: gameIdError ? '1px solid var(--danger)' : '1px solid var(--border-color-strong)',
                    color: 'var(--text-primary)',
                  }}
                />
                {gameIdError && (
                  <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{gameIdError}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setJoinMode('player')}
                  className="py-2 rounded-xl text-sm font-semibold transition-all"
                  style={joinMode === 'player'
                    ? { background: 'var(--success)', border: '1px solid var(--success)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--success) 30%, transparent)' }
                    : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                >
                  🎮 Join as Player
                </button>
                <button
                  onClick={() => setJoinMode('spectator')}
                  className="py-2 rounded-xl text-sm font-semibold transition-all"
                  style={joinMode === 'spectator'
                    ? { background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent)' }
                    : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                >
                  👀 Join as Spectator
                </button>
              </div>

              <button
                onClick={handleJoin}
                disabled={joining || !username.trim() || !gameId.trim()}
                className="w-full py-3 rounded-xl font-bold text-[var(--text-on-accent)] text-sm transition-all active:scale-95 disabled:opacity-60"
                style={{ background: joining ? 'var(--bg-surface)' : 'var(--success)', ...(joining && { color: 'var(--text-muted)' }) }}
              >
                {joining ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                    Joining…
                  </span>
                ) : (joinMode === 'spectator' ? '👀 Spectate Game' : '🔗 Join Game')}
              </button>

              <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                Ask the game creator for their room code
              </p>
            </div>
          )}

          {/* ── Tournament Tab ── */}
          {tab === 'tournament' && (
            <div className="p-5 space-y-4">
              {/* Create Tournament Section */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>Tournament Size</label>
                <div className="grid grid-cols-2 gap-2">
                  {TOURNAMENT_SIZE_OPTIONS.map(({ value, label, icon, desc }) => (
                    <button
                      key={value}
                      onClick={() => setTournamentSize(value)}
                      className="py-2.5 px-2 rounded-xl text-center transition-all active:scale-95"
                      style={tournamentSize === value
                        ? { background: 'var(--warning)', border: '1px solid var(--warning)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--warning) 30%, transparent)' }
                        : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                    >
                      <div className="text-lg">{icon}</div>
                      <div className="text-xs font-bold">{label}</div>
                      <div className="text-xs">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid size for tournament */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>Grid Size</label>
                <div className="grid grid-cols-4 gap-2">
                  {GRID_OPTIONS.map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => setTournamentGridSize(value)}
                      className="py-2 rounded-xl text-center transition-all active:scale-95"
                      style={tournamentGridSize === value
                        ? { background: 'var(--player4-color)', border: '1px solid var(--player4-color)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--player4-color) 30%, transparent)' }
                        : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                    >
                      <div className="text-sm font-bold">{label}</div>
                      <div className="text-xs">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleCreateTournament}
                disabled={creatingTournament || !username.trim()}
                className="w-full py-3 rounded-xl font-bold text-[var(--text-on-accent)] text-sm transition-all active:scale-95 disabled:opacity-60"
                style={{ background: creatingTournament ? 'var(--bg-surface)' : 'var(--warning)', ...(creatingTournament && { color: 'var(--text-muted)' }) }}
              >
                {creatingTournament ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                    Creating…
                  </span>
                ) : (
                  '🏆 Create Tournament'
                )}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1" style={{ borderTop: '1px solid var(--border-color)' }} />
                <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-subtle)' }}>or join</span>
                <div className="flex-1" style={{ borderTop: '1px solid var(--border-color)' }} />
              </div>

              {/* Join Tournament */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Tournament ID</label>
                <input
                  type="text"
                  value={tournamentId}
                  onChange={(e) => { setTournamentId(e.target.value.toUpperCase()); setTournamentIdError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinTournament()}
                  placeholder="e.g. AB3XYZ"
                  maxLength={8}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="join"
                  className="w-full rounded-xl px-4 py-3 text-base font-mono uppercase placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
                  style={{
                    background: 'var(--input-bg)',
                    border: tournamentIdError ? '1px solid var(--danger)' : '1px solid var(--border-color-strong)',
                    color: 'var(--text-primary)',
                  }}
                />
                {tournamentIdError && (
                  <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{tournamentIdError}</p>
                )}
              </div>

              <button
                onClick={handleJoinTournament}
                disabled={joiningTournament || !username.trim() || !tournamentId.trim()}
                className="w-full py-3 rounded-xl font-bold text-[var(--text-on-accent)] text-sm transition-all active:scale-95 disabled:opacity-60"
                style={{ background: joiningTournament ? 'var(--bg-surface)' : 'var(--success)', ...(joiningTournament && { color: 'var(--text-muted)' }) }}
              >
                {joiningTournament ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                    Joining…
                  </span>
                ) : (
                  '🔗 Join Tournament'
                )}
              </button>

              <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                Single-elimination bracket · Winner takes all 🏆
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-secondary)' }}>GridLock · Real-time Multiplayer</p>

        {/* ── Theme Toggle + PWA Install Button ── */}
        <div className="flex items-center justify-center gap-2 mt-3">
          <ThemeToggle />
          {installPrompt && (
            <button
              onClick={handleInstall}
              className="py-2.5 px-4 rounded-xl text-sm font-semibold transition-all active:scale-95 flex items-center gap-2"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
            >
              📲 Install App
            </button>
          )}
        </div>

        {/* ── Push Notification Toggle ── */}
        <div className="flex items-center justify-between mt-3 px-1">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>🔔 Push Notifications</span>
          <button
            onClick={async () => {
              const name = username.trim();
              if (!pushEnabled) {
                const nameErr = validateUsername(username); if (nameErr) { setUsernameError(nameErr); return; }
                try {
                  const sub = await subscribeToPush(name);
                  if (sub) { setPushEnabled(true); localStorage.setItem('gridlock_push', 'true'); }
                } catch { /* push subscribe failed — ignore */ }
              } else {
                try {
                  await unsubscribeFromPush();
                } catch { /* push unsubscribe failed — ignore */ }
                setPushEnabled(false);
                localStorage.removeItem('gridlock_push');
              }
            }}
            className="relative w-10 h-5 rounded-full transition-colors flex items-center px-0.5 cursor-pointer"
            style={{ backgroundColor: pushEnabled ? 'var(--warning)' : 'var(--bg-card-hover)' }}
            aria-label="Toggle push notifications"
          >
            <div
              className={`w-4 h-4 rounded-full shadow transition-transform ${
                pushEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
              style={{ backgroundColor: 'var(--text-primary)' }}
            />
          </button>
        </div>

        {/* ── Sound & Haptic Settings ── */}
        <SoundSettings />

        {/* ── Session Stats Panel ── */}
        <div className="mt-3">
          <button
            onClick={() => {
              const next = !showStats;
              if (next) setStats(getStats()); // refresh on open, not via useEffect
              setShowStats(next);
            }}
            className="w-full py-2 text-xs font-semibold transition-all flex items-center justify-center gap-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>📊 Your Stats</span>
            <span>{showStats ? '▲' : '▼'}</span>
          </button>

          {showStats && (
            <div className="backdrop-blur-md rounded-2xl p-4 mt-1 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              {stats.gamesPlayed === 0 ? (
                <p className="text-center text-xs py-2" style={{ color: 'var(--text-subtle)' }}>No games played yet this session.</p>
              ) : (
                <>
                  {/* Summary row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Games', value: stats.gamesPlayed },
                      { label: 'Wins', value: stats.wins },
                      { label: 'Win Rate', value: getWinRate() },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl py-2" style={{ background: 'var(--bg-card-hover)' }}>
                        <div className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{value}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Avg Territory', value: getAvgTerritory() },
                      { label: 'Best Territory', value: `${stats.bestTerritory}%` },
                      { label: 'Best Streak', value: `${stats.bestStreak} 🔥` },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl py-2" style={{ background: 'var(--bg-card-hover)' }}>
                        <div className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{value}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Current streak */}
                  {stats.currentStreak > 0 && (
                    <div className="text-center text-sm font-bold" style={{ color: 'var(--warning)' }}>
                      🔥 {stats.currentStreak} game win streak!
                    </div>
                  )}

                  {/* Last 5 games */}
                  {stats.history.length > 0 && (
                    <div>
                      <p className="text-xs mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Last {Math.min(stats.history.length, 5)} Games</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {stats.history.slice(0, 5).map((g, i) => (
                          <div
                            key={i}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold"
                            style={
                              g.outcome === 'win'
                                ? { backgroundColor: 'color-mix(in srgb, var(--success) 25%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)' }
                                : g.outcome === 'draw'
                                ? { backgroundColor: 'color-mix(in srgb, var(--warning) 25%, transparent)', color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }
                                : { backgroundColor: 'color-mix(in srgb, var(--danger) 25%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }
                            }
                            title={`${g.gridSize}×${g.gridSize} · ${g.players}P`}
                          >
                            {g.outcome === 'win' ? 'W' : g.outcome === 'draw' ? 'D' : 'L'} {g.territoryPct}%
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reset */}
                  <button
                    onClick={() => { resetStats(); setStats(getStats()); }}
                    className="w-full text-xs transition-all py-1"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    Reset stats
                  </button>
                </>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Quick Play Overlay ── */}
      {quickPlaying && (
        <QuickPlay
          gridSize={gridSize}
          playerCount={playerCount}
          queueSize={queueSize}
          onCancel={handleQuickPlayCancel}
          onPlayCPU={handleQuickPlayCPU}
        />
      )}
    </div>
  );
};

export default Lobby;
