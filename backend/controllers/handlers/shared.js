/**
 * Shared constants, state, and utility functions used across all socket handlers.
 * This module is the single source of truth for in-memory state that was previously
 * scattered throughout the monolithic socketHandlers.js.
 */
const crypto = require('crypto');
const Game = require('../../models/Game');
const { initializeGameState, getNextActivePlayer, pickForfeitWinner } = require('../../utils/gameLogic');
const { sanitizeUsername, sanitizeAvatar, sanitizeGameId, validateNumber } = require('../../utils/sanitize');
const { socketLimiter, ipLimiter, normalizeIp } = require('../../middleware/rateLimiter');
const { startLobbyTimer, cancelLobbyTimer, cancelPostgameTimer, startPostgameTimer, clearAllTimers: clearIdleTimers } = require('../../middleware/idleTimeout');
const { validatePayload } = require('../../middleware/socketSchemas');
const gameStore = require('../../stores/gameStore');
const rematchStore = require('../../stores/rematchStore');
const disconnectStore = require('../../stores/disconnectStore');
const { updateLeaderboardWithOptimisticElo } = require('../../services/leaderboardUpdateService');
const { chooseCPUMove, CPU_NAMES, CPU_AVATARS, CPU_DELAYS } = require('../../services/cpuPlayer');
const { sendPushToUser, isUserOnlineInGame } = require('../../services/pushService');
const matchmaking = require('../../services/matchmaking');
const { generateBoardFromSeed, getTodayDateStr, getDayNumber } = require('../../utils/dailyHelpers');
const DailyResult = require('../../models/DailyResult');
const DailyChallenge = require('../../models/DailyChallenge');
const { QUEUE_TIMEOUT_MS } = require('../../services/matchmaking');
const RankedProfile = require('../../models/RankedProfile');
const { calculateRankedElo, calculateRankedEloExchange, calculateRankedDrawExchange, getTierFromElo, PLACEMENT_GAMES_REQUIRED, COOLDOWN_DURATION_MS } = require('../../models/RankedProfile');
const { ALLOWED_QUICK_MESSAGES, ALLOWED_EMOJIS, ALLOWED_CHAT_CONTENT } = require('../../constants/chatConstants');
const Leaderboard = require('../../models/Leaderboard');
const GameHistory = require('../../models/GameHistory');

// Prometheus metrics - safe to require (logs error if module not installed)
let promMetrics;
try { promMetrics = require('../../lib/metrics').metrics; } catch (err) {
  const log = require('../../utils/logger'); log.warn('[metrics] Failed to load metrics module:', err.message);
  promMetrics = null;
}

// ── Constants ────────────────────────────────────────────────────────────────
const DISCONNECT_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 8_000 : 45_000;
// How long the others wait when a player drops on their own turn before play moves on
const TURN_SKIP_MS = process.env.NODE_ENV === 'test' ? 2_000 : 10_000;
const REMATCH_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 5_000 : 30_000;
const CLEANUP_DELAY_MS = 60_000;
const HOST_START_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 5_000 : 30_000;

const PLAYER_COLORS = {
    player1: '#3B82F6',
    player2: '#EF4444',
    player3: '#10B981',
    player4: '#A855F7',
};

// ── In-memory state (shared across handlers) ─────────────────────────────────
const localTimers = new Map();
const rematchTimers = new Map();
const hostStartTimers = new Map();
// gameId -> timer that closes a waiting room if its host does not come back (see disconnectHandler)
const lobbyHostTimers = new Map();
const activeDailyGames = new Map();

// Ranked matchmaking state
const rankedQueue = [];
const rankedQueueIndex = new Map();
const rankedGameMap = new Map();
const RANKED_ELO_RANGE = 200;
const RANKED_ELO_EXPAND_AFTER_MS = 30_000;

// Tournament state
const tournaments = new Map();
const tournamentGames = new Map();

