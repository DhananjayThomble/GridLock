// src/components/Lobby.jsx
// Production-ready lobby — mobile-first, fully adaptive

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { initAudio } from '../utils/sounds';
import socket from '../socket';
import { getStats, getWinRate, getAvgTerritory, resetStats } from '../utils/sessionStats';
import { subscribeToPush, unsubscribeFromPush } from '../utils/pushManager';

const AVATARS = ['👦','👧','🧑','👩','🤖','🐱','🐶','🦊','🐻','🐼','🦁','🐯','🚀','⚽','🎮','🦄'];

const PLAYER_COUNT_OPTIONS = [
  { value: 2, label: '2 Players', icon: '👥', desc: 'Classic duel' },
  { value: 3, label: '3 Players', icon: '👨‍👩‍👦', desc: 'Triple threat' },
  { value: 4, label: '4 Players', icon: '👨‍👩‍👧‍👦', desc: 'Party mode' },
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

const Lobby = () => {
  const [username,      setUsername]      = useState(() => localStorage.getItem('gridlock_username') || '');
  const [gridSize,      setGridSize]      = useState(3);
  const [playerCount,   setPlayerCount]   = useState(2);
  const [selectedAvatar, setSelectedAvatar] = useState('👦');
  const [gameId,        setGameId]        = useState('');
  const [creating,      setCreating]      = useState(false);
  const [joining,       setJoining]       = useState(false);
  const [joinMode,      setJoinMode]      = useState('player'); // 'player' | 'spectator'
  const [tab,           setTab]           = useState('create'); // 'create' | 'join' | 'tournament'
  const [showStats,     setShowStats]     = useState(false);
  const [stats,         setStats]         = useState(getStats());
  const [cpuEnabled,    setCpuEnabled]    = useState(false);
  const [cpuCount,      setCpuCount]      = useState(1);
  const [cpuDifficulty, setCpuDifficulty] = useState('medium');
  const [tournamentSize, setTournamentSize] = useState(4);
  const [tournamentGridSize, setTournamentGridSize] = useState(4);
  const [tournamentId, setTournamentId]   = useState('');
  const [creatingTournament, setCreatingTournament] = useState(false);
  const [joiningTournament, setJoiningTournament]   = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(() => localStorage.getItem('gridlock_push') === 'true');
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
      alert(typeof msg === 'string' ? msg : 'Something went wrong');
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
    if (!name) return alert('Please enter a username');
    if (!socket.connected) socket.connect();
    setCreatingTournament(true);
    socket.emit('create_tournament', { username: name, avatar: selectedAvatar, tournamentSize, gridSize: tournamentGridSize });
  };

  // ── Join Tournament ─────────────────────────────────────────────────────────
  const handleJoinTournament = () => {
    const name = username.trim();
    const id = tournamentId.trim().toUpperCase();
    if (!name) return alert('Please enter a username');
    if (!id) return alert('Please enter a Tournament ID');
    if (!socket.connected) socket.connect();
    setJoiningTournament(true);
    socket.emit('join_tournament', { tournamentId: id, username: name, avatar: selectedAvatar });
  };

  // ── Create ──────────────────────────────────────────────────────────────────
  const handleCreate = () => {
    initAudio(); // Unlock AudioContext from user gesture (before gameplay)
    const name = username.trim();
    if (!name) return alert('Please enter a username');
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
    if (!name) return alert('Please enter a username');
    if (!id)   return alert('Please enter a Game ID');

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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-start justify-center p-3 pt-6 sm:p-4 sm:pt-8 sm:items-center safe-bottom">
      <div className="w-full max-w-lg">

        {/* ── Title ── */}
        <div className="text-center mb-6">
          <h1 className="text-5xl sm:text-6xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent leading-tight">
            GridLock
          </h1>
          <p className="text-blue-300 text-sm mt-1 tracking-widest uppercase">Multiplayer · 2–4 Players</p>
          <div className="flex justify-center gap-3 mt-3 text-xl">
            {['•','━','•','━','•'].map((c, i) => (
              <span key={i} className={c === '•' ? 'animate-bounce inline-block text-blue-400' : 'text-gray-600'} style={{ animationDelay: `${i * 0.1}s` }}>{c}</span>
            ))}
          </div>
        </div>

        {/* ── Card ── */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 overflow-hidden shadow-2xl">

          {/* ── Username + Avatar ── */}
          <div className="p-5 border-b border-white/10">
            <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-1.5">Your Name</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleJoin())}
              placeholder="Enter your name…"
              maxLength={20}
              autoComplete="nickname"
              autoCorrect="off"
              autoCapitalize="words"
              spellCheck={false}
              inputMode="text"
              enterKeyHint={tab === 'create' ? 'done' : 'next'}
              className="w-full bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
            />

            <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mt-3 mb-1.5">Pick Avatar</label>
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
            {username && (
              <p className="text-center mt-2 text-white/60 text-xs">
                Playing as {selectedAvatar} <span className="font-bold text-white">{username}</span>
              </p>
            )}
          </div>

          {/* ── Tabs ── */}
          <div className="flex border-b border-white/10">
            {[
              { key: 'create', label: '🎮 Create Game' },
              { key: 'join',   label: '🔗 Join Game' },
              { key: 'tournament', label: '🏆 Tournament' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 py-3 text-sm font-semibold transition-all ${
                  tab === key
                    ? 'text-white border-b-2 border-blue-400 bg-white/5'
                    : 'text-white/50 hover:text-white/80'
                }`}
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
                <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-2">Number of Players</label>
                <div className="grid grid-cols-3 gap-2">
                  {PLAYER_COUNT_OPTIONS.map(({ value, label, icon, desc }) => (
                    <button
                      key={value}
                      onClick={() => {
                        setPlayerCount(value);
                        // Clamp cpuCount when playerCount shrinks
                        const maxCpu = Math.max(1, value - 1);
                        if (cpuCount > maxCpu) setCpuCount(maxCpu);
                      }}
                      className={`py-2.5 px-2 rounded-xl border text-center transition-all active:scale-95 ${
                        playerCount === value
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg'
                          : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-lg">{icon}</div>
                      <div className="text-xs font-bold">{label}</div>
                      <div className="text-xs opacity-70">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid size */}
              <div>
                <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-2">Grid Size</label>
                <div className="grid grid-cols-4 gap-2">
                  {GRID_OPTIONS.map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => setGridSize(value)}
                      className={`py-2 rounded-xl border text-center transition-all active:scale-95 ${
                        gridSize === value
                          ? 'bg-purple-500 border-purple-400 text-white shadow-lg'
                          : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-sm font-bold">{label}</div>
                      <div className="text-xs opacity-70">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* CPU Toggle */}
              <div>
                <button
                  onClick={() => setCpuEnabled(!cpuEnabled)}
                  className={`w-full py-2.5 px-4 rounded-xl border text-left transition-all active:scale-[0.98] flex items-center justify-between ${
                    cpuEnabled
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                      : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-lg">🤖</span>
                    <span className="text-sm font-semibold">Play vs CPU</span>
                  </span>
                  <span className={`w-10 h-5 rounded-full transition-all flex items-center ${
                    cpuEnabled ? 'bg-amber-400 justify-end' : 'bg-white/20 justify-start'
                  }`}>
                    <span className="w-4 h-4 rounded-full bg-white shadow mx-0.5 transition-all" />
                  </span>
                </button>
              </div>

              {/* CPU Settings (visible when enabled) */}
              {cpuEnabled && (
                <div className="space-y-3 bg-white/5 rounded-xl p-3 border border-white/10">
                  {/* CPU count */}
                  <div>
                    <label className="block text-amber-200 text-xs font-bold uppercase tracking-wider mb-2">
                      CPU Opponents ({cpuCount})
                    </label>
                    <div className="flex gap-2">
                      {Array.from({ length: playerCount - 1 }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          onClick={() => setCpuCount(n)}
                          className={`flex-1 py-2 rounded-xl border text-center text-sm font-bold transition-all active:scale-95 ${
                            cpuCount === n
                              ? 'bg-amber-500 border-amber-400 text-white shadow-lg'
                              : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                          }`}
                        >
                          {n} 🤖
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Difficulty selector */}
                  <div>
                    <label className="block text-amber-200 text-xs font-bold uppercase tracking-wider mb-2">Difficulty</label>
                    <div className="grid grid-cols-3 gap-2">
                      {DIFFICULTY_OPTIONS.map(({ value, label, icon, desc }) => (
                        <button
                          key={value}
                          onClick={() => setCpuDifficulty(value)}
                          className={`py-2 px-2 rounded-xl border text-center transition-all active:scale-95 ${
                            cpuDifficulty === value
                              ? 'bg-amber-500 border-amber-400 text-white shadow-lg'
                              : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                          }`}
                        >
                          <div className="text-lg">{icon}</div>
                          <div className="text-xs font-bold">{label}</div>
                          <div className="text-xs opacity-70">{desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 disabled:opacity-60"
                style={{ background: creating ? '#6b7280' : 'linear-gradient(135deg,#3B82F6,#8B5CF6)' }}
              >
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
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
                <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-1.5">Game ID</label>
                <input
                  type="text"
                  value={gameId}
                  onChange={(e) => setGameId(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  placeholder="e.g. AB3XYZ"
                  maxLength={8}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="join"
                  className="w-full bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl px-4 py-3 text-base font-mono uppercase focus:outline-none focus:ring-2 focus:ring-green-400 transition"
                />
              </div>


              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setJoinMode('player')}
                  className={`py-2 rounded-xl border text-sm font-semibold transition-all ${joinMode === 'player'
                    ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg'
                    : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'}`}
                >
                  🎮 Join as Player
                </button>
                <button
                  onClick={() => setJoinMode('spectator')}
                  className={`py-2 rounded-xl border text-sm font-semibold transition-all ${joinMode === 'spectator'
                    ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg'
                    : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'}`}
                >
                  👀 Join as Spectator
                </button>
              </div>

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
                ) : (joinMode === 'spectator' ? '👀 Spectate Game' : '🔗 Join Game')}
              </button>

              <p className="text-white/40 text-xs text-center">
                Ask the game creator for their room code
              </p>
            </div>
          )}

          {/* ── Tournament Tab ── */}
          {tab === 'tournament' && (
            <div className="p-5 space-y-4">
              {/* Create Tournament Section */}
              <div>
                <label className="block text-yellow-200 text-xs font-bold uppercase tracking-wider mb-2">Tournament Size</label>
                <div className="grid grid-cols-2 gap-2">
                  {TOURNAMENT_SIZE_OPTIONS.map(({ value, label, icon, desc }) => (
                    <button
                      key={value}
                      onClick={() => setTournamentSize(value)}
                      className={`py-2.5 px-2 rounded-xl border text-center transition-all active:scale-95 ${
                        tournamentSize === value
                          ? 'bg-yellow-500 border-yellow-400 text-white shadow-lg'
                          : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-lg">{icon}</div>
                      <div className="text-xs font-bold">{label}</div>
                      <div className="text-xs opacity-70">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid size for tournament */}
              <div>
                <label className="block text-yellow-200 text-xs font-bold uppercase tracking-wider mb-2">Grid Size</label>
                <div className="grid grid-cols-4 gap-2">
                  {GRID_OPTIONS.map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => setTournamentGridSize(value)}
                      className={`py-2 rounded-xl border text-center transition-all active:scale-95 ${
                        tournamentGridSize === value
                          ? 'bg-purple-500 border-purple-400 text-white shadow-lg'
                          : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-sm font-bold">{label}</div>
                      <div className="text-xs opacity-70">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleCreateTournament}
                disabled={creatingTournament}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 disabled:opacity-60"
                style={{ background: creatingTournament ? '#6b7280' : 'linear-gradient(135deg,#F59E0B,#D97706)' }}
              >
                {creatingTournament ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Creating…
                  </span>
                ) : (
                  '🏆 Create Tournament'
                )}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-white/10" />
                <span className="text-white/30 text-xs font-bold uppercase">or join</span>
                <div className="flex-1 border-t border-white/10" />
              </div>

              {/* Join Tournament */}
              <div>
                <label className="block text-yellow-200 text-xs font-bold uppercase tracking-wider mb-1.5">Tournament ID</label>
                <input
                  type="text"
                  value={tournamentId}
                  onChange={(e) => setTournamentId(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinTournament()}
                  placeholder="e.g. AB3XYZ"
                  maxLength={8}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="join"
                  className="w-full bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl px-4 py-3 text-base font-mono uppercase focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
                />
              </div>

              <button
                onClick={handleJoinTournament}
                disabled={joiningTournament}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 disabled:opacity-60"
                style={{ background: joiningTournament ? '#6b7280' : 'linear-gradient(135deg,#10B981,#059669)' }}
              >
                {joiningTournament ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Joining…
                  </span>
                ) : (
                  '🔗 Join Tournament'
                )}
              </button>

              <p className="text-white/40 text-xs text-center">
                Single-elimination bracket · Winner takes all 🏆
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-white/20 text-xs mt-4">GridLock Beta · Real-time Multiplayer</p>

        {/* ── PWA Install Button ── */}
        {installPrompt && (
          <button
            onClick={handleInstall}
            className="w-full mt-2 py-2.5 rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm font-semibold transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            📲 Install App
          </button>
        )}

        {/* ── Push Notification Toggle ── */}
        <div className="flex items-center justify-between mt-3 px-1">
          <span className="text-white/50 text-xs font-medium">🔔 Push Notifications</span>
          <button
            onClick={async () => {
              const name = username.trim();
              if (!pushEnabled) {
                if (!name) return alert('Enter a username first');
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
            style={{ backgroundColor: pushEnabled ? '#FBBF24' : 'rgba(255,255,255,0.2)' }}
            aria-label="Toggle push notifications"
          >
            <div
              className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${
                pushEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* ── Session Stats Panel ── */}
        <div className="mt-3">
          <button
            onClick={() => {
              const next = !showStats;
              if (next) setStats(getStats()); // refresh on open, not via useEffect
              setShowStats(next);
            }}
            className="w-full py-2 text-xs font-semibold text-white/40 hover:text-white/70 transition-all flex items-center justify-center gap-2"
          >
            <span>📊 Your Stats</span>
            <span>{showStats ? '▲' : '▼'}</span>
          </button>

          {showStats && (
            <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-4 mt-1 space-y-3">
              {stats.gamesPlayed === 0 ? (
                <p className="text-center text-white/30 text-xs py-2">No games played yet this session.</p>
              ) : (
                <>
                  {/* Summary row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Games', value: stats.gamesPlayed },
                      { label: 'Wins', value: stats.wins },
                      { label: 'Win Rate', value: getWinRate() },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-white/10 rounded-xl py-2">
                        <div className="text-white font-bold text-lg">{value}</div>
                        <div className="text-white/40 text-xs">{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Avg Territory', value: getAvgTerritory() },
                      { label: 'Best Territory', value: `${stats.bestTerritory}%` },
                      { label: 'Best Streak', value: `${stats.bestStreak} 🔥` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-white/10 rounded-xl py-2">
                        <div className="text-white font-bold text-sm">{value}</div>
                        <div className="text-white/40 text-xs">{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Current streak */}
                  {stats.currentStreak > 0 && (
                    <div className="text-center text-yellow-400 text-sm font-bold">
                      🔥 {stats.currentStreak} game win streak!
                    </div>
                  )}

                  {/* Last 5 games */}
                  {stats.history.length > 0 && (
                    <div>
                      <p className="text-white/40 text-xs mb-1.5 uppercase tracking-wider">Last {Math.min(stats.history.length, 5)} Games</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {stats.history.slice(0, 5).map((g, i) => (
                          <div
                            key={i}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                              g.outcome === 'win'
                                ? 'bg-green-500/30 text-green-300 border border-green-500/30'
                                : g.outcome === 'draw'
                                ? 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/30'
                                : 'bg-red-500/30 text-red-300 border border-red-500/30'
                            }`}
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
                    className="w-full text-xs text-white/20 hover:text-white/50 transition-all py-1"
                  >
                    Reset stats
                  </button>
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default Lobby;
