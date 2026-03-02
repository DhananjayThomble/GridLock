// src/components/Lobby.jsx
// Production-ready lobby — mobile-first, fully adaptive

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import { getStats, getWinRate, getAvgTerritory, resetStats } from '../utils/sessionStats';

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

const Lobby = () => {
  const [username,      setUsername]      = useState('');
  const [gridSize,      setGridSize]      = useState(3);
  const [playerCount,   setPlayerCount]   = useState(2);
  const [selectedAvatar, setSelectedAvatar] = useState('👦');
  const [gameId,        setGameId]        = useState('');
  const [creating,      setCreating]      = useState(false);
  const [joining,       setJoining]       = useState(false);
  const [tab,           setTab]           = useState('create'); // 'create' | 'join'
  const [showStats,     setShowStats]     = useState(false);
  const [stats,         setStats]         = useState(getStats());
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
      alert(typeof msg === 'string' ? msg : 'Something went wrong');
    };

    socket.on('game_created', onCreated);
    socket.on('error',        onError);
    return () => {
      socket.off('game_created', onCreated);
      socket.off('error',        onError);
    };
  }, [navigate, username, gridSize, selectedAvatar, playerCount]);

  // ── Create ──────────────────────────────────────────────────────────────────
  const handleCreate = () => {
    const name = username.trim();
    if (!name) return alert('Please enter a username');
    if (!socket.connected) socket.connect();
    setCreating(true);
    socket.emit('create_game', { gridSize, username: name, avatar: selectedAvatar, playerCount }, (res) => {
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
          },
        });
      }
    });
  };

  // ── Join ────────────────────────────────────────────────────────────────────
  const handleJoin = () => {
    const name = username.trim();
    const id   = gameId.trim().toUpperCase();
    if (!name) return alert('Please enter a username');
    if (!id)   return alert('Please enter a Game ID');

    const tokenKey = `gridlock:session:${id}:${name}`;
    const existingToken = localStorage.getItem(tokenKey) || null;

    setJoining(true);
    navigate('/game', {
      state: {
        username: name,
        gameId: id,
        role: 'player_joining',
        avatar: selectedAvatar,
        sessionToken: existingToken,
      },
    });
  };

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-start justify-center p-4 pt-8 sm:items-center sm:pt-4">
      <div className="w-full max-w-lg">

        {/* ── Title ── */}
        <div className="text-center mb-6">
          <h1 className="text-5xl sm:text-6xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent leading-tight">
            Dots &amp; Boxes
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
              className="w-full bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
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
                      onClick={() => setPlayerCount(value)}
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
                  className="w-full bg-white/10 border border-white/20 text-white placeholder-white/40 rounded-xl px-4 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-green-400 transition"
                />
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
                ) : '🔗 Join Game'}
              </button>

              <p className="text-white/40 text-xs text-center">
                Ask the game creator for their room code
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-white/20 text-xs mt-4">GridLock Beta · Real-time Multiplayer</p>

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