// ── Rate limiters ────────────────────────────────────────────────────────────
const inviteSenderLimiter = {
    _trackers: new Map(),
    _maxPerWindow: 10,
    _windowMs: 5 * 60_000,
    allow(socketId) {
        if (process.env.NODE_ENV === 'test') return true;
        const now = Date.now();
        const tracker = this._trackers.get(socketId);
        if (!tracker || now - tracker.windowStart >= this._windowMs) {
            this._trackers.set(socketId, { count: 1, windowStart: now });
            return true;
        }
        tracker.count++;
        return tracker.count <= this._maxPerWindow;
    },
    cleanup(socketId) {
        this._trackers.delete(socketId);
    },
};

const chatRateLimiter = {
    _trackers: new Map(),
    _minIntervalMs: 2000,
    _maxPerMinute: 10,
    _windowMs: 60_000,
    allow(socketId, _now) {
        const now = _now || Date.now();
        let tracker = this._trackers.get(socketId);
        if (!tracker) {
            tracker = { timestamps: [] };
            this._trackers.set(socketId, tracker);
        }
        tracker.timestamps = tracker.timestamps.filter(t => now - t < this._windowMs);
        if (tracker.timestamps.length > 0 && now - tracker.timestamps[tracker.timestamps.length - 1] < this._minIntervalMs) {
            return false;
        }
        if (tracker.timestamps.length >= this._maxPerMinute) {
            return false;
        }
        tracker.timestamps.push(now);
        return true;
    },
    cleanup(socketId) {
        this._trackers.delete(socketId);
    },
};

// ── Utility functions ────────────────────────────────────────────────────────

function generateSessionToken() {
    return crypto.randomBytes(24).toString('hex');
}

async function generateUniqueGameId(maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = crypto.randomBytes(4).toString('hex').substring(0, 6).toUpperCase();
        const existing = await gameStore.getGame(candidate);
        if (!existing) return candidate;
    }
    return null;
}

function countFilledPlayers(game) {
    return Object.keys(game.players).filter((pid) => !!game.players[pid]).length;
}

function isSpectatorJoinRequest(joinMode) {
    return typeof joinMode === 'string' && joinMode.toLowerCase() === 'spectator';
}

function gameStatusFromPlayers(game) {
    const filled = countFilledPlayers(game);
    if (game.gameState?.winner) return 'finished';
    return filled >= game.playerCount ? 'playing' : 'waiting';
}

function buildGameStateWithPlayers(game) {
    const state = { ...game.gameState };
    let hasCPU = false;
    for (let i = 1; i <= game.playerCount; i++) {
        const playerId = `player${i}`;
        const player = game.players[playerId];
        if (player) {
            state[`${playerId}Name`] = player.username;
            state[`${playerId}Avatar`] = player.avatar;
            state[`${playerId}Color`] = player.color;
            if (player.disconnectedAt) {
                state[`${playerId}Disconnected`] = true;
                if (player.voluntaryLeave) state[`${playerId}Left`] = true;
            }
            if (player.isCPU) {
                state[`${playerId}IsCPU`] = true;
                hasCPU = true;
            }
        } else {
            state[`${playerId}Name`] = `Waiting for Player ${i}...`;
            state[`${playerId}Avatar`] = '⏳';
            state[`${playerId}Color`] = PLAYER_COLORS[playerId];
        }
    }
    state.gameOver = !!state.winner;
    state.hasCPU = hasCPU;
    if (game.cpuDifficulty) state.cpuDifficulty = game.cpuDifficulty;
    return state;
}

function getPlayersList(game) {
    const players = {};
    for (let i = 1; i <= game.playerCount; i++) {
        const playerId = `player${i}`;
        players[playerId] = game.players[playerId] ? game.players[playerId].username : null;
    }
    return players;
}

function findPlayerBySocket(game, socketId) {
    for (let i = 1; i <= game.playerCount; i++) {
        const playerId = `player${i}`;
        if (game.players[playerId]?.id === socketId) {
            return playerId;
        }
    }
    return null;
}

