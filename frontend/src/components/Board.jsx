// src/components/Board.jsx
// Production-ready Board for GridLock - supports 2-4 players
// Adaptive layout: mobile / tablet / desktop

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import socket from '../socket';
import { recordGame } from '../utils/sessionStats';

// ─── Player config ────────────────────────────────────────────────────────────
const PLAYER_CONFIG = {
  player1: { color: '#3B82F6', bg: 'bg-blue-500',   light: 'bg-blue-100',   border: 'border-blue-500',   text: 'text-blue-600',   label: 'P1' },
  player2: { color: '#EF4444', bg: 'bg-red-500',    light: 'bg-red-100',    border: 'border-red-500',    text: 'text-red-600',    label: 'P2' },
  player3: { color: '#10B981', bg: 'bg-emerald-500', light: 'bg-emerald-100', border: 'border-emerald-500', text: 'text-emerald-600', label: 'P3' },
  player4: { color: '#A855F7', bg: 'bg-purple-500',  light: 'bg-purple-100',  border: 'border-purple-500',  text: 'text-purple-600',  label: 'P4' },
};

const getConfig = (playerId) => PLAYER_CONFIG[playerId] || PLAYER_CONFIG.player1;

// ─── Responsive sizing hook ───────────────────────────────────────────────────
function useGridSizes(gridSize) {
  const [sizes, setSizes] = useState({ dot: 8, line: 48, box: 48 });

  useEffect(() => {
    function calculate() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Reserve space: header ~160px mobile, ~200px desktop; footer ~80px
      const reservedH = w < 640 ? 260 : 280;
      const reservedW = w < 640 ? 32 : 64;

      const availW = w - reservedW;
      const availH = h - reservedH;
      const cells = gridSize || 3;
      const units = cells * 2 + 1; // grid units (dots + lines/boxes)

      const fromW = Math.floor(availW / units);
      const fromH = Math.floor(availH / units);
      let box = Math.min(fromW, fromH);
      box = Math.max(28, Math.min(box, 80)); // clamp 28–80

      const dot = Math.max(6, Math.round(box * 0.18));
      setSizes({ dot, line: box, box });
    }
    calculate();
    window.addEventListener('resize', calculate);
    return () => window.removeEventListener('resize', calculate);
  }, [gridSize]);

  return sizes;
}

