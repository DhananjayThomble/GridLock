// src/components/Board.jsx
// Production-ready Board for GridLock - supports 2-4 players
// Adaptive layout: mobile / tablet / desktop

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import socket from '../socket';
import confetti from 'canvas-confetti';
import { recordGame } from '../utils/sessionStats';
import { recordOpponent } from '../utils/recentOpponentsStore';
import ScoreBar from './ScoreBar';
import { initAudio, toggleMute, isMuted, isVibrationEnabled, sounds } from '../utils/sounds';
import { generateShareText, shareOrCopy } from '../utils/shareResult';
import useThemeColors from '../hooks/useThemeColors';
import PostGameStatsCard from './PostGameStatsCard';
import ChatButton from './chat/ChatButton';
import ChatPanel from './chat/ChatPanel';
import ChatOverlay from './chat/ChatOverlay';
import { RATE_LIMIT_MS } from './chat/chatConstants';

import { countLines } from '../utils/postGameUtils';
import { capture } from '../lib/posthog';

// ─── Player config (uses CSS variables for theme-aware colors) ────────────────
const PLAYER_CONFIG = {
  player1: { colorVar: '--player1-color', bgVar: '--player1-bg', label: 'P1' },
  player2: { colorVar: '--player2-color', bgVar: '--player2-bg', label: 'P2' },
  player3: { colorVar: '--player3-color', bgVar: '--player3-bg', label: 'P3' },
  player4: { colorVar: '--player4-color', bgVar: '--player4-bg', label: 'P4' },
};

const getConfig = (playerId) => PLAYER_CONFIG[playerId] || PLAYER_CONFIG.player1;

// Helper to get computed CSS variable value at runtime (cached via useThemeColors hook)
// getCSSVar kept as thin wrapper for inline usage — actual caching happens in the hook