function countCPUPlayers(game) {
    let count = 0;
    for (let i = 1; i <= game.playerCount; i++) {
        if (game.players[`player${i}`]?.isCPU) count++;
    }
    return count;
}

function isTournamentGame(game) {
    return !!(game.metadata?.tournamentId);
}

function buildRotatedPlayers(oldGame, newGameId) {
    const count = oldGame.playerCount;
    const rotated = {};
    for (let i = 1; i <= count; i++) {
        const sourceSlot = `player${((i - 2 + count) % count) + 1}`;
        const targetSlot = `player${i}`;
        const oldPlayer = oldGame.players[sourceSlot];
        if (oldPlayer) {
            rotated[targetSlot] = {
                id: oldPlayer.isCPU ? `cpu-${newGameId}-${i}` : oldPlayer.id,
                username: oldPlayer.username,
                avatar: oldPlayer.avatar,
                color: PLAYER_COLORS[targetSlot],
                token: oldPlayer.isCPU ? `cpu-token-${newGameId}-${i}` : oldPlayer.token,
                disconnectedAt: null,
                ...(oldPlayer.isCPU ? { isCPU: true } : {}),
            };
        }
    }
    return rotated;
}

function startRematchTimeout(io, log, gameId, game) {
    if (rematchTimers.has(gameId)) {
        clearTimeout(rematchTimers.get(gameId));
    }

    const timer = setTimeout(async () => {
        rematchTimers.delete(gameId);
        try {
            const voteCount = await rematchStore.getVoteCount(gameId);
            const cpuVotes = countCPUPlayers(game);
            const totalVotes = voteCount + cpuVotes;
            if (totalVotes < game.playerCount) {
                io.to(gameId).emit('rematch_failed', {
                    reason: 'Not everyone wants to rematch',
                });
                await rematchStore.clearVotes(gameId);
                log.info('Rematch timeout - not unanimous', { gameId, votes: totalVotes, needed: game.playerCount });
            }
        } catch (err) {
            log.error('Rematch timeout handler failed', { gameId, error: err.message });
        }
    }, REMATCH_TIMEOUT_MS);

    rematchTimers.set(gameId, timer);
}

async function persistGame(game, status = null, metadata = null) {
    const now = new Date();
    const finalStatus = status || gameStatusFromPlayers(game);
    const payload = {
        gameId: game.id,
        gridSize: game.gridSize,
        playerCount: game.playerCount,
        players: game.players,
        gameState: game.gameState,
        status: finalStatus,
        lastActivityAt: now,
        updatedAt: now,
    };
    if (game.moveHistory) payload.moveHistory = game.moveHistory;
    if (game.matchType) payload.matchType = game.matchType;
    if (metadata) payload.metadata = { ...(game.metadata || {}), ...metadata };
    if (finalStatus === 'finished' || finalStatus === 'abandoned') payload.finishedAt = now;
    await Game.findOneAndUpdate(
        { gameId: game.id },
        { $set: payload, $setOnInsert: { createdAt: game.createdAt ? new Date(game.createdAt) : now } },
        { upsert: true, new: false }
    );
}

async function markGameFinished(gameId, reason = null) {
    const patch = { status: 'finished', finishedAt: new Date(), updatedAt: new Date(), lastActivityAt: new Date() };
    if (reason) patch['metadata.reason'] = reason;
    await Game.findOneAndUpdate({ gameId }, { $set: patch }, { new: false });
}

