// src/components/Lobby.jsx
// Production-ready lobby — mobile-first, fully adaptive

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { initAudio } from '../utils/sounds';
import socket from '../socket';
import { subscribeToPush } from '../utils/pushManager';
import QuickPlay from './QuickPlay';
import RecentOpponents from './RecentOpponents';
import RankedQueue from './RankedQueue';
import { AvatarGrid, AVATARS, NameInput, PlayerCountSelector, GridSizeSelector, GRID_OPTIONS, GameModeButtons, primaryStyle, secondaryStyle, tertiaryStyle, inactiveOptionStyle, disabledOverlay } from './lobby/index.js';
import { isFirstTime } from '../utils/onboarding';
import GameDemo from './GameDemo';
import { safeStorage } from '../utils/safeStorage';
import { useAuth } from '../contexts/AuthContext';

/** Safely persist to localStorage — swallows quota/private-browsing errors. */
const safePersist = (key, value) => {
  safeStorage.setItem(key, value);
};

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
  const { user } = useAuth();
  const [username,      setUsername]      = useState(() => {
    const saved = safeStorage.getItem('gridlock_username');
    if (saved) return saved;
    // Pre-fill from auth profile if logged in
    return user?.username || user?.displayName || '';
  });
  const [gridSize,      setGridSize]      = useState(() => {
    const saved = parseInt(safeStorage.getItem('gridlock-gridSize'), 10);
    return saved >= 3 && saved <= 6 ? saved : 3;
  });
  const [playerCount,   setPlayerCount]   = useState(() => {
    const saved = parseInt(safeStorage.getItem('gridlock-playerCount'), 10);
    return saved >= 2 && saved <= 4 ? saved : 2;
  });
  const [selectedAvatar, setSelectedAvatar] = useState(() => {
    const saved = safeStorage.getItem('gridlock-avatar');
    return saved && AVATARS.includes(saved) ? saved : '👦';
  });
  const [gameId,        setGameId]        = useState('');
  const [creating,      setCreating]      = useState(false);
  const [joining,       setJoining]       = useState(false);
  const [joinMode,      setJoinMode]      = useState('player'); // 'player' | 'spectator'
  const [tab,           setTab]           = useState(''); // 'create' | 'join' | 'tournament'
  const [cpuEnabled,    setCpuEnabled]    = useState(() => safeStorage.getItem('gridlock-cpuEnabled') === 'true');
  const [cpuCount,      setCpuCount]      = useState(() => {
    const saved = parseInt(safeStorage.getItem('gridlock-cpuCount'), 10);
    const validSaved = saved >= 1 && saved <= 3 ? saved : 1;
    const savedPlayerCount = parseInt(safeStorage.getItem('gridlock-playerCount'), 10) || 2;
    return Math.min(validSaved, savedPlayerCount - 1);
  });
  const [cpuDifficulty, setCpuDifficulty] = useState(() => {
    const saved = safeStorage.getItem('gridlock-cpuDifficulty');
    return ['easy', 'medium', 'hard'].includes(saved) ? saved : 'medium';
  });
  const [tournamentSize, setTournamentSize] = useState(() => {
    const saved = parseInt(safeStorage.getItem('gridlock-tournamentSize'), 10);
    return [4, 8].includes(saved) ? saved : 4;
  });
  const [tournamentGridSize, setTournamentGridSize] = useState(() => {
    const saved = parseInt(safeStorage.getItem('gridlock-tournamentGridSize'), 10);
    return saved >= 3 && saved <= 6 ? saved : 4;
  });
  const [tournamentId, setTournamentId]   = useState('');
  const [creatingTournament, setCreatingTournament] = useState(false);
  const [joiningTournament, setJoiningTournament]   = useState(false);
  const [quickPlaying, setQuickPlaying] = useState(false);
  // Challenge link state (#455)
  const [challengeCreating, setChallengeCreating] = useState(false);
  const [queueSize, setQueueSize] = useState(1);
  const [usernameError, setUsernameError] = useState('');
  const [gameIdError, setGameIdError] = useState('');
  const [tournamentIdError, setTournamentIdError] = useState('');
  // Ranked mode state
  const [rankedPlaying, setRankedPlaying] = useState(false);
  const [shakeTarget, setShakeTarget] = useState(null);
  const [toast, setToast] = useState(null); // { message, type: 'error'|'warning' }
  const [highlightedField, setHighlightedField] = useState(null); // 'username' | 'gameId' | 'tournamentId' | null
  const [rankedElo, setRankedElo] = useState(1200);
  const [rankedTier, setRankedTier] = useState('Bronze');
  const [rankedTierIcon, setRankedTierIcon] = useState('🥉');
  const [rankedQueueSize, setRankedQueueSize] = useState(1);
  const [rankedPlacementProgress, setRankedPlacementProgress] = useState(null);
  const [rankedCooldownUntil, setRankedCooldownUntil] = useState(null);
  // Ranked profile state (#365)
  const [rankedProfile, setRankedProfile] = useState(null);
  const [, setRankedProfileLoading] = useState(false);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [howToPlayDismissed, setHowToPlayDismissed] = useState(() => safeStorage.getItem('gridlock_how_to_play_dismissed') === 'true');
  const [firstTime] = useState(() => isFirstTime());
  // Skip onboarding for logged-in users — user is fetched async so we
  // can't rely on it inside the useState initialiser. Check at render time.
  const showOnboarding = firstTime && !user;
  // Active game banner state (#365)
  const [activeGame, setActiveGame] = useState(() => {
    try {
      const raw = safeStorage.getItem('gridlock_active_game');
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Expire after 15 minutes to reduce staleness window (#374 review)
      if (Date.now() - data.timestamp > 15 * 60 * 1000) {
        safeStorage.removeItem('gridlock_active_game');
        return null;
      }
      return data;
    } catch {
      return null;
    }
  });
  const navigate = useNavigate();
  const usernameInputRef = useRef(null);       // desktop name input
  const mobileUsernameInputRef = useRef(null); // phone name input (inside the collapsible profile panel)
  const gameIdInputRef = useRef(null);
  const tournamentIdInputRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const errorTimerRef = useRef(null);

  // Ref to track which action is in progress — used by onError to route errors (#211)
  const activeActionRef = useRef(null); // 'create' | 'join' | 'createTournament' | 'joinTournament' | null

  // Pre-fill username from auth when user loads asynchronously.
  // Uses "adjusting state during rendering" pattern (no effect needed).
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevUser, setPrevUser] = useState(user);
  if (user !== prevUser) {
    setPrevUser(user);
    if (user?.username && !username) {
      setUsername(user.username);
    }
  }

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(shakeTimerRef.current);
      clearTimeout(toastTimerRef.current);
      clearTimeout(highlightTimerRef.current);
      clearTimeout(errorTimerRef.current);
    };
  }, []);

  // ── Validate rejoin banner against server (#480) ──────────────────────────
  // On mount, if we have an active game in localStorage, ask the server
  // whether the game still exists. If not, clear the banner immediately.
  useEffect(() => {
    if (!activeGame) return;
    const { gameId, sessionToken } = activeGame;
    if (!gameId || !sessionToken) {
      safeStorage.removeItem('gridlock_active_game');
      // Defer state update to avoid sync setState in effect body
      queueMicrotask(() => setActiveGame(null));
      return;
    }
    let cancelled = false;
    socket.emit('validate_rejoin', { gameId, sessionToken }, (response) => {
      if (cancelled) return;
      if (!response || !response.valid) {
        safeStorage.removeItem('gridlock_active_game');
        setActiveGame(null);
      }
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket: game_created ack ────────────────────────────────────────────────
  useEffect(() => {
    const onCreated = ({ gameId: gid, playerId, sessionToken }) => {
      activeActionRef.current = null;
      setCreating(false);
      // If all non-host slots are CPU, skip waiting room → go straight to game
      const cpuPlayers = cpuEnabled ? cpuCount : 0;
      if (cpuPlayers >= playerCount - 1) {
        navigate('/game', {
          state: { username, gridSize, gameId: gid, role: playerId, avatar: selectedAvatar, playerCount, sessionToken },
        });
      } else {
        navigate(`/waiting/${gid}`, {
          state: { username, gameId: gid, gridSize, avatar: selectedAvatar, playerCount, sessionToken, isHost: true, cpuDifficulty: cpuEnabled ? cpuDifficulty : null },
        });
      }
    };

    const onError = (msg) => {
      const errorMsg = typeof msg === 'string' ? msg : 'Something went wrong';
      const action = activeActionRef.current;
      activeActionRef.current = null;

      // Route error to the correct field based on which action triggered it (#211)
      if (action === 'joinTournament' || action === 'createTournament') {
        setTournamentIdError(errorMsg);
      } else if (action === 'join') {
        setGameIdError(errorMsg);
      } else {
        setUsernameError(errorMsg);
      }

      setCreating(false);
      setJoining(false);
      setChallengeCreating(false);
      setCreatingTournament(false);
      setJoiningTournament(false);
    };

    socket.on('game_created', onCreated);
    socket.on('error',        onError);
    return () => {
      socket.off('game_created', onCreated);
      socket.off('error',        onError);
    };
  }, [navigate, username, gridSize, selectedAvatar, playerCount, cpuEnabled, cpuCount, cpuDifficulty]);

  // ── Socket: tournament events ─────────────────────────────────────────────
  useEffect(() => {
    const onTournamentCreated = ({ tournament }) => {
      activeActionRef.current = null;
      setCreatingTournament(false);
      navigate('/tournament', {
        state: { tournament, tournamentId: tournament.tournamentId, username: username.trim(), avatar: selectedAvatar },
      });
    };

    const onTournamentJoined = ({ tournament }) => {
      activeActionRef.current = null;
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

  // ── Socket: Ranked matchmaking events ─────────────────────────────────────
  useEffect(() => {
    const onRankedMatched = ({ gameId: gid, playerId, sessionToken, gridSize: gs, playerCount: pc }) => {
      setRankedPlaying(false);
      navigate('/game', {
        state: {
          username: username.trim(),
          gridSize: gs,
          gameId: gid,
          role: playerId,
          avatar: selectedAvatar,
          playerCount: pc,
          sessionToken,
          ranked: true,
        },
      });
    };

    const onRankedStatus = ({ queueSize: qs, elo, tier, tierIcon }) => {
      setRankedQueueSize(qs);
      if (elo != null) setRankedElo(elo);
      if (tier) setRankedTier(tier);
      if (tierIcon) setRankedTierIcon(tierIcon);
    };

    const onRankedCooldown = ({ cooldownUntil }) => {
      setRankedCooldownUntil(cooldownUntil);
      setRankedPlaying(false);
    };

    // Fix #4: Listen for ranked_game_result — show ELO change after ranked games
    const onRankedGameResult = ({ result, eloChange, newElo, tier, tierIcon, isPlacement, placementProgress }) => {
      setRankedElo(newElo);
      if (tier) setRankedTier(tier);
      if (tierIcon) setRankedTierIcon(tierIcon);
      if (placementProgress) setRankedPlacementProgress(placementProgress);
      // Store result in sessionStorage so game-end screen can display it
      try {
        sessionStorage.setItem('gridlock_ranked_result', JSON.stringify({
          result, eloChange, newElo, tier, tierIcon, isPlacement, placementProgress,
        }));
      } catch { /* sessionStorage full — ignore */ }
    };

    socket.on('ranked_queue_matched', onRankedMatched);
    socket.on('ranked_queue_status', onRankedStatus);
    socket.on('ranked_cooldown', onRankedCooldown);
    socket.on('ranked_game_result', onRankedGameResult);
    return () => {
      socket.off('ranked_queue_matched', onRankedMatched);
      socket.off('ranked_queue_status', onRankedStatus);
      socket.off('ranked_cooldown', onRankedCooldown);
      socket.off('ranked_game_result', onRankedGameResult);
    };
  }, [navigate, username, selectedAvatar]);

  // ── Socket: Ranked profile fetch (#365) ──────────────────────────────────
  useEffect(() => {
    const onRankedProfile = (data) => {
      setRankedProfileLoading(false);
      setRankedProfile(data);
      // Sync ranked state with profile data
      if (data.elo != null) setRankedElo(data.elo);
      if (data.tier) setRankedTier(data.tier);
      if (data.tierIcon) setRankedTierIcon(data.tierIcon);
    };

    socket.on('ranked_profile', onRankedProfile);
    return () => {
      socket.off('ranked_profile', onRankedProfile);
    };
  }, []);

  // Fetch ranked profile on mount and when username changes (#374 review)
  useEffect(() => {
    const name = username.trim();
    if (name && name.length >= 2 && socket.connected) {
      socket.emit('get_ranked_profile', { username: name });
    }
  }, [username]);

  // ── Ref for unmount cleanup (captures latest quickPlaying value) ──────────
  const quickPlayingRef = useRef(quickPlaying);
  useEffect(() => { quickPlayingRef.current = quickPlaying; }, [quickPlaying]);
  const rankedPlayingRef = useRef(rankedPlaying);
  useEffect(() => { rankedPlayingRef.current = rankedPlaying; }, [rankedPlaying]);

  // ── Cleanup: emit queue_leave on unmount if still in queue ──────────────
  useEffect(() => {
    return () => {
      if (quickPlayingRef.current) {
        socket.emit('queue_leave');
      }
      if (rankedPlayingRef.current) {
        socket.emit('ranked_queue_leave', {});
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

  // cpuCount is clamped to playerCount-1 in the playerCount button handler below.
  // The lazy initializer also cross-validates against stored playerCount.

  // ── Validation helper: shake button + scroll/pulse input ─────────────────
  const triggerShake = (target) => {
    setShakeTarget(target);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShakeTarget(null), 500);
  };

  const showToast = (message, type = 'error') => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  const highlightInput = (ref, fieldName) => {
    // On phones the name field lives in the collapsed profile panel: open it and use the
    // phone input (the desktop one is display:none there, so it cannot take focus).
    if (ref === usernameInputRef && window.matchMedia?.('(max-width: 639px)').matches) {
      setProfileExpanded(true);
      ref = mobileUsernameInputRef;
      setTimeout(() => ref.current?.focus({ preventScroll: false }), 60); // after the panel is no longer inert
    }
    if (ref?.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ref.current.focus();
    }
    // Use React state for highlight — imperative style is overwritten by re-render
    setHighlightedField(fieldName);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedField(null), 2500);
  };

  // ── Create Tournament ───────────────────────────────────────────────────────
  const handleCreateTournament = () => {
    const name = username.trim();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('createTournament');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    activeActionRef.current = 'createTournament';
    setCreatingTournament(true);
    socket.emit('create_tournament', { username: name, avatar: selectedAvatar, tournamentSize, gridSize: tournamentGridSize });
  };

  // ── Join Tournament ─────────────────────────────────────────────────────────
  const handleJoinTournament = () => {
    const name = username.trim();
    const id = tournamentId.trim().toUpperCase();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('joinTournament');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!id) {
      setTournamentIdError('Please enter a Tournament ID');
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setTournamentIdError(''), 3000);
      triggerShake('joinTournament');
      highlightInput(tournamentIdInputRef, 'tournamentId');
      showToast('Please enter a Tournament ID');
      return;
    }
    setTournamentIdError('');
    if (!socket.connected) socket.connect();
    activeActionRef.current = 'joinTournament';
    setJoiningTournament(true);
    socket.emit('join_tournament', { tournamentId: id, username: name, avatar: selectedAvatar });
  };

  // ── Quick Play ───────────────────────────────────────────────────────────
  const handleQuickPlay = () => {
    initAudio();
    const name = username.trim();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('quickplay');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    safeStorage.setItem('gridlock_username', name);
    setQuickPlaying(true);
    setQueueSize(1);
    socket.emit('queue_join', { username: name, avatar: selectedAvatar, gridSize, playerCount });
  };

  const handleQuickPlayCancel = () => {
    socket.emit('queue_leave');
    setQuickPlaying(false);
  };

  // ── Ranked Play ──────────────────────────────────────────────────────────
  const handleRankedPlay = () => {
    initAudio();
    const name = username.trim();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('ranked');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    safeStorage.setItem('gridlock_username', name);
    // Use already-fetched profile data — no duplicate fetch (#374 review)
    setRankedPlaying(true);
    setRankedQueueSize(1);
    socket.emit('ranked_queue_join', { username: name, avatar: selectedAvatar, gridSize });
  };

  const handleRankedCancel = () => {
    socket.emit('ranked_queue_leave', {});
    setRankedPlaying(false);
    setRankedCooldownUntil(null);
  };

  // ── Challenge a Friend (#455) ──────────────────────────────────────────────
  const handleCreateChallenge = () => {
    initAudio();
    const name = username.trim();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('challenge');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    safeStorage.setItem('gridlock_username', name);
    activeActionRef.current = 'challenge';
    setChallengeCreating(true);

    socket.emit('create_challenge', { username: name, avatar: selectedAvatar }, (res) => {
      activeActionRef.current = null;
      setChallengeCreating(false);
      if (res?.error) {
        setUsernameError(res.error);
        return;
      }
      if (res?.gameId) {
        const origin = window.location.origin;
        const link = `${origin}/play/${name}`;

        // Navigate to waiting room for the challenge
        navigate(`/waiting/${res.gameId}`, {
          state: {
            username: name,
            gameId: res.gameId,
            gridSize: 3,
            avatar: selectedAvatar,
            playerCount: 2,
            sessionToken: res.sessionToken,
            isHost: true,
            challengeLink: link,
          },
        });
      }
    });
  };

  const handleQuickPlayCPU = (selectedCount) => {
    const pc = selectedCount || playerCount;
    socket.emit('queue_leave');
    setQuickPlaying(false);
    // Create a CPU game with selected player count from Quick Play modal
    const name = username.trim();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('quickplaycpu');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    if (!socket.connected) socket.connect();
    activeActionRef.current = 'create';
    setCreating(true);
    socket.emit('create_game', { gridSize, username: name, avatar: selectedAvatar, playerCount: pc, cpuPlayers: pc - 1, cpuDifficulty: 'medium' }, (res) => {
      if (res?.error) {
        activeActionRef.current = null;
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
            playerCount: pc,
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

  // ── Onboarding: Play Now (first-time user → 3×3 CPU Easy) ────────────────
  const handleOnboardingPlayNow = () => {
    initAudio();
    const name = username.trim();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('onboarding');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    safeStorage.setItem('gridlock_username', name);
    activeActionRef.current = 'create';
    setCreating(true);
    socket.emit('create_game', {
      gridSize: 3,
      username: name,
      avatar: selectedAvatar,
      playerCount: 2,
      cpuPlayers: 1,
      cpuDifficulty: 'easy',
    }, (res) => {
      if (res?.error) {
        activeActionRef.current = null;
        setCreating(false);
        setUsernameError(res.error);
        return;
      }
      if (res?.gameId) {
        setCreating(false);
        navigate('/game', {
          state: {
            username: name,
            gridSize: 3,
            gameId: res.gameId,
            role: res.playerId,
            avatar: selectedAvatar,
            playerCount: 2,
            sessionToken: res.sessionToken,
            cpuDifficulty: 'easy',
            isOnboarding: true,
          },
        });
      } else {
        setCreating(false);
        setUsernameError('Failed to start game. Please try again.');
      }
    });
  };

  // ── Create ──────────────────────────────────────────────────────────────────
  const handleCreate = () => {
    initAudio(); // Unlock AudioContext from user gesture (before gameplay)
    const name = username.trim();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('create');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!socket.connected) socket.connect();
    activeActionRef.current = 'create';
    setCreating(true);
    safeStorage.setItem('gridlock_username', name);
    // Auto-prompt push subscription on first game action
    if (!safeStorage.getItem('gridlock_push_prompted')) {
      safeStorage.setItem('gridlock_push_prompted', 'true');
      subscribeToPush(name, socket.id).then((sub) => {
        if (sub) { safeStorage.setItem('gridlock_push', 'true'); }
      }).catch(() => {});
    }
    const cpuPlayers = cpuEnabled ? cpuCount : 0;
    socket.emit('create_game', { gridSize, username: name, avatar: selectedAvatar, playerCount, cpuPlayers, cpuDifficulty }, (res) => {
      if (res?.error) {
        activeActionRef.current = null;
        setCreating(false);
        setUsernameError(res.error);
        return;
      }
      if (res?.gameId) {
        setCreating(false);
        if (cpuPlayers >= playerCount - 1) {
          navigate('/game', {
            state: {
              username: name, gridSize, gameId: res.gameId, role: res.playerId,
              avatar: selectedAvatar, playerCount, sessionToken: res.sessionToken,
              cpuDifficulty: cpuEnabled ? cpuDifficulty : null,
            },
          });
        } else {
          navigate(`/waiting/${res.gameId}`, {
            state: {
              username: name, gameId: res.gameId, gridSize, avatar: selectedAvatar,
              playerCount, sessionToken: res.sessionToken, isHost: true,
              cpuDifficulty: cpuEnabled ? cpuDifficulty : null,
            },
          });
        }
      }
    });
  };

  // ── Join ────────────────────────────────────────────────────────────────────
  const handleJoin = () => {
    initAudio(); // Unlock AudioContext from user gesture (before gameplay)
    const name = username.trim();
    const id   = gameId.trim().toUpperCase();
    const nameErr = validateUsername(username);
    if (nameErr) {
      setUsernameError(nameErr);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setUsernameError(''), 3000);
      triggerShake('join');
      highlightInput(usernameInputRef, 'username');
      showToast(nameErr);
      return;
    }
    setUsernameError('');
    if (!id) {
      setGameIdError('Please enter a Game ID');
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setGameIdError(''), 3000);
      triggerShake('join');
      highlightInput(gameIdInputRef, 'gameId');
      showToast('Please enter a Game ID');
      return;
    }
    setGameIdError('');

    const tokenKey = `gridlock:session:${id}:${name}`;
    const existingToken = safeStorage.getItem(tokenKey) || null;

    activeActionRef.current = 'join';
    setJoining(true);
    safeStorage.setItem('gridlock_username', name);
    // Auto-prompt push subscription on first game action
    if (!safeStorage.getItem('gridlock_push_prompted')) {
      safeStorage.setItem('gridlock_push_prompted', 'true');
      subscribeToPush(name, socket.id).then((sub) => {
        if (sub) { safeStorage.setItem('gridlock_push', 'true'); }
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
      className="min-h-screen flex items-start justify-center p-2 pt-1 sm:p-4 sm:pt-8 sm:items-center safe-bottom lobby-container"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-lg md:max-w-[720px] lg:max-w-[960px]">

        {/* ── Active Game Rejoin Banner (#365) ── */}
        {activeGame && (
          <div
            className="rounded-xl p-3 px-4 mb-4 flex items-center justify-between gap-3"
            style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--success) 15%, transparent))', border: '1px solid var(--accent)' }}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-lg flex-shrink-0">⚡</span>
              <span className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
                You have an unfinished game
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => navigate(`/join/${activeGame.gameId}`, { state: { autoRejoin: true, username: activeGame.username, avatar: activeGame.avatar } })}
                className="px-3 py-2 min-h-[44px] rounded-lg text-xs font-bold transition-all active:scale-95"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              >
                Rejoin Game
              </button>
              <button
                onClick={() => {
                  safeStorage.removeItem('gridlock_active_game');
                  setActiveGame(null);
                }}
                className="p-1.5 rounded-lg text-xs transition-all active:scale-95 min-w-[44px] min-h-[44px] flex items-center justify-center"
                style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--bg-secondary) 50%, transparent)' }}
                aria-label="Dismiss active game banner"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── New to GridLock? Banner ── */}
        {!howToPlayDismissed && !activeGame && (
          <div
            className="rounded-xl p-3 px-4 mb-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)' }}
          >
            <div className="flex justify-between items-center">
              <Link to="/how-to-play" className="no-underline flex-1 min-h-[44px] flex flex-col justify-center sm:flex-row sm:items-center sm:gap-2">
                <span className="text-sm font-semibold block sm:inline" style={{ color: 'var(--text-primary)' }}>New to GridLock?</span>
                <span className="text-[13px] sm:ml-2 block sm:inline" style={{ color: 'var(--text-secondary)' }}>Learn the rules in 2 minutes →</span>
              </Link>
              <button
                onClick={() => {
                  safeStorage.setItem('gridlock_how_to_play_dismissed', 'true');
                  setHowToPlayDismissed(true);
                }}
                className="bg-transparent border-none cursor-pointer p-2 px-3 text-base min-w-[44px] min-h-[44px] flex items-center justify-center"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}


        {/* ── Title (desktop only — mobile gets compact bar inside card) ── */}
        <div className="lobby-hero text-center mb-3 sm:mb-6 hidden sm:block">
          <h1
            className="gradient-title text-5xl sm:text-6xl font-extrabold bg-clip-text text-transparent leading-tight"
          >
            GridLock
          </h1>
          <p className="text-sm mt-1 tracking-widest uppercase" style={{ color: 'var(--label-color)' }}>Multiplayer · 2–4 Players</p>
        </div>

        {/* ── Card ── */}
        <div
          className="backdrop-blur-md rounded-2xl overflow-clip shadow-2xl"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >
          {/* ── Compact branding bar (mobile only) ── */}
          <div
            className="sm:hidden flex items-center gap-1.5 px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border-color)' }}
          >
            <span className="text-base">🔲</span>
            <h1
              className="gradient-title font-bold text-xl bg-clip-text text-transparent leading-none m-0"
            >
              GridLock
            </h1>
          </div>

          {/* ── First-Time Onboarding View ── */}
          {showOnboarding && (
            <div data-testid="onboarding-view" className="p-6 sm:p-8 text-center space-y-5">
              <div>
                <p className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Welcome! Complete boxes to win.
                </p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Tap lines between dots. Complete a square = you score!
                </p>
              </div>

              <GameDemo />

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-sm mx-auto">
                <input
                  data-testid="onboarding-name-input"
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setUsernameError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleOnboardingPlayNow()}
                  placeholder="Enter your name"
                  maxLength={16}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full sm:flex-1 rounded-xl px-4 py-3 text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
                  style={{
                    background: 'var(--input-bg)',
                    border: usernameError ? '1px solid var(--danger)' : '1px solid var(--border-color-strong)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  data-testid="onboarding-play-now"
                  onClick={handleOnboardingPlayNow}
                  disabled={creating}
                  className="w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                  style={{
                    background: creating ? 'var(--bg-surface)' : 'var(--accent)',
                    color: creating ? 'var(--text-muted)' : 'var(--text-on-accent)',
                    boxShadow: creating ? 'none' : '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)',
                    opacity: !username.trim() && !creating ? 0.7 : 1,
                    animation: shakeTarget === 'onboarding' ? 'shake 0.4s ease-in-out' : 'none',
                  }}
                >
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                      Starting…
                    </span>
                  ) : (
                    '▶ Play Now'
                  )}
                </button>
              </div>

              {usernameError && (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>{usernameError}</p>
              )}
            </div>
          )}

          {/* ── Full Lobby (returning users only) ── */}
          {!showOnboarding && (<>
          {/* ── Username + Avatar (unified profile card) ── */}
          <div className="p-4 sm:p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            {/* ── Mobile: tappable profile row ── */}
            <div className="sm:hidden">
              {/* Collapsed profile row */}
              <button
                onClick={() => setProfileExpanded(!profileExpanded)}
                className="w-full flex items-center gap-3 py-1 bg-transparent border-none cursor-pointer text-left"
                style={{ color: 'var(--text-primary)' }}
                aria-expanded={profileExpanded}
                aria-controls="mobile-profile-panel"
                aria-label="Edit profile"
              >
                {/* Avatar with edit badge */}
                <span className="relative inline-flex flex-shrink-0">
                  <span className="text-3xl">{selectedAvatar}</span>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] leading-none"
                    style={{ background: 'color-mix(in srgb, var(--bg-secondary) 85%, transparent)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
                    aria-hidden="true"
                  >
                    ✎
                  </span>
                </span>
                {/* Username */}
                <span className="flex-1 min-w-0">
                  <span className="text-base font-semibold truncate block" style={{ color: username.trim() ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {username.trim() || 'Enter name…'}
                  </span>
                </span>

              </button>

              {/* Expanded: name input + avatar grid */}
              <div
                id="mobile-profile-panel"
                inert={!profileExpanded}
                className="overflow-hidden transition-all duration-200 ease-in-out"
                style={{ maxHeight: profileExpanded ? '500px' : '0px', opacity: profileExpanded ? 1 : 0 }}
              >
                <div className="pt-3 space-y-3">
                  <NameInput
                    id="lobby-name-input-mobile"
                    inputRef={mobileUsernameInputRef}
                    username={username}
                    usernameError={usernameError}
                    highlighted={highlightedField === 'username'}
                    onChange={(e) => { setUsername(e.target.value); setUsernameError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && (tab === 'join' ? handleJoin() : handleCreate())}
                  />

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Pick Avatar</label>
                    <AvatarGrid selectedAvatar={selectedAvatar} onSelect={setSelectedAvatar} />
                  </div>

                  {username.trim() && (
                    <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      Playing as {selectedAvatar} <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{username.trim()}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Desktop: full form (unchanged) ── */}
            <div className="hidden sm:block">
              <NameInput
                inputRef={usernameInputRef}
                username={username}
                usernameError={usernameError}
                    highlighted={highlightedField === 'username'}
                onChange={(e) => { setUsername(e.target.value); setUsernameError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && (tab === 'join' ? handleJoin() : handleCreate())}
              />

              {/* Avatar — desktop: collapsed/expanded */}
              <div className="mt-3">
                {!profileExpanded ? (
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{selectedAvatar}</span>
                    <button
                      onClick={() => setProfileExpanded(true)}
                      className="text-xs font-semibold px-3 py-1 rounded-lg transition-all active:scale-95"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)', minHeight: '44px', minWidth: '44px' }}
                    >
                      Change
                    </button>
                    {username && (
                      <span className="text-xs lobby-playing-as" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        Playing as <span className="font-bold lobby-username" style={{ color: 'var(--text-primary)' }}>{username}</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Pick Avatar</label>
                    <AvatarGrid selectedAvatar={selectedAvatar} onSelectAndCollapse={(av) => { setSelectedAvatar(av); setProfileExpanded(false); }} />
                    {username && (
                      <p className="text-center mt-2 text-xs lobby-playing-as" style={{ color: 'var(--text-muted)' }}>
                        Playing as {selectedAvatar} <span className="font-bold lobby-username" style={{ color: 'var(--text-primary)' }}>{username}</span>
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Create Game (hero — always visible) ── */}
          <div className="p-4 sm:p-5 space-y-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
            {/* Players — compact pill row on mobile, card grid on desktop */}
            <PlayerCountSelector
              playerCount={playerCount}
              onSelect={(value) => {
                setPlayerCount(value);
                const maxCpu = Math.max(1, value - 1);
                if (cpuCount > maxCpu) setCpuCount(maxCpu);
              }}
            />

            {/* Grid size — compact pills on mobile, card grid on desktop */}
            <GridSizeSelector gridSize={gridSize} onSelect={setGridSize} />

            {/* CPU Toggle — prominent card (#272) */}
            <div>
              <button
                role="switch"
                aria-checked={cpuEnabled}
                aria-label="Add CPU opponents"
                onClick={() => setCpuEnabled(!cpuEnabled)}
                className="w-full py-3 sm:py-4 px-4 sm:px-5 rounded-xl text-left transition-all active:scale-[0.98] flex items-center justify-between gap-3"
                style={cpuEnabled
                  ? { background: 'linear-gradient(135deg, color-mix(in srgb, var(--warning) 18%, transparent), color-mix(in srgb, var(--warning) 10%, transparent))', border: '2px solid color-mix(in srgb, var(--warning) 50%, transparent)', color: 'var(--warning)' }
                  : { background: 'linear-gradient(135deg, color-mix(in srgb, var(--warning) 8%, var(--bg-card)), var(--bg-card))', border: '2px dashed color-mix(in srgb, var(--warning) 30%, var(--border-color-strong))', color: 'var(--text-secondary)' }}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span
                    className="text-2xl sm:text-3xl flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center"
                    style={cpuEnabled
                      ? { background: 'color-mix(in srgb, var(--warning) 25%, transparent)' }
                      : { background: 'color-mix(in srgb, var(--warning) 10%, transparent)' }}
                  >
                    🤖
                  </span>
                  <span className="min-w-0">
                    <span className="text-sm sm:text-base font-bold block" style={{ color: cpuEnabled ? 'var(--warning)' : 'var(--text-primary)' }}>
                      {cpuEnabled ? (
                        <>
                          <span className="sm:hidden">CPU On · {cpuCount} × {cpuDifficulty.charAt(0).toUpperCase() + cpuDifficulty.slice(1)}</span>
                          <span className="hidden sm:inline">Play vs CPU</span>
                        </>
                      ) : (
                        'Add CPU Opponents'
                      )}
                    </span>
                    <span className="text-xs block mt-0.5" style={{ color: cpuEnabled ? 'color-mix(in srgb, var(--warning) 80%, var(--text-secondary))' : 'var(--text-muted)' }}>
                      {cpuEnabled ? 'AI opponents enabled — configure below' : 'Play solo against AI opponents'}
                    </span>
                  </span>
                </span>
                <span className={`w-11 h-6 rounded-full transition-all flex items-center flex-shrink-0 ${cpuEnabled ? 'justify-end' : 'justify-start'}`} style={{ background: cpuEnabled ? 'var(--warning)' : 'var(--bg-card-hover)', boxShadow: cpuEnabled ? '0 0 8px color-mix(in srgb, var(--warning) 40%, transparent)' : 'none' }}>
                  <span className="w-5 h-5 rounded-full shadow mx-0.5 transition-all" style={{ backgroundColor: 'var(--text-primary)' }} />
                </span>
              </button>
            </div>

            {/* CPU Settings (visible when enabled) */}
            {cpuEnabled && (
              <div className="card-surface space-y-3 rounded-xl p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                {/* CPU count */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>
                    CPU Opponents ({cpuCount})
                  </label>
                  <div className="flex gap-2" style={{ maxWidth: playerCount - 1 === 1 ? '50%' : '100%' }}>
                    {Array.from({ length: playerCount - 1 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => setCpuCount(n)}
                        className="flex-1 py-2 rounded-xl text-center text-sm font-bold transition-all active:scale-95 lobby-option-card"
                        style={cpuCount === n
                          ? { background: 'var(--warning)', border: '1px solid var(--warning)', color: 'var(--text-on-warning)', boxShadow: '0 4px 12px color-mix(in srgb, var(--warning) 30%, transparent)' }
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
                          ? { background: 'var(--warning)', border: '1px solid var(--warning)', color: 'var(--text-on-warning)', boxShadow: '0 4px 12px color-mix(in srgb, var(--warning) 30%, transparent)' }
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

            {/* Create Game — PRIMARY action (top, bold accent). It stays pinned (above the tab bar on
                phones and small tablets) so it is never off screen: below the fold on 1366x768 and
                1280x720 laptops, or pushed down by the CPU settings panel. */}
            <div
              className="lobby-cta-bar sticky z-10 -mx-4 px-4 pt-2 pb-2 -my-2 sm:-mx-5 sm:px-5 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] min-[769px]:bottom-3"
              data-testid="create-game-cta"
            >
            <button
              onClick={handleCreate}
              disabled={creating}
              aria-label="Create Game — start a new game room"
              className="w-full py-3 rounded-xl font-bold text-[var(--text-on-accent)] text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: creating ? 'var(--bg-surface)' : 'var(--accent)',
                boxShadow: creating ? 'none' : '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)',
                ...(creating && { color: 'var(--text-muted)' }),
                opacity: !username.trim() && !creating ? 0.7 : 1,
                animation: shakeTarget === 'create' ? 'shake 0.4s ease-in-out' : 'none',
              }}
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

            {/* Quick Play — SECONDARY action */}
            <button
              onClick={handleQuickPlay}
              disabled={quickPlaying || creating}
              aria-label="Quick Play — instant match with random opponents"
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all active:scale-95"
              style={{
                ...primaryStyle(quickPlaying || creating),
                opacity: !username.trim() && !quickPlaying && !creating ? 0.7 : 1,
                animation: shakeTarget === 'quickplay' ? 'shake 0.4s ease-in-out' : 'none',
              }}
            >
              {quickPlaying ? '⏳ Searching…' : '⚡ Quick Play'}
            </button>

            {/* Challenge a Friend (#455) */}
            <button
              onClick={handleCreateChallenge}
              disabled={challengeCreating || creating}
              aria-label="Challenge a Friend — generate a shareable invite link"
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all active:scale-95"
              style={{
                ...secondaryStyle(challengeCreating || creating),
                opacity: !username.trim() && !challengeCreating && !creating ? 0.7 : 1,
                animation: shakeTarget === 'challenge' ? 'shake 0.4s ease-in-out' : 'none',
              }}
            >
              {challengeCreating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                  Creating…
                </span>
              ) : '🔗 Challenge a Friend'}
            </button>
          </div>

          {/* ── Secondary actions — shared mobile chips + desktop buttons ── */}
          <GameModeButtons
            tab={tab}
            creating={creating}
            quickPlaying={quickPlaying}
            rankedPlaying={rankedPlaying}
            username={username}
            rankedProfile={rankedProfile}
            onNavigateDaily={() => navigate('/daily')}
            onRankedPlay={handleRankedPlay}
            onSetTab={setTab}
          />

          {/* ── Join Tab ── */}
          {tab === 'join' && (
            <div className="p-4 sm:p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Game ID</label>
                <input
                  type="text"
                  ref={gameIdInputRef}
                  value={gameId}
                  onChange={(e) => { setGameId(e.target.value.toUpperCase()); setGameIdError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  placeholder="e.g. AB3XYZ"                  maxLength={8}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="join"
                  className="w-full rounded-xl px-4 py-3 text-base font-mono uppercase placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
                  style={{
                    background: 'var(--input-bg)',
                    border: (gameIdError || highlightedField === 'gameId') ? '2px solid var(--danger)' : '1px solid var(--border-color-strong)',
                    boxShadow: highlightedField === 'gameId' ? '0 0 0 3px rgba(239, 68, 68, 0.35)' : 'none',
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
                  aria-pressed={joinMode === 'player'}
                  className="py-2 rounded-xl text-sm font-semibold transition-all"
                  style={joinMode === 'player'
                    ? secondaryStyle(true)
                    : inactiveOptionStyle}
                >
                  🎮 Join as Player
                </button>
                <button
                  onClick={() => setJoinMode('spectator')}
                  aria-pressed={joinMode === 'spectator'}
                  className="py-2 rounded-xl text-sm font-semibold transition-all"
                  style={joinMode === 'spectator'
                    ? secondaryStyle(true)
                    : inactiveOptionStyle}
                >
                  👀 Join as Spectator
                </button>
              </div>

              {/* Join — TERTIARY action */}
              <button
                onClick={handleJoin}
                disabled={joining}
                className="w-full py-3 rounded-xl font-semibold text-sm transition-all active:scale-95"
                style={{
                  ...(joining ? disabledOverlay : tertiaryStyle()),
                  opacity: (!username.trim() || !gameId.trim()) && !joining ? 0.7 : 1,
                  animation: shakeTarget === 'join' ? 'shake 0.4s ease-in-out' : 'none',
                }}
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
            <div className="p-4 sm:p-5 space-y-4">
              {/* Create Tournament Section */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--label-color)' }}>Tournament Size</label>
                <div className="grid grid-cols-2 gap-2">
                  {TOURNAMENT_SIZE_OPTIONS.map(({ value, label, icon, desc }) => (
                    <button
                      key={value}
                      onClick={() => setTournamentSize(value)}
                      className="py-2.5 px-2 rounded-xl text-center transition-all active:scale-95 lobby-option-card"
                      style={tournamentSize === value
                        ? { background: 'var(--warning)', border: '1px solid var(--warning)', color: 'var(--text-on-warning)', boxShadow: '0 4px 12px color-mix(in srgb, var(--warning) 30%, transparent)' }
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
              <GridSizeSelector gridSize={tournamentGridSize} onSelect={setTournamentGridSize} label="Grid Size" />

              {/* Create Tournament — SECONDARY action */}
              <button
                onClick={handleCreateTournament}
                disabled={creatingTournament}
                className="w-full py-3 rounded-xl font-semibold text-sm transition-all active:scale-95"
                style={{
                  ...primaryStyle(creatingTournament),
                  opacity: !username.trim() && !creatingTournament ? 0.7 : 1,
                  animation: shakeTarget === 'createTournament' ? 'shake 0.4s ease-in-out' : 'none',
                }}
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
                  ref={tournamentIdInputRef}
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

              {/* Join Tournament — TERTIARY action */}
              <button
                onClick={handleJoinTournament}
                disabled={joiningTournament}
                className="w-full py-3 rounded-xl font-semibold text-sm transition-all active:scale-95"
                style={{
                  ...(joiningTournament ? disabledOverlay : tertiaryStyle()),
                  opacity: (!username.trim() || !tournamentId.trim()) && !joiningTournament ? 0.7 : 1,
                  animation: shakeTarget === 'joinTournament' ? 'shake 0.4s ease-in-out' : 'none',
                }}
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
          </>)}
        </div>

        <p className="text-center text-xs mt-2 mb-1" style={{ color: 'var(--text-secondary)' }}>GridLock · Made with ❤️ by <a href="https://github.com/DhananjayThomble" target="_blank" rel="noopener noreferrer" className="inline-block px-2 py-3.5 -my-3.5" style={{ color: "var(--accent)", textDecoration: "none" }}>DJ</a></p>

        {/* ── Recent Opponents ── */}
        <RecentOpponents
          username={username.trim()}
          avatar={selectedAvatar}
          gridSize={gridSize}
          playerCount={playerCount}
        />

      </div>

      {/* ── Quick Play Overlay ── */}
      {quickPlaying && (
        <QuickPlay
          gridSize={gridSize}
          playerCount={playerCount}
          queueSize={queueSize}
          username={username.trim()}
          avatar={selectedAvatar}
          onCancel={handleQuickPlayCancel}
          onPlayCPU={handleQuickPlayCPU}
        />
      )}

      {/* ── Ranked Queue Overlay ── */}
      {(rankedPlaying || rankedCooldownUntil) && (
        <RankedQueue
          elo={rankedElo}
          tier={rankedTier}
          tierIcon={rankedTierIcon}
          queueSize={rankedQueueSize}
          placementProgress={rankedPlacementProgress}
          cooldownUntil={rankedCooldownUntil}
          onCancel={handleRankedCancel}
          profile={rankedProfile}
        />
      )}

      {/* Floating toast notification */}
      {toast && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-slide-up"
          style={{
            background: toast.type === 'error' ? 'var(--danger)' : 'var(--warning)',
            color: '#fff',
            maxWidth: '90vw',
          }}
          role="alert"
        >
          <span>{toast.type === 'error' ? '⚠️' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default Lobby;
