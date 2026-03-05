// src/components/Board.jsx
// Production-ready Board for GridLock - supports 2-4 players
// Adaptive layout: mobile / tablet / desktop

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import socket from '../socket';
import { recordGame } from '../utils/sessionStats';
import ScoreBar from './ScoreBar';
import { initAudio, toggleMute, isMuted, sounds } from '../utils/sounds';

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

      // On mobile: reserve less vertical space so board is bigger
      const reservedH = w < 640 ? 200 : 280;
      // On mobile: minimal horizontal padding
      const reservedW = w < 640 ? 16 : 64;

      const availW = w - reservedW;
      const availH = h - reservedH;
      const cells = gridSize || 3;
      const units = cells * 2 + 1; // grid units (dots + lines/boxes)

      const fromW = Math.floor(availW / units);
      const fromH = Math.floor(availH / units);
      let box = Math.min(fromW, fromH);

      // On mobile, keep controls finger-friendly but never exceed what fits the viewport.
      const baseMinBox = w < 640 ? 44 : 28;
      const maxBox = w < 640 ? 72 : 80;
      const effectiveMinBox = Math.min(baseMinBox, fromW, fromH);
      box = Math.max(effectiveMinBox, Math.min(box, maxBox));

      const dot = Math.max(8, Math.round(box * 0.18));
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
  const {
    username,
    role: initialRole,
    gameId,
    gridSize,
    avatar,
    playerCount,
    sessionToken: initialSessionToken,
    joinMode: initialJoinMode,
    tournamentId,
  } = location.state || {};

  // role can be 'player_joining' until server assigns a slot; use state so it updates
  const [role, setRole] = useState(initialRole || (initialJoinMode === 'spectator' ? 'spectator' : initialRole));
  const roleRef = useRef(initialRole || (initialJoinMode === 'spectator' ? 'spectator' : initialRole)); // always-current ref avoids stale closure in handlers
  const [sessionToken, setSessionToken] = useState(() => {
    if (initialSessionToken) return initialSessionToken;
    if (!gameId || !username) return null;
    return localStorage.getItem(`gridlock:session:${gameId}:${username}`) || null;
  });

  const [gameState,      setGameState]      = useState(null);
  const [error,          setError]          = useState(null);
  const [status,         setStatus]         = useState('Connecting…');
  const [showWinner,     setShowWinner]     = useState(false);
  const [winnerData,     setWinnerData]     = useState(null);
  const [waitingCount,   setWaitingCount]   = useState(0);
  const [showCopied,     setShowCopied]     = useState(false);
  const [muted,          setMuted]          = useState(() => isMuted());
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchCount, setRematchCount] = useState({ count: 0, total: 0 });

  // Track previous scores in a ref so we can compute sound effects outside of
  // a React state-updater (where side effects are an anti-pattern — updaters
  // may be called more than once in Strict Mode).
  const prevScoresRef = useRef(null);
  // Prevent double-recording stats on reconnect (game_update can re-fire with gameOver: true)
  const gameOverRecorded = useRef(false);
  const gameStarted      = useRef(false);
  // Prevent duplicate join emits for the same room/user tuple.
  const lastJoinKeyRef   = useRef(null);

  // Mute toggle handler
  const handleToggleMute = () => {
    const nowMuted = toggleMute();
    setMuted(nowMuted);
  };

  const joinMode = location.state?.joinMode || (role === 'spectator' ? 'spectator' : 'player');
  const isSpectator = role === 'spectator';
  const sizes = useGridSizes(gridSize);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  // ── Status helper ────────────────────────────────────────────────────────────
  const getStatusFromState = useCallback((gs) => {
    if (!gs) return 'Waiting…';
    const name = gs[`${gs.currentPlayer}Name`] || gs.currentPlayer;
    if (role === 'spectator') return `👀 Spectating · ${name}'s turn`;
    return gs.currentPlayer === role ? '⚡ Your turn!' : `⏳ ${name}'s turn`;
  }, [role]);

  // ── Socket events ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || !username) { navigate('/'); return; }

    const onGameStarted = (data) => {
      const gs = data.gameState;
      setGameState(gs);
      prevScoresRef.current = gs?.scores || null;

      // If server assigned us a playerId (happens when joining via invite code), update role
      if (data.playerId) {
        setRole(data.playerId);
        roleRef.current = data.playerId;
      }

      // Save auth token when provided by server (create/join/reconnect)
      if (data.sessionToken) {
        setSessionToken(data.sessionToken);
        if (gameId && username) {
          localStorage.setItem(`gridlock:session:${gameId}:${username}`, data.sessionToken);
        }
      }

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
      // Game start sound — once
      if (!gameStarted.current) {
        gameStarted.current = true;
        sounds.gameStart();
      }
    };

    const onGameUpdate = (data) => {
      const gs = data.gameState;

      // Tile capture sounds: compare score deltas outside React state updater.
      const prevScores = prevScoresRef.current || {};
      if (gs.scores) {
        Object.keys(gs.scores).forEach(pid => {
          if ((gs.scores[pid] || 0) > (prevScores[pid] || 0)) {
            if (pid === roleRef.current) sounds.tileCaptured();
            else sounds.opponentCapture();
          }
        });
      }

      setGameState(gs);
      prevScoresRef.current = gs?.scores || null;

      setWaitingCount(0);

      if (gs.gameOver || gs.winner) {
        const winner = gs.winner;

        // Record session stats exactly once (guard against reconnect re-fires)
        if (!gameOverRecorded.current && roleRef.current !== 'spectator') {
          gameOverRecorded.current = true;
          const myScore = gs.scores?.[role] || 0;
          const totalBoxes = (gridSize || 3) * (gridSize || 3);
          const territoryPct = Math.round((myScore / totalBoxes) * 100);
          const outcome = winner === 'draw' ? 'draw' : winner === role ? 'win' : 'loss';
          recordGame(outcome, territoryPct, gs.playerCount || 2, gridSize || 3);
          // Win/lose sound
          if (winner === role) sounds.gameWin();
          else if (winner !== 'draw') sounds.gameLose();
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

    const onRematchCount = (data) => {
      setRematchCount({ count: data.count, total: data.total });
    };

    const onRematchReady = (data) => {
      if (roleRef.current === 'spectator') return;
      const newGameId = data.newGameId;
      // Keep token continuity across rematch; omit role so UI waits for
      // authoritative server assignment via game_started.
      navigate('/game', {
        state: { username, gameId: newGameId, gridSize, avatar, playerCount, sessionToken }
      });
    };

    const onPlayerDisconnected = (data) => {
      setError(`${data.username || 'A player'} disconnected. Waiting ${Math.round((data.reconnectWindowMs || 60000) / 1000)}s for reconnect...`);
    };

    const onPlayerReconnected = () => {
      setError(null);
    };

    const onPlayerForfeited = (data) => {
      setError(`${data.username || 'A player'} forfeited due to disconnect.`);
    };

    socket.on('game_started',       onGameStarted);
    socket.on('all_players_joined', onAllJoined);
    socket.on('game_update',        onGameUpdate);
    socket.on('error',              onError);
    socket.on('rematch_count',      onRematchCount);
    socket.on('rematch_ready',      onRematchReady);
    socket.on('player_disconnected', onPlayerDisconnected);
    socket.on('player_reconnected',  onPlayerReconnected);
    socket.on('player_forfeited',    onPlayerForfeited);

    // Join / re-join room (session token still sent for secure reconnect)
    // Guard emit by room+username so token/role state changes don't re-send join_game.
    const joinKey = `${gameId}:${username}`;
    if (lastJoinKeyRef.current !== joinKey) {
      socket.emit('join_game', { gameId, username, avatar, sessionToken, joinMode });
      lastJoinKeyRef.current = joinKey;
    }

    return () => {
      socket.off('game_started',        onGameStarted);
      socket.off('all_players_joined',  onAllJoined);
      socket.off('game_update',         onGameUpdate);
      socket.off('error',               onError);
      socket.off('rematch_count',       onRematchCount);
      socket.off('rematch_ready',       onRematchReady);
      socket.off('player_disconnected', onPlayerDisconnected);
      socket.off('player_reconnected',  onPlayerReconnected);
      socket.off('player_forfeited',    onPlayerForfeited);
    };
  }, [gameId, username, navigate, role, avatar, sessionToken, getStatusFromState, joinMode]);

  // ── Tournament: post-game navigation ──────────────────────────────────────────
  const tournamentNavRef = useRef(false);
  useEffect(() => {
    if (!tournamentId) return;

    const onTournamentGameAssigned = ({ gameId: nextGameId, opponentName, roundIndex, matchIndex, gridSize: nextGridSize }) => {
      if (tournamentNavRef.current) return;
      tournamentNavRef.current = true;
      navigate('/game', {
        state: {
          username,
          gameId: nextGameId,
          role: 'player_joining',
          avatar,
          playerCount: 2,
          gridSize: nextGridSize || gridSize,
          tournamentId,
          tournamentRound: roundIndex,
          tournamentMatch: matchIndex,
          opponentName,
        },
      });
    };

    const onTournamentCompleted = ({ tournament }) => {
      if (tournamentNavRef.current) return;
      tournamentNavRef.current = true;
      navigate('/tournament', {
        state: {
          tournament,
          tournamentId,
          username,
          avatar,
        },
      });
    };

    const onTournamentUpdate = ({ tournament }) => {
      // If the game is over and we haven't navigated yet, go back to tournament lobby
      if (showWinner && !tournamentNavRef.current && tournament.status !== 'finished') {
        // Stay — a game_assigned event should come soon
      }
    };

    socket.on('tournament_game_assigned', onTournamentGameAssigned);
    socket.on('tournament_completed', onTournamentCompleted);
    socket.on('tournament_update', onTournamentUpdate);

    return () => {
      socket.off('tournament_game_assigned', onTournamentGameAssigned);
      socket.off('tournament_completed', onTournamentCompleted);
      socket.off('tournament_update', onTournamentUpdate);
    };
  }, [tournamentId, username, avatar, gridSize, navigate, showWinner]);

  // Reset tournament nav guard when gameId changes
  useEffect(() => {
    tournamentNavRef.current = false;
  }, [gameId]);

  // ── Move handler ──────────────────────────────────────────────────────────────
  const handleLineClick = useCallback((type, r, c) => {
    initAudio(); // unlock AudioContext on first game interaction
    if (!gameState || isSpectator || gameState.currentPlayer !== role) return;
    socket.emit('make_move', { gameId, playerId: role, sessionToken, type, r, c });
  }, [gameState, role, gameId, sessionToken, isSpectator]);

  // ── Copy game ID ──────────────────────────────────────────────────────────────
  const handleCopyId = () => {
    initAudio(); // unlock AudioContext on first user interaction
    navigator.clipboard?.writeText(gameId).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  };

  // ── Rematch handlers ──────────────────────────────────────────────────────────
  const handlePlayAgain = () => {
    initAudio();
    setRematchRequested(true);
    socket.emit('request_rematch', { gameId, sessionToken });
  };

  const handleLeaveGame = () => {
    initAudio();
    navigate('/');  // router basename handles /beta prefix automatically
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

  // ── Touch handler factory ─────────────────────────────────────────────────────
  // Fires a move only for tap-like gestures that end on the same line element.
  const makeTouchHandler = useCallback((type, r, c) => {
    let startX = 0;
    let startY = 0;
    return {
      onTouchStart: (e) => {
        initAudio();
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      onTouchEnd: (e) => {
        const touch = e.changedTouches[0];
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);

        // Only treat as a tap (not a swipe / scroll gesture)
        if (dx < 10 && dy < 10) {
          const endElement = document.elementFromPoint(touch.clientX, touch.clientY);
          if (endElement && !e.currentTarget.contains(endElement) && endElement !== e.currentTarget) {
            return;
          }
          e.preventDefault();
          handleLineClick(type, r, c);
        }
      },
    };
  }, [handleLineClick]);

  const handleLineKeyDown = useCallback((e, type, r, c, isMyTurn) => {
    if (!isMyTurn) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      if (e.key !== 'Enter') e.preventDefault();
      handleLineClick(type, r, c);
    }
  }, [handleLineClick]);

  const renderHLine = (r, c) => {
    const owner = gameState.horizontalLines[r]?.[c];
    const isMyTurn = !isSpectator && gameState.currentPlayer === role && !owner;
    const lineColor = getLineColor(owner);
    const touchHandlers = makeTouchHandler('horizontal', r, c);

    return (
      <div
        key={`h-${r}-${c}`}
        style={{ width: sizes.line, height: sizes.dot, flexShrink: 0 }}
        className="flex items-center px-0.5"
      >
        <div
          onClick={() => handleLineClick('horizontal', r, c)}
          onTouchStart={touchHandlers.onTouchStart}
          onTouchEnd={touchHandlers.onTouchEnd}
          role="button"
          aria-label={`Horizontal line row ${r} col ${c}${owner ? ' (taken)' : ''}`}
          aria-disabled={!isMyTurn}
          tabIndex={isMyTurn ? 0 : -1}
          onKeyDown={(e) => handleLineKeyDown(e, 'horizontal', r, c, isMyTurn)}
          className={`h-2 w-full rounded transition-all duration-150 ${
            owner ? '' : isMyTurn ? 'cursor-pointer hover:opacity-80 active:opacity-60' : 'cursor-default'
          }`}
          style={{
            backgroundColor: lineColor || '#E5E7EB',
            opacity: owner ? 1 : isMyTurn ? undefined : 0.5,
            touchAction: 'manipulation',
          }}
        />
      </div>
    );
  };

  const renderVLine = (r, c) => {
    const owner = gameState.verticalLines[r]?.[c];
    const isMyTurn = !isSpectator && gameState.currentPlayer === role && !owner;
    const lineColor = getLineColor(owner);
    const touchHandlers = makeTouchHandler('vertical', r, c);

    return (
      <div
        key={`v-${r}-${c}`}
        style={{ width: sizes.dot, height: sizes.line, flexShrink: 0 }}
        className="flex justify-center py-0.5"
      >
        <div
          onClick={() => handleLineClick('vertical', r, c)}
          onTouchStart={touchHandlers.onTouchStart}
          onTouchEnd={touchHandlers.onTouchEnd}
          role="button"
          aria-label={`Vertical line row ${r} col ${c}${owner ? ' (taken)' : ''}`}
          aria-disabled={!isMyTurn}
          tabIndex={isMyTurn ? 0 : -1}
          onKeyDown={(e) => handleLineKeyDown(e, 'vertical', r, c, isMyTurn)}
          className={`w-2 h-full rounded transition-all duration-150 ${
            owner ? '' : isMyTurn ? 'cursor-pointer hover:opacity-80 active:opacity-60' : 'cursor-default'
          }`}
          style={{
            backgroundColor: lineColor || '#E5E7EB',
            opacity: owner ? 1 : isMyTurn ? undefined : 0.5,
            touchAction: 'manipulation',
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

  // ── Scoreboard (desktop/tablet only — hidden on mobile via CSS) ───────────────
  const renderScoreboard = () => {
    if (!gameState) return null;
    const count = gameState.playerCount || 2;
    const ids   = Array.from({ length: count }, (_, i) => `player${i + 1}`);

    return (
      <div className={`scoreboard-cards grid gap-2 w-full max-w-2xl mb-4 ${
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
          const isCPU     = !!gameState[`${pid}IsCPU`];

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
                  {isCPU && <span className="ml-1">🤖</span>}
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
              const isCPU = !!gameState?.[`${pid}IsCPU`];
              return (
                <div key={pid} className={`flex justify-between items-center px-2 py-1 rounded-lg ${isWin ? cfg.light : ''}`}>
                  <span className={`font-semibold text-sm ${isWin ? cfg.text : 'text-gray-600'}`}>
                    {name} {isCPU && '🤖'} {isWin && '🏆'}
                  </span>
                  <span className="font-extrabold text-base" style={{ color: cfg.color }}>{score}</span>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            {!isSpectator && !tournamentId && (
              <button
                onClick={handlePlayAgain}
                disabled={rematchRequested}
                className={`flex-1 py-2.5 rounded-xl font-bold text-white text-sm transition-all ${
                  rematchRequested 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'active:scale-95 hover:shadow-lg'
                }`}
                style={{ 
                  background: rematchRequested 
                    ? undefined 
                    : 'linear-gradient(135deg,#3B82F6,#2563EB)' 
                }}
              >
                {rematchRequested ? (
                  <>⏳ Waiting...</>
                ) : (
                  <>🔄 Play Again</>
                )}
              </button>
            )}
            {tournamentId && (
              <div className="flex-1 py-2.5 rounded-xl font-bold text-sm text-center text-amber-600 bg-amber-50">
                <span className="w-4 h-4 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin inline-block mr-2 align-middle" />
                Next match loading…
              </div>
            )}
            <button
              onClick={tournamentId ? () => navigate('/tournament', { state: { tournamentId, username, avatar } }) : handleLeaveGame}
              className="flex-1 py-2.5 rounded-xl font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm transition-all active:scale-95"
            >
              {tournamentId ? '🏆 View Bracket' : '👋 Leave Game'}
            </button>
          </div>

          {/* Rematch counter */}
          {rematchCount.count > 0 && (
            <div className="mt-3 text-sm text-gray-600">
              <span className="font-semibold">
                {rematchCount.count} / {rematchCount.total}
              </span> players ready for rematch
            </div>
          )}

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
  const isMyTurnNow = !isSpectator && gameState.currentPlayer === role;

  return (
    <div className="game-layout flex flex-col items-center bg-gray-50" style={{ minHeight: '100dvh' }}>
      {renderWinnerModal()}

      {/* ── Live ScoreBar (fixed top) ── */}
      {waitingCount === 0 && gameState && !gameState.gameOver && (() => {
        const count = gameState.playerCount || 2;
        const players = Array.from({ length: count }, (_, i) => {
          const pid = `player${i + 1}`;
          const cfg = getConfig(pid);
          return {
            id: pid,
            username: gameState[`${pid}Name`] || cfg.label,
            avatar: gameState[`${pid}Avatar`] || cfg.label,
            color: cfg.color,
          };
        });
        return (
          <ScoreBar
            players={players}
            scores={gameState.scores || {}}
            gridSize={gridSize || 3}
            currentPlayer={gameState.currentPlayer}
          />
        );
      })()}

      {/* ── Main content area (pushes below fixed ScoreBar) ── */}
      <div className="game-content w-full flex flex-col items-center px-2 sm:px-6 pb-4">

        {/* ── Header: Room code + You are + Status ── */}
        <div className="w-full max-w-2xl mb-2 sm:mb-3">
          {/* Room code badge — always visible, copyable */}
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Room</span>
            <button
              onClick={handleCopyId}
              className="font-mono text-sm font-bold bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-full transition-colors border border-gray-200"
              title="Tap to copy room code"
              aria-label="Copy room code"
            >
              {gameId}
            </button>
            {showCopied && <span className="text-xs text-green-500 animate-pulse">Copied!</span>}
          </div>

          {/* You are */}
          <p className="text-xs text-gray-400 text-center mb-1">
            You are <span className="font-bold" style={{ color: isSpectator ? '#4F46E5' : getConfig(role).color }}>{username}</span>{isSpectator ? ' (spectator)' : ''}
            {gameState?.hasCPU && <span className="ml-2 bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-semibold">vs CPU</span>}
            {tournamentId && <span className="ml-2 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-semibold">🏆 Tournament Match</span>}
          </p>

          {/* Status pill */}
          <div className="flex justify-center">
            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold ${
              isMyTurnNow
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {status}
            </div>
          </div>

          {/* Waiting banner */}
          {waitingCount > 0 && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-amber-700 text-xs text-center">
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

        {/* ── Scoreboard cards (hidden on mobile — ScoreBar handles it there) ── */}
        {renderScoreboard()}

        {/* ── Board ── */}
        <div
          className="relative bg-white rounded-2xl shadow-xl border border-gray-100 select-none board-container"
          style={{ touchAction: 'pan-y', padding: '12px' }}
        >
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

        {/* ── Bottom toolbar: Mute + Leave Game (on same row on mobile) ── */}
        <div className="game-toolbar mt-4 flex items-center justify-between w-full max-w-xs gap-3">
          {/* Mute button — moved OUT of board */}
          <button
            onClick={() => { initAudio(); handleToggleMute(); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-semibold transition-all active:scale-90 shadow-sm"
            title={muted ? 'Unmute sounds' : 'Mute sounds'}
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            style={{ minHeight: '44px', minWidth: '44px' }}
          >
            <span className="text-lg">{muted ? '🔇' : '🔊'}</span>
            <span className="text-xs text-gray-600 hidden sm:inline">{muted ? 'Unmute' : 'Mute'}</span>
          </button>

          {/* Leave button */}
          <button
            onClick={() => navigate('/')}
            className="flex-1 px-5 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{ minHeight: '44px' }}
          >
            ← Leave Game
          </button>
        </div>
      </div>
    </div>
  );
};

export default Board;