async function loadGameFromDB(cleanGameId, log) {
    const doc = await Game.findOne({ gameId: cleanGameId, status: { $in: ['waiting', 'playing'] } }).lean();
    if (!doc) return null;
    const players = doc.players
        ? (doc.players instanceof Map ? Object.fromEntries(doc.players) : doc.players)
        : {};
    const game = {
        id: doc.gameId,
        gridSize: doc.gridSize,
        playerCount: doc.playerCount,
        players,
        gameState: doc.gameState,
        createdAt: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now(),
        metadata: doc.metadata || {},
        moveHistory: doc.moveHistory || [],
    };
    await gameStore.setGame(cleanGameId, game);
    log.info('Loaded game from DB on cache-miss', { gameId: cleanGameId });
    return game;
}

async function restoreActiveGames(log) {
    try {
        const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const docs = await Game.find({
            status: { $in: ['waiting', 'playing'] },
            lastActivityAt: { $gte: staleCutoff },
        }).lean();
        for (const doc of docs) {
            const players = doc.players
                ? (doc.players instanceof Map ? Object.fromEntries(doc.players) : doc.players)
                : {};
            await gameStore.setGame(doc.gameId, {
                id: doc.gameId,
                gridSize: doc.gridSize,
                playerCount: doc.playerCount,
                players,
                gameState: doc.gameState,
                createdAt: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now(),
                metadata: doc.metadata || {},
                moveHistory: doc.moveHistory || [],
            });
        }
        if (docs.length > 0) log.info('Recovered active games from database', { count: docs.length });
    } catch (error) {
        log.error('Failed to restore active games from DB', { error: error.message });
    }
}

/**
 * Skip disconnected players' turns after a move (#365).
 */
function advanceTurnIfNeeded(game) {
    if (game.gameState.winner) return;

    const activePlayers = [];
    for (let i = 1; i <= game.playerCount; i++) {
        const pid = `player${i}`;
        const p = game.players[pid];
        if (p && !p.disconnectedAt) activePlayers.push(pid);
    }
    if (activePlayers.length === 0) return;

    const currentTurn = game.gameState.currentPlayer;
    const currentTurnPlayer = game.players[currentTurn];
    if (currentTurnPlayer && currentTurnPlayer.disconnectedAt) {
        const nextActive = getNextActivePlayer(currentTurn, game.gameState.players, activePlayers);
        if (nextActive) game.gameState.currentPlayer = nextActive;
    }
}

/**
 * Auto-submit daily challenge result server-side on game_over.
 */
async function submitDailyChallengeResult(game, log) {
    if (!game.metadata?.dailyChallenge) return;

    const player1 = game.players?.player1;
    if (!player1 || player1.isCPU) return;

    const username = player1.username;
    const score = game.gameState?.scores?.player1 || 0;
    const moveCount = game.gameState?.moveCount || 0;
    const duration = Math.round((Date.now() - game.createdAt) / 1000);
    const today = getTodayDateStr();

    activeDailyGames.delete(username);

    try {
        const existing = await DailyResult.findOne({ date: today, username });
        if (existing) {
            log.info('Daily result already submitted', { username, date: today });
            return;
        }

        await DailyResult.create({
            date: today,
            username,
            score,
            moves: moveCount,
            duration,
            completedAt: new Date(),
        });

        log.info('Daily challenge result auto-submitted', { username, score, moves: moveCount, duration });
    } catch (err) {
        if (err.code === 11000) return;
        throw err;
    }
}

/**
 * Auto-submit game results to the leaderboard after a game ends.
 */