// ─── Responsive sizing hook ───────────────────────────────────────────────────
function useGridSizes(gridSize) {
  const [sizes, setSizes] = useState({ dot: 8, line: 48, box: 48, lineThickness: 8 });

  useEffect(() => {
    function calculate() {
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Reserve space for ScoreBar (~80px) + header + toolbar (~60px)
      // More aggressive on mobile to let the board fill available space
      // But keep some breathing room so it doesn't feel crammed
      const reservedH = w < 640 ? 180 : w < 768 ? 220 : 260;
      // Horizontal padding: minimal on mobile (board goes nearly edge-to-edge)
      const reservedW = w < 640 ? 4 : w < 768 ? 48 : 64;

      const availW = w - reservedW;
      const availH = h - reservedH;
      const cells = gridSize || 3;

      // Total grid units: (cells+1) dots + cells lines/boxes per axis
      const units = cells * 2 + 1;

      const fromW = Math.floor(availW / units);
      const fromH = Math.floor(availH / units);
      let box = Math.min(fromW, fromH);

      // Minimum 24px so it's tappable; cap per breakpoint to prevent oversized cells
      const maxBox = w < 640 ? 100 : w < 1024 ? 110 : 120;
      box = Math.max(24, Math.min(box, maxBox));

      // Dot size: minimum 10px on mobile for better tap targets (was 6)
      const minDot = w < 640 ? 10 : 8;
      const dot = Math.max(minDot, Math.round(box * 0.22));

      // Line thickness: proportional to box size, minimum 8px
      const lineThickness = Math.max(8, Math.round(box * 0.12));

      setSizes({ dot, line: box, box, lineThickness });
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
  const themeColors = useThemeColors();
  const getCSSVar = (varName) => themeColors[varName] || '';
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
  const [rematchFailed, setRematchFailed] = useState(null); // null or reason string
  const [shareStatus, setShareStatus] = useState(null); // null | 'copied' | 'shared'
  const [roomNotFound, setRoomNotFound] = useState(false);
  const shareTimeoutRef = useRef(null);
  const [tournamentSnapshot, setTournamentSnapshot] = useState(null);
  const tournamentSnapshotRef = useRef(null);

  // ── Quick chat state (#216) ───────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false);
  const [chatCooldown, setChatCooldown] = useState(false);
  const chatCooldownRef = useRef(null);

  // ── Post-game stats tracking ──────────────────────────────────────────────────
  const [moveCount, setMoveCount] = useState({});
  const [gameDuration, setGameDuration] = useState(null);
  const prevLineCountRef = useRef(0);
  const gameStartTimeRef = useRef(null);

  // ── Turn indicator state ──────────────────────────────────────────────────────
  const [boardPulse, setBoardPulse] = useState(false);
  const prevPlayerRef = useRef(null);

  // Track previous scores in a ref so we can compute sound effects outside of
  // a React state-updater (where side effects are an anti-pattern — updaters
  // may be called more than once in Strict Mode).
  const prevScoresRef = useRef(null);
  // Prevent double-recording stats on reconnect (game_update can re-fire with gameOver: true)
  const gameOverRecorded = useRef(false);
  const confettiFiredRef = useRef(false);
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

  // ── Room not found timeout ────────────────────────────────────────────────────
  useEffect(() => {
    if (gameState || roomNotFound) return; // already have data or already marked not found
    const timer = setTimeout(() => {
      setRoomNotFound(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [gameState, roomNotFound]);

  // ── Turn change detection → haptic + visual + audio ───────────────────────────
  useEffect(() => {
    if (!gameState || gameState.gameOver || isSpectator) return;
    const current = gameState.currentPlayer;
    const prev = prevPlayerRef.current;
    prevPlayerRef.current = current;

    // Only trigger on actual turn *changes* (not initial load)
    if (prev && prev !== current && current === role) {
      // Haptic feedback (vibrate API requires recent user interaction on some devices;
      // this fires during gameplay so the page is already "user-activated")
      try {
        if (isVibrationEnabled() && 'vibrate' in navigator) navigator.vibrate([100, 50, 100]);
      } catch { /* some browsers throw on vibrate */ }

      // Ensure AudioContext is resumed before playing turn sound
      initAudio();
      sounds.turnNotify();

      // Board glow pulse (deferred to avoid sync setState in effect)
      const pulseTimer = setTimeout(() => setBoardPulse(true), 0);
      const hidePulseTimer = setTimeout(() => setBoardPulse(false), 1200);

      return () => {
        clearTimeout(pulseTimer);
        clearTimeout(hidePulseTimer);
      };
    }
  }, [gameState?.currentPlayer, gameState?.gameOver, role, isSpectator]);
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
        capture('game_started', { gridSize, playerCount, gameMode: tournamentId ? 'tournament' : 'casual' });
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

      // ── Track moves per player & game start time ────────────────────────────
      const currentLineCount = countLines(gs);
      if (currentLineCount > prevLineCountRef.current) {
        const lineOwners = {};
        if (gs.horizontalLines) gs.horizontalLines.forEach(row => row.forEach(v => { if (v) lineOwners[v] = (lineOwners[v] || 0) + 1; }));
        if (gs.verticalLines) gs.verticalLines.forEach(row => row.forEach(v => { if (v) lineOwners[v] = (lineOwners[v] || 0) + 1; }));
        setMoveCount(lineOwners);
        if (prevLineCountRef.current === 0 && currentLineCount > 0) {
          // Only set game start if this is truly the first move (1 line).
          // If currentLineCount > 1 on first update, we reconnected mid-game —
          // leave gameStartTimeRef null so duration shows "—" instead of wrong values.
          if (currentLineCount === 1) {
            gameStartTimeRef.current = Date.now();
          }
        }
      }
      prevLineCountRef.current = currentLineCount;

      setGameState(gs);
      prevScoresRef.current = gs?.scores || null;

      setWaitingCount(0);

      if (gs.gameOver || gs.winner) {
        setGameDuration(prev => prev || (gameStartTimeRef.current ? Math.round((Date.now() - gameStartTimeRef.current) / 1000) : null));
        const winner = gs.winner;

        // Record session stats exactly once (guard against reconnect re-fires)
        if (!gameOverRecorded.current && roleRef.current !== 'spectator') {
          gameOverRecorded.current = true;
          const myScore = gs.scores?.[role] || 0;
          const totalBoxes = (gridSize || 3) * (gridSize || 3);
          const territoryPct = totalBoxes > 0 ? Math.round((myScore / totalBoxes) * 100) : 0;
          const outcome = winner === 'draw' ? 'draw' : winner === role ? 'win' : 'loss';
          recordGame(outcome, territoryPct, gs.playerCount || 2, gridSize || 3);

          // Analytics: game completed
          capture('game_completed', {
            gridSize: gridSize || 3,
            playerCount: gs.playerCount || 2,
            duration: gameStartTimeRef.current ? Math.round((Date.now() - gameStartTimeRef.current) / 1000) : null,
            winner: winner === role ? 'self' : winner === 'draw' ? 'draw' : 'opponent',
          });

          // Record recent opponents (skip CPU players)
          // Known limitations of localStorage-only tracking:
          // - If the user closes the browser before `game_over` fires, the opponent
          //   is NOT recorded (no beforeunload handler; localStorage write requires
          //   the game_over event to determine outcome).
          // - If this user is the forfeiter (disconnect timeout), the opponent IS
          //   recorded on the opponent's device but NOT on this device (since this
          //   client never receives game_over).
          // - Cross-device play under the same username won't merge opponent lists
          //   (localStorage is per-browser).
          const pc = gs.playerCount || 2;
          for (let i = 1; i <= pc; i++) {
            const pid = `player${i}`;
            if (pid === role) continue; // skip self
            if (gs[`${pid}IsCPU`]) continue; // skip CPU
            const oppName = gs[`${pid}Name`];
            const oppAvatar = gs[`${pid}Avatar`];
            if (oppName) {
              // outcome is from *my* perspective — record it as-is per opponent
              recordOpponent(oppName, oppAvatar, outcome);
            }
          }

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
            colorVar: cfg.colorVar,
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

    const onError = (msg) => {
      const message = typeof msg === 'string' ? msg : JSON.stringify(msg);
      setError(message);
      // If error indicates room not found, show permanent error on loading screen
      if (/game not found|room not found|does not exist/i.test(message)) {
        setRoomNotFound(true);
      } else {
        setTimeout(() => setError(null), 3000);
      }
    };

    const onRematchCount = (data) => {
      setRematchCount({ count: data.count, total: data.total });
    };

    const onRematchFailed = (data) => {
      setRematchFailed(data.reason || 'Rematch failed');
      setRematchRequested(false);
      setRematchCount({ count: 0, total: 0 });
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
    socket.on('rematch_failed',     onRematchFailed);
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
      if (joinMode === 'spectator') {
        capture('spectator_joined', { gameId });
      }
    }

    // Re-join game room on socket reconnect (socket.io assigns new socket.id)
    // Note: In React StrictMode (dev only), rapid mount/unmount can cause a brief
    // window where the reconnect listener from the first mount fires after cleanup.
    // This is harmless — the server ignores duplicate join_game for the same session,
    // and the second mount re-registers the listener immediately.
    const onReconnect = () => {
      socket.emit('join_game', { gameId, username, avatar, sessionToken, joinMode });
    };
    socket.io.on('reconnect', onReconnect);

    return () => {
      socket.off('game_started',        onGameStarted);
      socket.off('all_players_joined',  onAllJoined);
      socket.off('game_update',         onGameUpdate);
      socket.off('error',               onError);
      socket.off('rematch_count',       onRematchCount);
      socket.off('rematch_failed',      onRematchFailed);
      socket.off('rematch_ready',       onRematchReady);
      socket.off('player_disconnected', onPlayerDisconnected);
      socket.off('player_reconnected',  onPlayerReconnected);
      socket.off('player_forfeited',    onPlayerForfeited);
      socket.io.off('reconnect',        onReconnect);
      if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
    };
  }, [gameId, username, navigate, role, avatar, sessionToken, getStatusFromState, joinMode]);

  // ── Tournament: post-game navigation ──────────────────────────────────────────
  const tournamentNavRef = useRef(false);
  useEffect(() => {
    if (!tournamentId) return;

    const onTournamentGameAssigned = ({ gameId: nextGameId, playerId: nextPlayerId, sessionToken: nextToken, gridSize: nextGridSize, playerCount: nextPlayerCount }) => {
      if (tournamentNavRef.current) return;
      tournamentNavRef.current = true;
      navigate('/game', {
        state: {
          username,
          gameId: nextGameId,
          role: nextPlayerId,
          avatar,
          playerCount: nextPlayerCount || 2,
          gridSize: nextGridSize || gridSize,
          sessionToken: nextToken,
          tournamentId,
        },
      });
    };

    const onTournamentCompleted = () => {
      if (tournamentNavRef.current) return;
      tournamentNavRef.current = true;
      // Use the latest tournament snapshot stored from tournament_update events
      navigate('/tournament', {
        state: {
          tournament: tournamentSnapshotRef.current,
          tournamentId,
          username,
          avatar,
        },
      });
    };

    const onTournamentUpdate = ({ tournament: t }) => {
      tournamentSnapshotRef.current = t;
      setTournamentSnapshot(t);
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

  // ── Winner confetti ───────────────────────────────────────────────────────────
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (winnerData && !winnerData.isDraw && !confettiFiredRef.current && !prefersReducedMotion) {
      confettiFiredRef.current = true;
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    }
    if (!winnerData) {
      confettiFiredRef.current = false;
    }
  }, [winnerData]);

  // ── Move handler ──────────────────────────────────────────────────────────────
  const handleLineClick = useCallback((type, r, c) => {
    initAudio(); // unlock AudioContext on first game interaction
    if (!gameState || isSpectator || gameState.currentPlayer !== role) return;
    socket.emit('make_move', { gameId, playerId: role, sessionToken, type, r, c });
    sounds.linePlaced();
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
  const isCPUGame = gameState?.hasCPU;

  const handlePlayAgain = () => {
    initAudio();
    if (isCPUGame) {
      // CPU games: instant rematch, no voting UI
      setRematchRequested(true);
      setRematchFailed(null);
      socket.emit('request_rematch', { gameId, sessionToken });
      return;
    }
    if (rematchRequested) {
      // Cancel the vote
      setRematchRequested(false);
      socket.emit('rematch_cancel', { gameId, sessionToken });
    } else {
      setRematchRequested(true);
      setRematchFailed(null);
      socket.emit('request_rematch', { gameId, sessionToken });
      capture('rematch_accepted');
    }
  };

  const handleLeaveGame = () => {
    initAudio();
    navigate('/');  // router basename handles /beta prefix automatically
  };

  // ── Quick chat handler (#216) ───────────────────────────────────────────────
  const handleChatSend = useCallback((content) => {
    if (chatCooldown || isSpectator || !gameState || gameState.gameOver) return;
    socket.emit('game_chat', { gameId, content });
    setChatOpen(false);
    setChatCooldown(true);
    if (chatCooldownRef.current) clearTimeout(chatCooldownRef.current);
    chatCooldownRef.current = setTimeout(() => setChatCooldown(false), RATE_LIMIT_MS);
  }, [chatCooldown, isSpectator, gameState, gameId]);

  // Cleanup cooldown timer on unmount
  useEffect(() => {
    return () => {
      if (chatCooldownRef.current) clearTimeout(chatCooldownRef.current);
    };
  }, []);

  // ── Share result handler ────────────────────────────────────────────────────
  const handleShareResult = async () => {
    if (!gameState) return;
    const text = generateShareText(
      gameState,
      gridSize || 3,
      gameState.playerCount || playerCount || 2,
      role,
      { tournamentRound: !!tournamentId }
    );
    try {
      const result = await shareOrCopy(text);
      setShareStatus(result === 'shared' ? 'shared' : 'copied');
    } catch {
      setShareStatus(null);
    }
    if (shareTimeoutRef.current) clearTimeout(shareTimeoutRef.current);
    shareTimeoutRef.current = setTimeout(() => setShareStatus(null), 2000);
  };

  // ── Render helpers ────────────────────────────────────────────────────────────
  const getPlayerColor = (playerId) => {
    if (!playerId) return null;
    const cfg = getConfig(playerId);
    return getCSSVar(cfg.colorVar);
  };

  const renderDot = (key) => (
    <div
      key={key}
      style={{ width: sizes.dot, height: sizes.dot, flexShrink: 0 }}
      className="flex items-center justify-center z-10"
    >
      <div
        className="rounded-full shadow-sm"
        style={{ width: sizes.dot - 2, height: sizes.dot - 2, backgroundColor: 'var(--dot-color)' }}
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
    const lineColor = owner ? getPlayerColor(owner) : null;
    const currentPlayerColor = isMyTurn ? getPlayerColor(gameState.currentPlayer) : null;
    const touchHandlers = makeTouchHandler('horizontal', r, c);

    return (
      <div
        key={`h-${r}-${c}`}
        onClick={() => handleLineClick('horizontal', r, c)}
        onTouchStart={touchHandlers.onTouchStart}
        onTouchEnd={touchHandlers.onTouchEnd}
        role="button"
        aria-label={`Horizontal line row ${r} col ${c}${owner ? ' (taken)' : ''}`}
        aria-disabled={!isMyTurn}
        tabIndex={isMyTurn ? 0 : -1}
        onKeyDown={(e) => handleLineKeyDown(e, 'horizontal', r, c, isMyTurn)}
        style={{ width: sizes.line, height: sizes.dot, flexShrink: 0, touchAction: 'manipulation' }}
        className={`flex items-center justify-center ${
          owner ? '' : isMyTurn ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div
          className="w-full rounded"
          style={{
            height: sizes.lineThickness,
            backgroundColor: lineColor || 'var(--line-empty)',
            opacity: owner ? 1 : isMyTurn ? 0.8 : 0.5,
            boxShadow: owner && lineColor ? `0 0 6px ${lineColor}40` : (isMyTurn && currentPlayerColor ? `0 0 8px ${currentPlayerColor}30` : undefined),
            transition: 'opacity 0.15s, background-color 0.15s',
          }}
        />
      </div>
    );
  };

  const renderVLine = (r, c) => {
    const owner = gameState.verticalLines[r]?.[c];
    const isMyTurn = !isSpectator && gameState.currentPlayer === role && !owner;
    const lineColor = owner ? getPlayerColor(owner) : null;
    const currentPlayerColor = isMyTurn ? getPlayerColor(gameState.currentPlayer) : null;
    const touchHandlers = makeTouchHandler('vertical', r, c);

    return (
      <div
        key={`v-${r}-${c}`}
        onClick={() => handleLineClick('vertical', r, c)}
        onTouchStart={touchHandlers.onTouchStart}
        onTouchEnd={touchHandlers.onTouchEnd}
        role="button"
        aria-label={`Vertical line row ${r} col ${c}${owner ? ' (taken)' : ''}`}
        aria-disabled={!isMyTurn}
        tabIndex={isMyTurn ? 0 : -1}
        onKeyDown={(e) => handleLineKeyDown(e, 'vertical', r, c, isMyTurn)}
        style={{ width: sizes.dot, height: sizes.line, flexShrink: 0, touchAction: 'manipulation' }}
        className={`flex items-center justify-center ${
          owner ? '' : isMyTurn ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div
          className="h-full rounded"
          style={{
            width: sizes.lineThickness,
            backgroundColor: lineColor || 'var(--line-empty)',
            opacity: owner ? 1 : isMyTurn ? 0.8 : 0.5,
            boxShadow: owner && lineColor ? `0 0 6px ${lineColor}40` : (isMyTurn && currentPlayerColor ? `0 0 8px ${currentPlayerColor}30` : undefined),
            transition: 'opacity 0.15s, background-color 0.15s',
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
          className="w-full h-full flex items-center justify-center rounded transition-all duration-300"
          style={cfg ? { backgroundColor: `var(${cfg.bgVar})` } : undefined}
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
          const playerColor = getCSSVar(cfg.colorVar);
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
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all duration-300 ${
                waiting ? 'opacity-50' : ''
              }`}
              style={{
                backgroundColor: isCurrent ? `var(${cfg.bgVar})` : 'var(--bg-secondary)',
                borderColor: isCurrent ? playerColor : 'var(--border-color)',
                ...(isCurrent ? { boxShadow: `0 0 12px ${playerColor}30`, transform: 'scale(1.1)' } : {}),
              }}
            >
              <span className="text-2xl leading-none">{waiting ? '⏳' : av}</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate" style={{ color: isCurrent ? playerColor : 'var(--text-primary)', fontSize: count >= 4 ? 'clamp(0.55rem, 2vw, 0.875rem)' : '0.75rem' }}>
                  {waiting ? `P${pid.slice(6)} waiting…` : name}
                  {isCPU && <span className="ml-1">🤖</span>}
                  {isMe && <span className="ml-1" style={{ color: 'var(--text-muted)' }}>(you)</span>}
                </div>
                <div className="text-lg font-extrabold leading-none" style={{ color: playerColor }}>
                  {score}
                </div>
              </div>
              {isCurrent && !waiting && (
                <span className="text-sm font-bold animate-pulse" style={{ color: playerColor }}>▶</span>
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
    // Pre-compute max score for draw highlighting
    const maxScore = winnerData.isDraw
      ? Math.max(...ids.map(pid => winnerData.scores?.[pid] ?? 0))
      : null;

    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-md">
        <div
          className="rounded-2xl p-6 w-full max-w-sm md:max-w-lg lg:max-w-xl shadow-2xl text-center"
          style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
        >
          {winnerData.isDraw ? (
            <>
              <div className="text-6xl mb-2" aria-label="Tied">🤝</div>
              <h2 className="text-3xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>It's a Draw!</h2>
              <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>Great game everyone!</p>
            </>
          ) : (
            <>
              <div className="text-6xl mb-2 winner-avatar-bounce">{winnerData.avatar}</div>
              <h2 className="text-3xl font-extrabold mb-1" style={{ color: 'var(--winner-gold)', textShadow: '0 0 12px var(--winner-glow)' }}>
                {winnerData.name} Wins!
              </h2>
              <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>🏆 Champion!</p>
            </>
          )}

          {/* All scores */}
          <div className="rounded-xl p-3 mb-5 space-y-1" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            {ids.map((pid) => {
              const cfg  = getConfig(pid);
              const playerColor = getCSSVar(cfg.colorVar);
              const name = gameState?.[`${pid}Name`] || `Player ${pid.slice(6)}`;
              const score = winnerData.scores?.[pid] ?? 0;
              const isWin = !winnerData.isDraw && winnerData.winner === pid;
              const isCPU = !!gameState?.[`${pid}IsCPU`];
              // In a draw: players who share the max score are "tied", others are losers
              const isTied = winnerData.isDraw && score === maxScore;
              const isDrawLoser = winnerData.isDraw && score < maxScore;

              return (
                <div
                  key={pid}
                  className="flex justify-between items-center px-2 py-1 rounded-lg"
                  style={{
                    ...(isWin ? { backgroundColor: 'var(--winner-bg)' } : {}),
                    ...(isTied ? {
                      backgroundColor: 'var(--draw-bg)',
                      borderLeft: '3px solid var(--winner-gold)',
                    } : {}),
                    ...(isDrawLoser ? { opacity: 0.5 } : {}),
                  }}
                >
                  <span className="font-semibold text-sm" style={{ color: isWin || isTied ? playerColor : 'var(--text-secondary)' }}>
                    {isCPU ? (
                      <>{name} 🤖 {isWin && '🏆'}{isTied && <span aria-label="Tied"> 🤝</span>}</>
                    ) : (
                      <Link to={`/profile/${encodeURIComponent(name)}`} className="hover:underline">
                        {name}
                      </Link>
                    )}
                    {!isCPU && isWin && ' 🏆'}
                    {!isCPU && isTied && <span aria-label="Tied"> 🤝</span>}
                  </span>
                  <span className="font-extrabold text-base" style={{ color: playerColor }}>{score}</span>
                </div>
              );
            })}
          </div>

          {/* Post-game stats card */}
          <PostGameStatsCard
            gameState={gameState}
            scores={winnerData.scores}
            playerIds={ids}
            gridSize={gridSize}
            moveCount={moveCount}
            gameDuration={gameDuration}
            role={role}
            winnerData={winnerData}
          />

          <div className="flex gap-2">
            {!isSpectator && (
              <button
                onClick={handleShareResult}
                className="py-2.5 px-3 rounded-xl font-bold text-sm transition-all active:scale-95 postgame-btn"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--success)' }}
                aria-label="Share result"
              >
                {shareStatus === 'copied' ? '✅ Copied!' : shareStatus === 'shared' ? '✅ Shared!' : '📤 Share'}
              </button>
            )}
            {!isSpectator && !tournamentId && !rematchFailed && (
              <button
                onClick={handlePlayAgain}
                disabled={isCPUGame && rematchRequested}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${
                  rematchRequested
                    ? 'active:scale-95'
                    : 'active:scale-95 hover:shadow-lg'
                }`}
                style={{
                  background: rematchRequested
                    ? 'var(--bg-surface)'
                    : `linear-gradient(135deg, var(--accent), var(--accent-hover))`,
                  color: rematchRequested ? 'var(--text-secondary)' : 'var(--text-on-accent)',
                  border: rematchRequested ? '1px solid var(--border-color)' : 'none',
                  opacity: (isCPUGame && rematchRequested) ? 0.6 : 1,
                }}
              >
                {isCPUGame ? (
                  rematchRequested
                    ? <>⏳ Starting rematch…</>
                    : <>🔄 Rematch</>
                ) : rematchRequested ? (
                  rematchCount.total > 0
                    ? <>⏳ Waiting ({rematchCount.count}/{rematchCount.total}) <span style={{ opacity: 0.7, fontWeight: 400, fontStyle: 'italic' }}>· Cancel</span></>
                    : <>⏳ Waiting... <span style={{ opacity: 0.7, fontWeight: 400, fontStyle: 'italic' }}>· Cancel</span></>
                ) : (
                  <>🔄 Rematch{rematchCount.total > 0 ? ` (${rematchCount.count}/${rematchCount.total})` : ''}</>
                )}
              </button>
            )}
            {!isSpectator && !tournamentId && rematchFailed && (
              <button
                onClick={handleLeaveGame}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--warning)', border: '1px solid var(--border-color)' }}
              >
                🏠 Back to Lobby
              </button>
            )}
            {tournamentId && (
              <div className="flex-1 py-2.5 rounded-xl font-bold text-sm text-center" style={{ color: 'var(--warning)', backgroundColor: `color-mix(in srgb, var(--warning) 10%, transparent)` }}>
                <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin inline-block mr-2 align-middle" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'var(--warning)' }} />
                Next match loading…
              </div>
            )}
            <button
              onClick={tournamentId ? () => navigate('/tournament', { state: { tournament: tournamentSnapshot, tournamentId, username, avatar } }) : handleLeaveGame}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 postgame-btn"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              {tournamentId ? '🏆 View Bracket' : '👋 Leave Game'}
            </button>
          </div>

          {/* Rematch status messages */}
          {rematchFailed && (
            <div className="mt-3 text-sm font-semibold" style={{ color: 'var(--danger)' }}>
              {rematchFailed}
            </div>
          )}
          {!isCPUGame && !rematchFailed && rematchCount.count > 0 && (
            <div className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-semibold">
                {rematchCount.count}/{rematchCount.total}
              </span> players ready for rematch
            </div>
          )}

        </div>
      </div>
    );
  };

  // ── Loading / waiting state ────────────────────────────────────────────────────
  if (!gameState) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
        {roomNotFound ? (
          <>
            <div className="text-5xl mb-4">❌</div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              Room not found
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              {error || 'Check the room code and try again.'}
            </p>
            <p className="text-xs mb-6" style={{ color: 'var(--text-secondary)' }}>
              Game ID: <span className="font-mono font-bold">{gameId}</span>
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2 rounded-lg font-semibold transition-colors"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
            >
              ← Back to Lobby
            </button>
          </>
        ) : (
          <>
            <div className="text-5xl mb-4 animate-pulse">🎮</div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Waiting for game data…</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Game ID: <span className="font-mono font-bold">{gameId}</span></p>
            <div className="mt-4 flex gap-1 justify-center">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent)', animationDelay: `${i*0.15}s` }} />
              ))}
            </div>
            <button
              onClick={() => navigate('/')}
              className="mt-6 px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              ← Back to Lobby
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  const isMyTurnNow = !isSpectator && gameState.currentPlayer === role;
  const myPlayerColor = getCSSVar(getConfig(role).colorVar);

  return (
    <div className="game-layout flex flex-col items-center" style={{ minHeight: '100dvh', backgroundColor: 'var(--bg-primary)' }}>
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
            color: getCSSVar(cfg.colorVar),
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
      <div className="game-content w-full flex flex-col items-center flex-1 px-2 sm:px-6 pb-4">

        {/* ── Header: Room code + You are + Status ── */}
        <div className="w-full max-w-2xl mb-2 sm:mb-3">
          {/* Room code badge — always visible, copyable */}
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Room</span>
            <button
              onClick={handleCopyId}
              className="font-mono text-sm font-bold px-3 py-1 rounded-full transition-colors room-code-btn"
              style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              title="Tap to copy room code"
              aria-label="Copy room code"
            >
              {gameId}
            </button>
            {showCopied && <span className="text-xs animate-pulse" style={{ color: 'var(--success)' }}>Copied!</span>}
            {gameState.gameOver && !isSpectator && (
              <button
                onClick={handleShareResult}
                className="text-sm px-2 py-1 rounded-full transition-colors"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--success)', border: '1px solid var(--border-color)' }}
                title="Share result"
                aria-label="Share game result"
              >
                {shareStatus === 'copied' ? '✅' : shareStatus === 'shared' ? '✅' : '📤'}
              </button>
            )}
          </div>

          {/* You are */}
          <p className="text-xs text-center mb-1" style={{ color: 'var(--text-muted)' }}>
            You are <span className="font-bold" style={{ color: isSpectator ? 'var(--accent)' : myPlayerColor }}>{username}</span>{isSpectator ? ' (spectator)' : ''}
            {gameState?.hasCPU && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `color-mix(in srgb, var(--warning) 15%, transparent)`, color: 'var(--warning)' }}>vs CPU</span>}
            {tournamentId && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `color-mix(in srgb, var(--warning) 15%, transparent)`, color: 'var(--warning)' }}>🏆 Tournament Match</span>}
          </p>

          {/* Status pill */}
          <div className="flex justify-center">
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-300"
              style={isMyTurnNow ? {
                backgroundColor: `color-mix(in srgb, var(--success) 15%, transparent)`,
                color: 'var(--success)',
                transform: 'scale(1.05)',
                boxShadow: `0 0 12px color-mix(in srgb, var(--success) 20%, transparent)`,
              } : {
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
              }}
            >
              {status}
            </div>
          </div>

          {/* Waiting banner */}
          {waitingCount > 0 && (
            <div className="mt-2 rounded-lg px-4 py-2 text-xs text-center" style={{ backgroundColor: `color-mix(in srgb, var(--warning) 10%, transparent)`, border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)', color: 'var(--warning)' }}>
              ⏳ Waiting for <strong>{waitingCount}</strong> more player(s) to join.
              Share the room code: <strong>{gameId}</strong>
              <button
                onClick={() => {
                  const url = `https://gridlock.pro/join/${gameId}`;
                  navigator.clipboard?.writeText(url).then(() => {
                    setShowCopied(true);
                    setTimeout(() => setShowCopied(false), 2000);
                  });
                }}
                className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-colors"
                style={{ backgroundColor: `color-mix(in srgb, var(--warning) 20%, transparent)`, color: 'var(--warning)' }}
                title="Copy invite link"
                aria-label="Copy invite link"
              >
                📎 Copy Invite Link
              </button>
            </div>
          )}

          {error && (
            <div className="mt-2 rounded-lg px-4 py-2 text-xs" style={{ backgroundColor: `color-mix(in srgb, var(--danger) 10%, transparent)`, border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* ── Scoreboard cards (hidden on mobile — ScoreBar handles it there) ── */}
        {renderScoreboard()}

        {/* ── Board ── */}
        <div className="flex flex-1 items-center justify-center w-full">
        <div
          className={`relative rounded-2xl shadow-xl select-none board-container mx-auto transition-shadow duration-300 ${
            boardPulse ? 'board-glow' : ''
          } ${gameState && !gameState.gameOver ? 'board-glow-active' : ''}`}
          style={{
            padding: '8px',
            backgroundColor: 'var(--bg-tertiary)',
            border: `1px solid var(--border-color)`,
            // 'manipulation' enables native pinch-to-zoom + pan but disables
            // double-tap zoom delay, keeping tap response fast for line clicks
            touchAction: 'manipulation',
            ...(boardPulse ? { borderColor: myPlayerColor, '--glow-rgb': myPlayerColor.match(/\w\w/g)?.map(h => parseInt(h, 16)).join(',') || '88,166,255' } : {}),
          }}
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
        </div>

        {/* ── Quick Chat (#216) ── */}
        {gameState && !gameState.gameOver && !isSpectator && (
          <ChatButton
            onClick={() => setChatOpen((prev) => !prev)}
            disabled={chatCooldown}
            cooldown={chatCooldown}
          />
        )}
        {chatOpen && (
          <ChatPanel
            onSend={handleChatSend}
            onClose={() => setChatOpen(false)}
          />
        )}
        <ChatOverlay socket={socket} gameId={gameId} />

        {/* ── Bottom toolbar: Mute + Leave Game (on same row on mobile) ── */}
        <div className="game-toolbar mt-4 flex items-center justify-between w-full max-w-xs gap-3">
          {/* Mute button — moved OUT of board */}
          <button
            onClick={() => { initAudio(); handleToggleMute(); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all active:scale-90 shadow-sm mute-btn"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', minHeight: '44px', minWidth: '44px' }}
            title={muted ? 'Unmute sounds' : 'Mute sounds'}
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
          >
            <span className="text-lg">{muted ? '🔇' : '🔊'}</span>
            <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>{muted ? 'Unmute' : 'Mute'}</span>
          </button>

          {/* Leave button */}
          <button
            onClick={() => navigate('/')}
            className="flex-1 px-5 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{ backgroundColor: 'var(--btn-danger-bg)', color: 'var(--btn-danger-text)', border: '1px solid var(--btn-danger-bg)', minHeight: '44px' }}
          >
            ← Leave Game
          </button>
        </div>
      </div>
    </div>
  );
};

export default Board;