// ─── Main Component ───────────────────────────────────────────────────────────
const Board = () => {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { username, role, gameId, gridSize, avatar, playerCount } = location.state || {};

  const [gameState,      setGameState]      = useState(null);
  const [error,          setError]          = useState(null);
  const [status,         setStatus]         = useState('Connecting…');
  const [showWinner,     setShowWinner]     = useState(false);
  const [winnerData,     setWinnerData]     = useState(null);
  const [waitingCount,   setWaitingCount]   = useState(0);
  const [showCopied,     setShowCopied]     = useState(false);

  // Prevent double-recording stats on reconnect (game_update can re-fire with gameOver: true)
  const gameOverRecorded = useRef(false);

  const sizes = useGridSizes(gridSize);

  // ── Status helper ────────────────────────────────────────────────────────────
  const getStatusFromState = useCallback((gs) => {
    if (!gs) return 'Waiting…';
    const name = gs[`${gs.currentPlayer}Name`] || gs.currentPlayer;
    return gs.currentPlayer === role ? '⚡ Your turn!' : `⏳ ${name}'s turn`;
  }, [role]);

  // ── Socket events ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || !username) { navigate('/'); return; }

    const onGameStarted = (data) => {
      const gs = data.gameState;
      setGameState(gs);
      // Count how many slots are still waiting
      const count = data.playerCount || 2;
      let filled = 0;
      for (let i = 1; i <= count; i++) {
        if (gs[`player${i}Name`] && !gs[`player${i}Name`].startsWith('Waiting')) filled++;
      }
      setWaitingCount(count - filled);
      setStatus(filled < count ? `⏳ Waiting for ${count - filled} more player(s)…` : getStatusFromState(gs));
    };

    const onAllJoined = () => {
      setWaitingCount(0);
    };

    const onGameUpdate = (data) => {
      const gs = data.gameState;
      setGameState(gs);
      setWaitingCount(0);

      if (gs.gameOver || gs.winner) {
        const winner = gs.winner;

        // Record session stats exactly once (guard against reconnect re-fires)
        if (!gameOverRecorded.current) {
          gameOverRecorded.current = true;
          const myScore = gs.scores?.[role] || 0;
          const totalBoxes = (gridSize || 3) * (gridSize || 3);
          const territoryPct = Math.round((myScore / totalBoxes) * 100);
          const outcome = winner === 'draw' ? 'draw' : winner === role ? 'win' : 'loss';
          recordGame(outcome, territoryPct, gs.playerCount || 2, gridSize || 3);
        }

        if (winner === 'draw') {
          setWinnerData({ isDraw: true, scores: gs.scores, playerCount: gs.playerCount || 2 });
        } else {
          const cfg = getConfig(winner);
          setWinnerData({
            isDraw:   false,
            name:     gs[`${winner}Name`]   || winner,
            avatar:   gs[`${winner}Avatar`] || '🏆',
            color:    cfg.color,
            scores:   gs.scores,
            playerCount: gs.playerCount || 2,
            winner,
          });
        }
        setShowWinner(true);
        setStatus('🎉 Game Over!');
      } else {
        setStatus(getStatusFromState(gs));
      }
    };

    const onError = (msg) => { setError(typeof msg === 'string' ? msg : JSON.stringify(msg)); };

    socket.on('game_started',      onGameStarted);
    socket.on('all_players_joined', onAllJoined);
    socket.on('game_update',       onGameUpdate);
    socket.on('error',             onError);

    // Join / re-join room
    socket.emit('join_game', { gameId, username, avatar });

    return () => {
      socket.off('game_started',       onGameStarted);
      socket.off('all_players_joined', onAllJoined);
      socket.off('game_update',        onGameUpdate);
      socket.off('error',              onError);
    };
  }, [gameId, username, navigate, role, avatar, getStatusFromState]);

  // ── Move handler ──────────────────────────────────────────────────────────────
  const handleLineClick = useCallback((type, r, c) => {
    if (!gameState || gameState.currentPlayer !== role) return;
    socket.emit('make_move', { gameId, playerId: role, type, r, c });
  }, [gameState, role, gameId]);

  // ── Copy game ID ──────────────────────────────────────────────────────────────
  const handleCopyId = () => {
    navigator.clipboard?.writeText(gameId).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  };

  // ── Render helpers ────────────────────────────────────────────────────────────
  const getLineColor = (owner) => {
    if (!owner) return null;
    return getConfig(owner).color;
  };

  const renderDot = (key) => (
    <div
      key={key}
      style={{ width: sizes.dot, height: sizes.dot, flexShrink: 0 }}
      className="flex items-center justify-center z-10"
    >
      <div
        className="rounded-full bg-gray-800 shadow"
        style={{ width: sizes.dot - 2, height: sizes.dot - 2 }}
      />
    </div>
  );

  const renderHLine = (r, c) => {
    const owner = gameState.horizontalLines[r]?.[c];
    const isMyTurn = gameState.currentPlayer === role && !owner;
    const lineColor = getLineColor(owner);

    return (
      <div
        key={`h-${r}-${c}`}
        style={{ width: sizes.line, height: sizes.dot, flexShrink: 0 }}
        className="flex items-center px-0.5"
      >
        <div
          onClick={() => handleLineClick('horizontal', r, c)}
          className={`h-2 w-full rounded transition-all duration-150 ${
            owner ? '' : isMyTurn ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
          }`}
          style={{
            backgroundColor: lineColor || '#E5E7EB',
            opacity: owner ? 1 : isMyTurn ? undefined : 0.5,
          }}
        />
      </div>
    );
  };

  const renderVLine = (r, c) => {
    const owner = gameState.verticalLines[r]?.[c];
    const isMyTurn = gameState.currentPlayer === role && !owner;
    const lineColor = getLineColor(owner);

    return (
      <div
        key={`v-${r}-${c}`}
        style={{ width: sizes.dot, height: sizes.line, flexShrink: 0 }}
        className="flex justify-center py-0.5"
      >
        <div
          onClick={() => handleLineClick('vertical', r, c)}
          className={`w-2 h-full rounded transition-all duration-150 ${
            owner ? '' : isMyTurn ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
          }`}
          style={{
            backgroundColor: lineColor || '#E5E7EB',
            opacity: owner ? 1 : isMyTurn ? undefined : 0.5,
          }}
        />
      </div>
    );
  };

  const renderBox = (r, c) => {
    const owner = gameState.boxes[r]?.[c];
    const cfg   = owner ? getConfig(owner) : null;
    const ownerAvatar = owner ? (gameState[`${owner}Avatar`] || cfg.label) : null;

    return (
      <div
        key={`b-${r}-${c}`}
        style={{ width: sizes.line, height: sizes.line, flexShrink: 0 }}
        className="flex items-center justify-center"
      >
        <div
          className={`w-full h-full flex items-center justify-center rounded transition-all duration-300 ${
            cfg ? cfg.light : ''
          }`}
        >
          {ownerAvatar && (
            <span style={{ fontSize: Math.max(sizes.box * 0.38, 12) }}>
              {ownerAvatar}
            </span>
          )}
        </div>
      </div>
    );
  };

  // ── Scoreboard ────────────────────────────────────────────────────────────────
  const renderScoreboard = () => {
    if (!gameState) return null;
    const count = gameState.playerCount || 2;
    const ids   = Array.from({ length: count }, (_, i) => `player${i + 1}`);

    return (
      <div className={`grid gap-2 w-full max-w-2xl mb-4 ${
        count === 2 ? 'grid-cols-2' :
        count === 3 ? 'grid-cols-3' :
                      'grid-cols-2 sm:grid-cols-4'
      }`}>
        {ids.map((pid) => {
          const cfg       = getConfig(pid);
          const name      = gameState[`${pid}Name`]   || `Player ${pid.slice(6)}`;
          const av        = gameState[`${pid}Avatar`] || '👤';
          const score     = gameState.scores?.[pid]   ?? 0;
          const isCurrent = gameState.currentPlayer === pid;
          const isMe      = pid === role;
          const waiting   = name.startsWith('Waiting');

          return (
            <div
              key={pid}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all duration-200 ${
                isCurrent
                  ? `${cfg.light} ${cfg.border} scale-105 shadow-md`
                  : 'bg-white border-gray-200'
              } ${waiting ? 'opacity-50' : ''}`}
            >
              <span className="text-2xl leading-none">{waiting ? '⏳' : av}</span>
              <div className="min-w-0 flex-1">
                <div className={`font-bold text-xs truncate ${isCurrent ? cfg.text : 'text-gray-700'}`}>
                  {waiting ? `P${pid.slice(6)} waiting…` : name}
                  {isMe && <span className="ml-1 text-gray-400">(you)</span>}
                </div>
                <div className="text-lg font-extrabold leading-none" style={{ color: cfg.color }}>
                  {score}
                </div>
              </div>
              {isCurrent && !waiting && (
                <span className="text-xs animate-pulse">▶</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Winner Modal ──────────────────────────────────────────────────────────────
  const renderWinnerModal = () => {
    if (!showWinner || !winnerData) return null;
    const count = winnerData.playerCount || 2;
    const ids   = Array.from({ length: count }, (_, i) => `player${i + 1}`);

    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center">
          {winnerData.isDraw ? (
            <>
              <div className="text-6xl mb-2">🤝</div>
              <h2 className="text-3xl font-extrabold text-gray-800 mb-1">It's a Draw!</h2>
              <p className="text-gray-500 mb-4">Great game everyone!</p>
            </>
          ) : (
            <>
              <div className="text-6xl mb-2 animate-bounce">{winnerData.avatar}</div>
              <h2 className="text-3xl font-extrabold mb-1" style={{ color: winnerData.color }}>
                {winnerData.name} Wins!
              </h2>
              <p className="text-gray-500 mb-4">🏆 Champion!</p>
            </>
          )}

          {/* All scores */}
          <div className="bg-gray-50 rounded-xl p-3 mb-5 space-y-1">
            {ids.map((pid) => {
              const cfg  = getConfig(pid);
              const name = gameState?.[`${pid}Name`] || `Player ${pid.slice(6)}`;
              const score = winnerData.scores?.[pid] ?? 0;
              const isWin = !winnerData.isDraw && winnerData.winner === pid;
              return (
                <div key={pid} className={`flex justify-between items-center px-2 py-1 rounded-lg ${isWin ? cfg.light : ''}`}>
                  <span className={`font-semibold text-sm ${isWin ? cfg.text : 'text-gray-600'}`}>
                    {name} {isWin && '🏆'}
                  </span>
                  <span className="font-extrabold text-base" style={{ color: cfg.color }}>{score}</span>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setShowWinner(false); navigate('/'); }}
              className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}
            >
              🎮 New Game
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex-1 py-2.5 rounded-xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm transition-all active:scale-95"
            >
              Leave
            </button>
          </div>

          <div className="mt-4 text-xl space-x-1">
            {['🎉','✨','🎊','🏆','🎉'].map((e, i) => (
              <span key={i} className="inline-block animate-bounce" style={{ animationDelay: `${i * 0.1}s` }}>{e}</span>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Loading / waiting state ────────────────────────────────────────────────────
  if (!gameState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6 text-center">
        <div className="text-5xl mb-4 animate-pulse">🎮</div>
        <h2 className="text-xl font-bold text-gray-700 mb-2">Waiting for game data…</h2>
        <p className="text-gray-500 text-sm">Game ID: <span className="font-mono font-bold">{gameId}</span></p>
        <div className="mt-4 flex gap-1 justify-center">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
          ))}
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-50 p-3 sm:p-6">
      {renderWinnerModal()}

      {/* ── Header ── */}
      <div className="w-full max-w-2xl mb-3 text-center">
        {/* Game ID bar */}
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-xs text-gray-400 uppercase tracking-wide">Room</span>
          <button
            onClick={handleCopyId}
            className="font-mono text-sm font-bold bg-gray-100 hover:bg-gray-200 px-3 py-0.5 rounded-full transition-colors"
            title="Copy game ID"
          >
            {gameId}
          </button>
          {showCopied && <span className="text-xs text-green-500 animate-pulse">Copied!</span>}
        </div>

        {/* You are */}
        <p className="text-xs text-gray-400 mb-1">
          You are <span className="font-bold" style={{ color: getConfig(role).color }}>{username}</span>
        </p>

        {/* Status pill */}
        <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold ${
          gameState.currentPlayer === role
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-600'
        }`}>
          {status}
        </div>

        {/* Waiting banner */}
        {waitingCount > 0 && (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-amber-700 text-xs">
            ⏳ Waiting for <strong>{waitingCount}</strong> more player(s) to join.
            Share the room code: <strong>{gameId}</strong>
          </div>
        )}

        {error && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-red-600 text-xs">
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* ── Scoreboard ── */}
      {renderScoreboard()}

      {/* ── Board ── */}
      <div className="bg-white rounded-2xl shadow-xl p-3 sm:p-6 border border-gray-100 overflow-auto select-none">
        {gameState.horizontalLines.map((row, r) => (
          <div key={`row-${r}`}>
            {/* Dot-HLine-Dot row */}
            <div className="flex items-center">
              {row.map((_, c) => (
                <React.Fragment key={`top-${c}`}>
                  {renderDot(`d-${r}-${c}`)}
                  {renderHLine(r, c)}
                </React.Fragment>
              ))}
              {renderDot(`d-${r}-end`)}
            </div>

            {/* VLine-Box row */}
            {r < gameState.boxes.length && (
              <div className="flex items-center">
                {gameState.boxes[r].map((_, c) => (
                  <React.Fragment key={`mid-${c}`}>
                    {renderVLine(r, c)}
                    {renderBox(r, c)}
                  </React.Fragment>
                ))}
                {renderVLine(r, gameState.boxes[r].length)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Leave button ── */}
      <button
        onClick={() => navigate('/')}
        className="mt-5 px-5 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-xl text-sm font-semibold transition-all active:scale-95"
      >
        ← Leave Game
      </button>
    </div>
  );
};

export default Board;