async function updateLeaderboard(game, winner, log) {
    try {
        const playerEntries = [];
        for (let i = 1; i <= game.playerCount; i++) {
            const pid = `player${i}`;
            const player = game.players[pid];
            if (player && player.username && !player.isCPU) {
                playerEntries.push({ pid, username: player.username });
            }
        }

        if (playerEntries.length === 0) return;

        const usernames = playerEntries.map((p) => p.username);
        const existingRecords = await Leaderboard.find({ username: { $in: usernames } }).lean();
        const eloMap = {};
        for (const rec of existingRecords) {
            eloMap[rec.username] = rec.elo;
        }

        const now = new Date();

        for (const { pid, username } of playerEntries) {
            const isWinner = pid === winner;
            const isDraw = winner === 'draw';
            const result = isDraw ? 'draw' : isWinner ? 'win' : 'loss';
            const opponentElos = playerEntries
                .filter((p) => p.username !== username)
                .map((p) => (Number.isFinite(eloMap[p.username]) ? eloMap[p.username] : 1000));
            const avgOpponentElo =
                opponentElos.length > 0
                    ? Math.round(opponentElos.reduce((a, b) => a + b, 0) / opponentElos.length)
                    : 1000;

            const fallbackElo = Number.isFinite(eloMap[username]) ? eloMap[username] : 1000;

            const updatedDoc = await updateLeaderboardWithOptimisticElo({
                username,
                result,
                avgOpponentElo,
                fallbackElo,
                now,
            });

            eloMap[username] = updatedDoc.elo;
        }

        log.info('Leaderboard updated for game', { gameId: game.id, winner, players: usernames });
    } catch (err) {
        log.error('Failed to update leaderboard', { gameId: game.id, error: err.message });
    }
}

/**
 * Record a GameHistory entry for each player when a game ends.
 */
async function recordGameHistory(game, winner, log) {
    try {
        // Collect ALL players (including CPU) for opponent names and score lookups
        const allPlayers = [];
        const humanEntries = [];
        for (let i = 1; i <= game.playerCount; i++) {
            const pid = `player${i}`;
            const player = game.players[pid];
            if (player && player.username) {
                allPlayers.push({ pid, username: player.username, isCPU: !!player.isCPU });
                if (!player.isCPU) {
                    humanEntries.push({ pid, username: player.username });
                }
            }
        }

        if (humanEntries.length === 0) return;

        const scores = game.gameState?.scores || {};
        const gameDuration = game.createdAt ? Math.round((Date.now() - game.createdAt) / 1000) : null;
        const now = new Date();

        const docs = humanEntries.map(({ pid, username }) => {
            const isWinner = pid === winner;
            const isDraw = winner === 'draw';
            const result = isDraw ? 'draw' : isWinner ? 'win' : 'loss';
            // Include ALL other players (including CPU) as opponents
            const opponents = allPlayers
                .filter((p) => p.pid !== pid)
                .map((p) => p.username);
            const playerScore = Number.isFinite(scores[pid]) ? scores[pid] : 0;
            // Sum scores of ALL opponents (including CPU)
            const opponentScoreSum = allPlayers
                .filter((p) => p.pid !== pid)
                .reduce((sum, p) => sum + (Number.isFinite(scores[p.pid]) ? scores[p.pid] : 0), 0);

            return {
                gameId: game.id,
                username,
                opponents,
                playerCount: game.playerCount,
                gridSize: game.gridSize,
                result,
                scores: { player: playerScore, opponent: opponentScoreSum },
                duration: gameDuration,
                playedAt: now,
            };
        });

        await GameHistory.insertMany(docs, { ordered: false });
        log.info('GameHistory recorded', { gameId: game.id, players: humanEntries.map((p) => p.username) });
    } catch (err) {
        log.error('Failed to record GameHistory', { gameId: game.id, error: err.message });
    }
}

/**
 * Handle post-game-over cleanup: timers, metrics, leaderboard, history, daily, tournament, ranked.
 * Shared between make_move and CPU move paths.
 */
async function handleGameOver(io, log, gameId, game, winner) {
    io.to(gameId).emit('game_over', { winner, scores: game.gameState.scores, totalMoves: game.gameState.moveCount || 0 });
    // Start post-game idle timers for human players (#390)
    for (let i = 1; i <= game.playerCount; i++) {
        const pid = `player${i}`;
        const p = game.players[pid];
        if (p && !p.isCPU && !p.disconnectedAt) {
            const playerSocket = io.sockets.sockets.get(p.id);
            if (playerSocket) startPostgameTimer(playerSocket);
        }
    }
    if (promMetrics) {
        promMetrics.gamesCompletedTotal.inc();
        if (game.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - game.createdAt) / 1000);
    }
    updateLeaderboard(game, winner, log);
    recordGameHistory(game, winner, log);
    submitDailyChallengeResult(game, log).catch(err =>
        log.error('Daily result auto-submit failed', { gameId, error: err.message })
    );
    // Tournament handling is done by the caller since it needs the handler module
}

