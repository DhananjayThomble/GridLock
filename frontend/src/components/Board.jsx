// src/components/Board.jsx
// Production-ready Board for GridLock - supports 2-4 players
// Adaptive layout: mobile / tablet / desktop

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import socket from '../socket';
import confetti from 'canvas-confetti';
import { recordGame, getStats } from '../utils/sessionStats';
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
import { addBreadcrumb, setTag, setUser } from '../lib/sentry';
import { useToast } from '../contexts/ToastContext';
import { useGridTheme } from '../contexts/GridThemeContext';
import { playerKeyFromRole, GRID_THEMES } from '../themes/gridThemes';
import useGridSizes from '../hooks/useGridSizes';

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

// ─── Main Component ───────────────────────────────────────────────────────────
const Board = () => {
  const location  = useLocation();
  const navigate  = useNavigate();
  const themeColors = useThemeColors();
  const { showToast } = useToast();
  const { theme: gridTheme, checkAndUnlockThemes } = useGridTheme();
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
    cpuDifficulty,
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

  // ── Leave game confirmation modal (#365) ──────────────────────────────────────
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

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
    if (!gameId || !username) { showToast('Game not found — returned to lobby', { type: 'error' }); navigate('/'); return; }

    const onGameStarted = (data) => {
      const gs = data.gameState;
      setGameState(gs);
      prevScoresRef.current = gs?.scores || null;

      // Reset game-over / rematch states so a same-route rematch navigation
      // doesn't leave stale winner overlay or "Starting rematch…" stuck.
      setShowWinner(false);
      setWinnerData(null);
      setRematchRequested(false);
      setRematchFailed(null);
      setRematchCount({ count: 0, total: 0 });
      confettiFiredRef.current = false;
      gameStarted.current = false;
      gameStartTimeRef.current = null;
      prevLineCountRef.current = 0;
      setMoveCount({});
      setGameDuration(null);

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

      // Track active game for rejoin banner on Lobby (#365)
      if (gameId && username && data.playerId !== 'spectator') {
        try {
          localStorage.setItem('gridlock_active_game', JSON.stringify({
            gameId,
            username,
            avatar,
            sessionToken: data.sessionToken || sessionToken,
            gridSize,
            playerCount,
            timestamp: Date.now(),
          }));
        } catch { /* quota exceeded / private browsing */ }
      }

      // ── Sentry context: game started / player joined ──────────────────────
      setUser({ username, id: username });
      setTag('gameId', gameId);
      setTag('gridSize', gridSize);
      setTag('playerCount', data.playerCount || 2);
      addBreadcrumb({
        category: 'game',
        message: data.playerId ? 'Player joined game' : 'Game started',
        level: 'info',
        data: { gameId, gridSize, playerCount: data.playerCount || 2, role: data.playerId },
      });

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
      // #421: Record game start time when all players join — this ensures
      // duration is always available regardless of how many lines the first
      // game_update carries (fixes '—' duration on 5×5 2P games).
      if (!gameStartTimeRef.current) {
        gameStartTimeRef.current = Date.now();
      }
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
          // Set game start time on first move if not already set by all_players_joined.
          // For reconnection mid-game (currentLineCount >> 1 on first update with no
          // prior gameStartTimeRef), leave it null so duration shows "—" rather than
          // an incorrect value — unless all_players_joined already set it (#421).
          if (!gameStartTimeRef.current && currentLineCount === 1) {
            gameStartTimeRef.current = Date.now();
          }
        }
      }
      // Opponent move sound: plays when a line was placed by opponent without capturing
      // Only triggers when: line count increased + no capture happened + it's now our turn
      // Skip initial sync (0→N where N>1 means reconnect mid-game)
      // Allow 0→1 transition (first move of game) but not 0→2+ (reconnect)
      const isReconnect = prevLineCountRef.current === 0 && currentLineCount > 1;
      if (currentLineCount > prevLineCountRef.current && !isReconnect) {
        const prevTotal = Object.values(prevScores).reduce((a, b) => a + b, 0);
        const currTotal = Object.values(gs.scores || {}).reduce((a, b) => a + b, 0);
        const captureHappened = currTotal > prevTotal;

        // Only play for opponent moves (it's now our turn = opponent just moved)
        // Don't play if capture happened (opponentCapture sound already covers that)
        // Don't play for our own moves (linePlaced already fires in handleLineClick)
        if (!captureHappened && gs.currentPlayer === roleRef.current) {
          initAudio();
          sounds.opponentLinePlaced();
        }
      }

      prevLineCountRef.current = currentLineCount;

      setGameState(gs);
      prevScoresRef.current = gs?.scores || null;

      setWaitingCount(0);

      if (gs.gameOver || gs.winner) {
        // Clear active game tracking — game is over (#365)
        try { localStorage.removeItem('gridlock_active_game'); } catch { /* ignore */ }

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

          // Check grid theme unlocks after recording game stats
          const updatedStats = getStats();
          if (tournamentId && winner === role) {
            try {
              const twKey = 'gridlock_tournament_wins';
              const tw = parseInt(localStorage.getItem(twKey) || '0', 10) + 1;
              localStorage.setItem(twKey, String(tw));
              updatedStats.tournamentWins = tw;
            } catch { /* ignore */ }
          } else {
            try {
              updatedStats.tournamentWins = parseInt(localStorage.getItem('gridlock_tournament_wins') || '0', 10);
            } catch { updatedStats.tournamentWins = 0; }
          }
          const newUnlocked = checkAndUnlockThemes(updatedStats);
          if (newUnlocked.length > 0) {
            newUnlocked.forEach((id) => {
              showToast(`🎨 New theme unlocked: ${GRID_THEMES[id]?.name || id}!`, { type: 'success', duration: 5000 });
            });
          }

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

        // ── Sentry breadcrumb: game ended ────────────────────────────────────
        addBreadcrumb({
          category: 'game',
          message: 'Game ended',
          level: 'info',
          data: { gameId, winner, scores: gs.scores, playerCount: gs.playerCount || 2 },
        });
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
      setTimeout(() => setError(null), 6000);
    };

    const onPlayerLeft = (data) => {
      setError(`${data.username || 'A player'} left the game.`);
      setTimeout(() => setError(null), 6000);
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
    socket.on('player_left',         onPlayerLeft);

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
      socket.off('player_left',         onPlayerLeft);
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
    addBreadcrumb({ category: 'game', message: 'Move made', level: 'info', data: { type, r, c, player: role } });
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
    // During active game, show confirmation modal. After game over or as spectator, leave directly.
    if (gameState && !gameState.gameOver && !isSpectator) {
      setShowLeaveConfirm(true);
    } else {
      doLeaveGame();
    }
  };

  const doLeaveGame = () => {
    setShowLeaveConfirm(false);
    // Clear active game tracking — player voluntarily left (#365)
    try { localStorage.removeItem('gridlock_active_game'); } catch { /* ignore */ }
    // Emit leave_game so the server knows we're leaving voluntarily (#365)
    if (gameId) {
      socket.emit('leave_game', { gameId });
    }
    navigate('/');
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
    const pk = playerKeyFromRole(playerId);
    if (gridTheme.players[pk]) return gridTheme.players[pk].lineColor;
    const cfg = getConfig(playerId);
    return getCSSVar(cfg.colorVar);
  };

  const getPlayerBoxBg = (playerId) => {
    if (!playerId) return undefined;
    const pk = playerKeyFromRole(playerId);
    if (gridTheme.players[pk]) return gridTheme.players[pk].boxBg;
    return undefined;
  };

  const getPlayerLineGlow = (playerId) => {
    if (!playerId) return undefined;
    const pk = playerKeyFromRole(playerId);
    if (gridTheme.players[pk]) return gridTheme.players[pk].lineGlow;
    return undefined;
  };

  const renderDot = (key) => (
    <div
      key={key}
      style={{ width: sizes.dot, height: sizes.dot, flexShrink: 0, flexGrow: 0 }}
      className="flex items-center justify-center z-10"
    >
      <div
        className="rounded-full"
        data-testid="board-dot"
        style={{
          width: Math.min(Math.max(gridTheme.visualDotSize || sizes.visualDot - 2, 5), sizes.dot - 2),
          height: Math.min(Math.max(gridTheme.visualDotSize || sizes.visualDot - 2, 5), sizes.dot - 2),
          backgroundColor: gridTheme.dotColor || 'var(--dot-color)',
          ...gridTheme.dotStyle,
        }}
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
    const ownerGlow = owner ? getPlayerLineGlow(owner) : null;
    const touchHandlers = makeTouchHandler('horizontal', r, c);
    const hLineHeight = sizes.dot;

    return (
      <div
        key={`h-${r}-${c}`}
        data-testid="board-hline"
        onClick={() => handleLineClick('horizontal', r, c)}
        onTouchStart={touchHandlers.onTouchStart}
        onTouchEnd={touchHandlers.onTouchEnd}
        role="button"
        aria-label={`Horizontal line row ${r} col ${c}${owner ? ' (taken)' : ''}`}
        aria-disabled={!isMyTurn}
        tabIndex={isMyTurn ? 0 : -1}
        onKeyDown={(e) => handleLineKeyDown(e, 'horizontal', r, c, isMyTurn)}
        style={{ width: sizes.line, height: hLineHeight, flexShrink: 0, flexGrow: 0, touchAction: 'manipulation' }}
        className={`flex items-center justify-center ${
          owner ? '' : isMyTurn ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div
          className="w-full"
          style={{
            height: gridTheme.lineThickness || sizes.lineThickness,
            backgroundColor: lineColor || gridTheme.emptyLineColor || 'var(--line-empty)',
            opacity: owner ? 1 : isMyTurn ? 0.8 : 0.5,
            boxShadow: owner && ownerGlow && ownerGlow !== 'none' ? ownerGlow : (owner && lineColor ? `0 0 6px ${lineColor}40` : (isMyTurn && currentPlayerColor ? `0 0 8px ${currentPlayerColor}30` : undefined)),
            transition: 'opacity 0.15s, background-color 0.15s',
            ...gridTheme.lineStyle,
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
    const ownerGlow = owner ? getPlayerLineGlow(owner) : null;
    const touchHandlers = makeTouchHandler('vertical', r, c);
    const vLineWidth = sizes.dot;

    return (
      <div
        key={`v-${r}-${c}`}
        data-testid="board-vline"
        onClick={() => handleLineClick('vertical', r, c)}
        onTouchStart={touchHandlers.onTouchStart}
        onTouchEnd={touchHandlers.onTouchEnd}
        role="button"
        aria-label={`Vertical line row ${r} col ${c}${owner ? ' (taken)' : ''}`}
        aria-disabled={!isMyTurn}
        tabIndex={isMyTurn ? 0 : -1}
        onKeyDown={(e) => handleLineKeyDown(e, 'vertical', r, c, isMyTurn)}
        style={{ width: vLineWidth, height: sizes.line, flexShrink: 0, flexGrow: 0, touchAction: 'manipulation' }}
        className={`flex items-center justify-center ${
          owner ? '' : isMyTurn ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div
          className="h-full"
          style={{
            width: gridTheme.lineThickness || sizes.lineThickness,
            backgroundColor: lineColor || gridTheme.emptyLineColor || 'var(--line-empty)',
            opacity: owner ? 1 : isMyTurn ? 0.8 : 0.5,
            boxShadow: owner && ownerGlow && ownerGlow !== 'none' ? ownerGlow : (owner && lineColor ? `0 0 6px ${lineColor}40` : (isMyTurn && currentPlayerColor ? `0 0 8px ${currentPlayerColor}30` : undefined)),
            transition: 'opacity 0.15s, background-color 0.15s',
            ...gridTheme.lineStyle,
          }}
        />
      </div>
    );
  };

  const renderBox = (r, c) => {
    const owner = gameState.boxes[r]?.[c];
    const cfg   = owner ? getConfig(owner) : null;
    const ownerAvatar = owner ? (gameState[`${owner}Avatar`] || cfg.label) : null;
    const themeBoxBg = owner ? getPlayerBoxBg(owner) : undefined;

    return (
      <div
        key={`b-${r}-${c}`}
        data-testid="board-box"
        style={{ width: sizes.line, height: sizes.line, flexShrink: 0, flexGrow: 0 }}
        className="flex items-center justify-center"
      >
        <div
          className="w-full h-full flex items-center justify-center rounded transition-all duration-300"
          style={owner ? { backgroundColor: themeBoxBg || `var(${cfg.bgVar})` } : undefined}
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
                  className="flex justify-between items-center px-2 py-1 rounded-lg winner-score-row"
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

      {/* ── Leave Confirmation Modal (#365) ─────────────────────────────────── */}
      {showLeaveConfirm && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-md animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-modal-title"
          onClick={() => setShowLeaveConfirm(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setShowLeaveConfirm(false); return; }
            // Focus trap: cycle between the two buttons
            if (e.key === 'Tab') {
              const focusable = e.currentTarget.querySelectorAll('button');
              if (focusable.length < 2) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
          }}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center"
            style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl mb-3" aria-hidden="true">🚪</div>
            <h2 id="leave-modal-title" className="text-2xl font-extrabold mb-2" style={{ color: 'var(--text-primary)' }}>
              Leave Game?
            </h2>
            <p className="mb-5" style={{ color: 'var(--text-secondary)' }}>
              Are you sure you want to leave? You'll forfeit this game.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                autoFocus
                onClick={() => setShowLeaveConfirm(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', minHeight: '44px' }}
              >
                Stay
              </button>
              <button
                onClick={doLeaveGame}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                style={{ backgroundColor: 'var(--btn-danger-bg)', color: 'var(--btn-danger-text)', minHeight: '44px' }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

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
            disconnected: !!gameState[`${pid}Disconnected`],
            left: !!gameState[`${pid}Left`],
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
            {gameState?.hasCPU && cpuDifficulty && (
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `color-mix(in srgb, var(--accent) 15%, transparent)`, color: 'var(--accent)' }}>
                {cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1)}
              </span>
            )}
            {tournamentId && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `color-mix(in srgb, var(--warning) 15%, transparent)`, color: 'var(--warning)' }}>🏆 Tournament Match</span>}
          </p>

          {/* Status pill */}
          <div className="flex justify-center">
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-300"
              style={isMyTurnNow ? {
                backgroundColor: `color-mix(in srgb, var(--success) 20%, transparent)`,
                color: 'var(--turn-badge-text, var(--success))',
                transform: 'scale(1.05)',
                boxShadow: `0 0 12px color-mix(in srgb, var(--success) 20%, transparent)`,
                border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
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
        <div className="flex flex-1 items-center justify-center w-full" style={{ overflow: 'hidden', maxHeight: 'calc(100vh - 320px)' }}>
        <div
          className={`relative rounded-2xl shadow-xl select-none board-container mx-auto transition-shadow duration-300 ${
            boardPulse ? 'board-glow' : ''
          } ${gameState && !gameState.gameOver ? 'board-glow-active' : ''}`}
          style={{
            width: sizes.gridTotal || undefined,
            height: sizes.gridTotal || undefined,
            flexShrink: 0,
            overflow: 'hidden',
            backgroundColor: gridTheme.boardBg || 'var(--bg-tertiary)',
            border: gridTheme.boardBorder || `1px solid var(--border-color)`,
            // 'manipulation' enables native pinch-to-zoom + pan but disables
            // double-tap zoom delay, keeping tap response fast for line clicks
            touchAction: 'manipulation',
            ...(boardPulse ? { borderColor: myPlayerColor, '--glow-rgb': myPlayerColor.match(/\w\w/g)?.map(h => parseInt(h, 16)).join(',') || '88,166,255' } : {}),
          }}
        >
          {gameState.horizontalLines.map((row, r) => (
            <div key={`row-${r}`} style={{ flexShrink: 0, flexGrow: 0 }}>
              {/* Dot-HLine-Dot row */}
              <div className="flex items-center" style={{ height: sizes.dot, flexShrink: 0, flexGrow: 0 }}>
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
                <div className="flex items-center" style={{ height: sizes.line, flexShrink: 0, flexGrow: 0 }}>
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
        {chatOpen && (
          <ChatPanel
            onSend={handleChatSend}
            onClose={() => setChatOpen(false)}
          />
        )}
        <ChatOverlay socket={socket} gameId={gameId} />

        {/* ── Bottom toolbar: Mute + Chat + Leave Game (on same row on mobile) ── */}
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

          {/* Chat button — inline in toolbar (#216), hidden in CPU games (#275) */}
          {gameState && !gameState.gameOver && !isSpectator && !isCPUGame && (
            <button
              onClick={() => setChatOpen((prev) => !prev)}
              disabled={chatCooldown}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all active:scale-90 shadow-sm"
              style={{
                backgroundColor: chatCooldown ? 'var(--bg-surface)' : chatOpen ? 'var(--accent)' : 'var(--bg-surface)',
                color: chatOpen ? 'var(--text-on-accent)' : 'var(--text-primary)',
                minHeight: '44px',
                minWidth: '44px',
                opacity: chatCooldown ? 0.6 : 1,
                cursor: chatCooldown ? 'not-allowed' : 'pointer',
              }}
              aria-label={chatCooldown ? 'Chat on cooldown' : 'Quick chat'}
              title={chatCooldown ? 'Chat on cooldown' : 'Quick chat'}
            >
              <span className="text-lg">💬</span>
              <span className="text-xs hidden sm:inline" style={{ color: chatOpen ? 'var(--text-on-accent)' : 'var(--text-secondary)' }}>Chat</span>
            </button>
          )}

          {/* Leave button */}
          <button
            onClick={handleLeaveGame}
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