/**
 * Schedule cleanup of a finished game after CLEANUP_DELAY_MS.
 */
function scheduleGameCleanup(gameId) {
    if (rematchTimers.has(gameId)) {
        clearTimeout(rematchTimers.get(gameId));
        rematchTimers.delete(gameId);
    }
    if (hostStartTimers.has(gameId)) {
        clearTimeout(hostStartTimers.get(gameId));
        hostStartTimers.delete(gameId);
    }
    setTimeout(async () => {
        await gameStore.deleteGame(gameId);
        await gameStore.deleteSpectatorCount(gameId);
        await rematchStore.clearVotes(gameId);
        await markGameFinished(gameId, 'normal');
    }, CLEANUP_DELAY_MS);
}

module.exports = {
    // Constants
    DISCONNECT_TIMEOUT_MS,
    TURN_SKIP_MS,
    REMATCH_TIMEOUT_MS,
    CLEANUP_DELAY_MS,
    HOST_START_TIMEOUT_MS,
    PLAYER_COLORS,
    RANKED_ELO_RANGE,
    RANKED_ELO_EXPAND_AFTER_MS,
    // In-memory state
    localTimers,
    rematchTimers,
    hostStartTimers,
    lobbyHostTimers,
    activeDailyGames,
    rankedQueue,
    rankedQueueIndex,
    rankedGameMap,
    tournaments,
    tournamentGames,
    // Rate limiters
    inviteSenderLimiter,
    chatRateLimiter,
    // Utility functions
    generateSessionToken,
    generateUniqueGameId,
    countFilledPlayers,
    isSpectatorJoinRequest,
    gameStatusFromPlayers,
    buildGameStateWithPlayers,
    getPlayersList,
    findPlayerBySocket,
    countCPUPlayers,
    isTournamentGame,
    buildRotatedPlayers,
    startRematchTimeout,
    persistGame,
    markGameFinished,
    loadGameFromDB,
    restoreActiveGames,
    advanceTurnIfNeeded,
    submitDailyChallengeResult,
    updateLeaderboard,
    recordGameHistory,
    handleGameOver,
    scheduleGameCleanup,
    // Re-exports from dependencies
    gameStore,
    rematchStore,
    disconnectStore,
    matchmaking,
    promMetrics,
    sanitizeUsername,
    sanitizeAvatar,
    sanitizeGameId,
    validateNumber,
    socketLimiter,
    ipLimiter,
    normalizeIp,
    cancelLobbyTimer,
    cancelPostgameTimer,
    startPostgameTimer,
    startLobbyTimer,
    clearIdleTimers,
    validatePayload,
    initializeGameState,
    getNextActivePlayer,
    pickForfeitWinner,
    chooseCPUMove,
    CPU_NAMES,
    CPU_AVATARS,
    CPU_DELAYS,
    sendPushToUser,
    isUserOnlineInGame,
    generateBoardFromSeed,
    getTodayDateStr,
    getDayNumber,
    DailyResult,
    DailyChallenge,
    QUEUE_TIMEOUT_MS,
    RankedProfile,
    calculateRankedElo,
    calculateRankedEloExchange,
    calculateRankedDrawExchange,
    getTierFromElo,
    PLACEMENT_GAMES_REQUIRED,
    COOLDOWN_DURATION_MS,
    ALLOWED_QUICK_MESSAGES,
    ALLOWED_EMOJIS,
    ALLOWED_CHAT_CONTENT,
    Leaderboard,
    GameHistory,
};
