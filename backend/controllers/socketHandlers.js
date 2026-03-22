const crypto = require('crypto');
const Game = require('../models/Game');
const Leaderboard = require('../models/Leaderboard');
const GameHistory = require('../models/GameHistory');
const { calculateNewState, initializeGameState, pickForfeitWinner, getNextActivePlayer } = require('../utils/gameLogic');

const { sanitizeUsername, sanitizeAvatar, sanitizeGameId, validateNumber } = require('../utils/sanitize');
const { socketLimiter, ipLimiter, normalizeIp } = require('../middleware/rateLimiter');
const { startLobbyTimer, cancelLobbyTimer, cancelPostgameTimer, startPostgameTimer, clearAllTimers: clearIdleTimers } = require('../middleware/idleTimeout');
const { validatePayload } = require('../middleware/socketSchemas');
const gameStore = require('../stores/gameStore');
const rematchStore = require('../stores/rematchStore');
const disconnectStore = require('../stores/disconnectStore');
const { updateLeaderboardWithOptimisticElo } = require('../services/leaderboardUpdateService');
const { chooseCPUMove, CPU_NAMES, CPU_AVATARS, CPU_DELAYS } = require('../services/cpuPlayer');
const { sendPushToUser, isUserOnlineInGame } = require('../services/pushService');
const matchmaking = require('../services/matchmaking');
const { generateBoardFromSeed, getTodayDateStr, getDayNumber } = require('../utils/dailyHelpers');

// Prometheus metrics - safe to require (logs error if module not installed)
let promMetrics;
try { promMetrics = require('../lib/metrics').metrics; } catch (err) {
  console.warn('[metrics] Failed to load metrics module:', err.message);
  promMetrics = null;
}
const DailyResult = require('../models/DailyResult');
const DailyChallenge = require('../models/DailyChallenge');
const { QUEUE_TIMEOUT_MS } = require('../services/matchmaking');
const RankedProfile = require('../models/RankedProfile');
const { calculateRankedElo, calculateRankedEloExchange, calculateRankedDrawExchange, getTierFromElo, PLACEMENT_GAMES_REQUIRED, COOLDOWN_DURATION_MS } = require('../models/RankedProfile');
const { ALLOWED_QUICK_MESSAGES, ALLOWED_EMOJIS, ALLOWED_CHAT_CONTENT } = require('../constants/chatConstants');

// Track active daily challenge games: username → gameId
// Prevents users from starting multiple daily games simultaneously
const activeDailyGames = new Map();

// Intentionally reduced from 60s → 30s for faster game flow.
// Players get 30s to reconnect before forfeiting; keeps games moving.
const DISCONNECT_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 8_000 : 30_000;
const REMATCH_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 5_000 : 30_000;
const CLEANUP_DELAY_MS = 60_000; // 1 minute delay before removing finished game from store
const HOST_START_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 5_000 : 30_000; // AFK host auto-start

// Node-local timer handles only - state visibility is handled via disconnectStore (Redis)
const localTimers = new Map(); // key: `${gameId}:${playerId}` -> { timer, socketId }
const rematchTimers = new Map(); // key: gameId -> timeout handle
const hostStartTimers = new Map(); // key: gameId -> timeout handle (AFK host auto-start)

const PLAYER_COLORS = {
    player1: '#3B82F6',
    player2: '#EF4444',
    player3: '#10B981',
    player4: '#A855F7',
};

// ── Ranked matchmaking queue (in-memory, 2P only) ───────────────────────────
// Each entry: { socketId, username, avatar, elo, gridSize, joinedAt }
const rankedQueue = [];
const rankedQueueIndex = new Map(); // socketId → username (for O(1) duplicate check)
const rankedGameMap = new Map(); // gameId → { player1Username, player2Username } for ranked games
const RANKED_ELO_RANGE = 200;
const RANKED_ELO_EXPAND_AFTER_MS = 30_000; // Expand matching after 30s wait

// Fix #5: Sender-side rate limiter for game invites - max 10 invites per 5 min per socket
const inviteSenderLimiter = {
    // Map<socketId, { count, windowStart }>
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

// #216: Chat rate limiter - max 1 msg per 2s, max 10 per minute per socket
const chatRateLimiter = {
    // Map<socketId, { timestamps: number[] }>
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
        // Prune timestamps older than 1 minute
        tracker.timestamps = tracker.timestamps.filter(t => now - t < this._windowMs);
        // Check min interval
        if (tracker.timestamps.length > 0 && now - tracker.timestamps[tracker.timestamps.length - 1] < this._minIntervalMs) {
            return false;
        }
        // Check per-minute cap
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

// In-memory tournament state (per-node, as requested by issue #19)
const tournaments = new Map(); // tournamentId -> tournament
const tournamentGames = new Map(); // gameId -> { tournamentId, roundIndex, matchIndex }

function sanitizeTournamentId(input) {
    if (!input || typeof input !== 'string') {
        return { valid: false, value: '', error: 'Tournament ID is required' };
    }

    const cleaned = input.trim().toUpperCase();
    if (!/^T[A-Z0-9]{5}$/.test(cleaned)) {
        return { valid: false, value: '', error: 'Invalid tournament ID format' };
    }

    return { valid: true, value: cleaned };
}

function generateTournamentId(existingTournaments = tournaments, maxAttempts = 16) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = `T${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`;
        if (!existingTournaments.has(candidate)) return candidate;
    }
    return null;
}

function buildTournamentSnapshot(t) {
    return {
        tournamentId: t.tournamentId,
        status: t.status,
        tournamentSize: t.tournamentSize,
        gridSize: t.gridSize,
        participants: t.participants.map((p) => ({ username: p.username, avatar: p.avatar })),
        rounds: t.rounds,
        champion: t.champion || null,
    };
}

function initializeBracket(participants) {
    const rounds = [];
    const firstRoundMatches = [];
    for (let i = 0; i < participants.length; i += 2) {
        firstRoundMatches.push({
            player1: participants[i]?.username || null,
            player2: participants[i + 1]?.username || null,
            winner: null,
            gameId: null,
        });
    }
    rounds.push({ matches: firstRoundMatches });

    let remaining = firstRoundMatches.length;
    while (remaining > 1) {
        remaining = Math.floor(remaining / 2);
        rounds.push({
            matches: Array.from({ length: remaining }, () => ({
                player1: null,
                player2: null,
                winner: null,
                gameId: null,
            })),
        });
    }

    return rounds;
}

function getTournamentJoinError(tournament, username, socketId) {
    if (!tournament) return 'Tournament not found';
    if (tournament.status !== 'waiting') return 'Tournament already started';
    if (tournament.participants.length >= tournament.tournamentSize) return 'Tournament is full';
    if (tournament.participants.some((p) => p.username === username)) return 'Username already joined this tournament';
    if (tournament.participants.some((p) => p.socketId === socketId)) return 'You have already joined this tournament';
    return null;
}

function generateSessionToken() {
    return crypto.randomBytes(24).toString('hex');
}

/**
 * Generate a unique 6-char hex game ID with collision check against gameStore.
 * Retries up to maxAttempts times. Returns null if all attempts collide.
 */
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

/**
 * Count CPU players in a game.
 */
function countCPUPlayers(game) {
    let count = 0;
    for (let i = 1; i <= game.playerCount; i++) {
        if (game.players[`player${i}`]?.isCPU) count++;
    }
    return count;
}

/**
 * Check if a game is a tournament game.
 */
function isTournamentGame(game) {
    return !!(game.metadata?.tournamentId);
}

/**
 * Build rotated players map: shifts turn order by 1 position.
 * player1 becomes player2's old player, etc.
 */
function buildRotatedPlayers(oldGame, newGameId) {
    const count = oldGame.playerCount;
    const rotated = {};
    for (let i = 1; i <= count; i++) {
        // Slot i gets the player from slot ((i - 2 + count) % count) + 1
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

/**
 * Start the rematch timeout for a game. After REMATCH_TIMEOUT_MS,
 * if not all players have voted, emit rematch_failed.
 */
function startRematchTimeout(io, log, gameId, game) {
    // Clear any existing timer
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

async function createTournamentMatchGame({ tournament, roundIndex, matchIndex, p1, p2 }) {
    const gameId = await generateUniqueGameId();
    if (!gameId) throw new Error('Failed to generate unique game ID after retries');
    const p1Token = generateSessionToken();
    const p2Token = generateSessionToken();

    const game = {
        id: gameId,
        gridSize: tournament.gridSize,
        playerCount: 2,
        players: {
            player1: {
                id: p1.socketId,
                username: p1.username,
                avatar: p1.avatar,
                color: PLAYER_COLORS.player1,
                token: p1Token,
                disconnectedAt: null,
            },
            player2: {
                id: p2.socketId,
                username: p2.username,
                avatar: p2.avatar,
                color: PLAYER_COLORS.player2,
                token: p2Token,
                disconnectedAt: null,
            },
        },
        gameState: initializeGameState(tournament.gridSize, 2),
        createdAt: Date.now(),
        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS, tournamentId: tournament.tournamentId },
    };

    await gameStore.setGame(gameId, game);
    await persistGame(game, 'playing', { tournamentId: tournament.tournamentId, roundIndex, matchIndex });

    tournamentGames.set(gameId, { tournamentId: tournament.tournamentId, roundIndex, matchIndex });
    tournament.rounds[roundIndex].matches[matchIndex].gameId = gameId;

    return {
        gameId,
        assignments: [
            { socketId: p1.socketId, playerId: 'player1', sessionToken: p1Token, username: p1.username },
            { socketId: p2.socketId, playerId: 'player2', sessionToken: p2Token, username: p2.username },
        ],
    };
}

/**
 * Issue #2: Auto-submit daily challenge result server-side on game_over.
 * Uses actual game state (scores, moveCount) - no client-supplied data.
 * Fire-and-forget: errors are logged but don't affect game flow.
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

    // Clean up active daily game tracking
    activeDailyGames.delete(username);

    try {
        // Check for duplicate submission
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
        // Duplicate key is fine - means result was already saved
        if (err.code === 11000) return;
        throw err;
    }
}

/**
 * Auto-submit game results to the leaderboard after a game ends.
 * Runs fire-and-forget (errors are logged but don't affect game flow).
 *
 * @param {object} game   - The game object with players and gameState
 * @param {string} winner - The winning playerId ('player1', 'player2', etc.) or 'draw'
 * @param {object} log    - Logger instance
 */
async function updateLeaderboard(game, winner, log) {
    try {
        // Collect all player usernames for cross-ELO lookup
        const playerEntries = [];
        for (let i = 1; i <= game.playerCount; i++) {
            const pid = `player${i}`;
            const player = game.players[pid];
            if (player && player.username && !player.isCPU) {
                playerEntries.push({ pid, username: player.username });
            }
        }

        if (playerEntries.length === 0) return;

        // Fetch current ELO values for all participants once (snapshot per match)
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
 * Runs fire-and-forget (errors are logged but don't affect game flow).
 *
 * @param {object} game   - The game object with players, gameState, createdAt, gridSize
 * @param {string} winner - The winning playerId ('player1', 'player2', etc.) or 'draw'
 * @param {object} log    - Logger instance
 */
async function recordGameHistory(game, winner, log) {
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

        const scores = game.gameState?.scores || {};
        const gameDuration = game.createdAt ? Math.round((Date.now() - game.createdAt) / 1000) : null;
        const now = new Date();

        const docs = playerEntries.map(({ pid, username }) => {
            const isWinner = pid === winner;
            const isDraw = winner === 'draw';
            const result = isDraw ? 'draw' : isWinner ? 'win' : 'loss';
            const opponents = playerEntries
                .filter((p) => p.username !== username)
                .map((p) => p.username);
            const playerScore = Number.isFinite(scores[pid]) ? scores[pid] : 0;
            const opponentScoreSum = playerEntries
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
        log.info('GameHistory recorded', { gameId: game.id, players: playerEntries.map((p) => p.username) });
    } catch (err) {
        log.error('Failed to record GameHistory', { gameId: game.id, error: err.message });
    }
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

async function maybeStartTournamentRound(io, tournament, roundIndex) {
    const round = tournament.rounds[roundIndex];
    if (!round) return;

    for (let i = 0; i < round.matches.length; i++) {
        const match = round.matches[i];
        if (match.gameId || !match.player1 || !match.player2) continue;

        const p1 = tournament.participants.find((p) => p.username === match.player1);
        const p2 = tournament.participants.find((p) => p.username === match.player2);
        if (!p1 || !p2) continue;

        const { gameId, assignments } = await createTournamentMatchGame({
            tournament,
            roundIndex,
            matchIndex: i,
            p1,
            p2,
        });

        for (const assignment of assignments) {
            io.to(assignment.socketId).emit('tournament_game_assigned', {
                tournamentId: tournament.tournamentId,
                gameId,
                playerId: assignment.playerId,
                sessionToken: assignment.sessionToken,
                gridSize: tournament.gridSize,
                playerCount: 2,
            });
        }
    }
}

function applyTournamentMatchResult(tournament, roundIndex, matchIndex, winnerUsername) {
    const round = tournament.rounds?.[roundIndex];
    const match = round?.matches?.[matchIndex];
    if (!match || match.winner || !winnerUsername) {
        return { advancedRoundIndex: null, tournamentCompleted: false };
    }

    match.winner = winnerUsername;
    const isFinalRound = roundIndex === tournament.rounds.length - 1;

    if (isFinalRound) {
        tournament.status = 'finished';
        tournament.champion = winnerUsername;
        return { advancedRoundIndex: null, tournamentCompleted: true };
    }

    const nextRoundIndex = roundIndex + 1;
    const nextRound = tournament.rounds[nextRoundIndex];
    const nextMatchIndex = Math.floor(matchIndex / 2);
    const nextMatch = nextRound?.matches?.[nextMatchIndex];

    if (!nextMatch) {
        return { advancedRoundIndex: null, tournamentCompleted: false };
    }

    if (matchIndex % 2 === 0) nextMatch.player1 = winnerUsername;
    else nextMatch.player2 = winnerUsername;

    return { advancedRoundIndex: nextRoundIndex, tournamentCompleted: false };
}

async function handleTournamentGameCompletion(io, log, gameId, game, winnerPlayerId) {
    const index = tournamentGames.get(gameId);
    if (!index) return;

    const tournament = tournaments.get(index.tournamentId);
    if (!tournament) return;

    const winnerUsername = winnerPlayerId === 'draw'
        ? game.players.player1?.username
        : game.players[winnerPlayerId]?.username;

    const progression = applyTournamentMatchResult(
        tournament,
        index.roundIndex,
        index.matchIndex,
        winnerUsername
    );
    if (!winnerUsername || (!progression.tournamentCompleted && progression.advancedRoundIndex === null)) return;

    if (progression.tournamentCompleted) {
        io.to(`tournament:${tournament.tournamentId}`).emit('tournament_completed', {
            tournamentId: tournament.tournamentId,
            champion: winnerUsername,
        });
    } else if (progression.advancedRoundIndex !== null) {
        await maybeStartTournamentRound(io, tournament, progression.advancedRoundIndex);
    }

    io.to(`tournament:${tournament.tournamentId}`).emit('tournament_update', {
        tournament: buildTournamentSnapshot(tournament),
    });

    if (tournament.status === 'finished') {
        log.info('Tournament completed', { tournamentId: tournament.tournamentId, champion: tournament.champion });
    }
}

/**
 * Skip disconnected players' turns after a move (#365).
 * If the current-turn player is disconnected, advance to the next active player.
 * Shared helper to avoid duplicating this logic in make_move and CPU move paths.
 *
 * @param {object} game   - The game object with players and gameState
 * @param {object} log    - Logger instance (unused currently, reserved for debug)
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
 * Schedule a CPU move if the current player is a CPU.
 * Checks game state, computes move, applies it via calculateNewState,
 * persists, broadcasts, and recurses if the CPU still has the turn.
 */
function scheduleCPUMove(io, log, gameId, delay) {
    setTimeout(async () => {
        try {
            let game = await gameStore.getGame(gameId);
            if (!game) {
                game = await loadGameFromDB(gameId, log);
                if (!game) return;
            }
            if (game.gameState.winner) return;

            const currentPlayerId = game.gameState.currentPlayer;
            const currentPlayer = game.players[currentPlayerId];
            if (!currentPlayer || !currentPlayer.isCPU) return;

            const difficulty = game.cpuDifficulty || 'medium';
            const move = chooseCPUMove(game.gameState, difficulty);
            if (!move) return;

            const newState = calculateNewState(game.gameState, game.gridSize, move.r, move.c, move.type);
            if (newState.error) {
                log.error('CPU move error', { gameId, error: newState.error });
                return;
            }

            // Preserve moveCount across state replacement
            const prevMoveCount = game.gameState.moveCount;
            game.gameState = newState;
            if (typeof prevMoveCount === 'number') {
                game.gameState.moveCount = prevMoveCount + 1;
            }

            // Skip disconnected players' turns (#365)
            advanceTurnIfNeeded(game);

            // Record CPU move in history for replay
            if (!game.moveHistory) game.moveHistory = [];
            game.moveHistory.push({
                player: currentPlayerId,
                row: move.r,
                col: move.c,
                type: move.type === 'horizontal' ? 'h' : 'v',
                timestamp: new Date(),
            });

            await gameStore.setGame(gameId, game);

            const status = newState.winner ? 'finished' : 'playing';
            await persistGame(game, status, newState.winner ? { reason: 'normal' } : null);

            io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

            if (newState.winner) {
                // Issue #3: include totalMoves in game_over
                io.to(gameId).emit('game_over', { winner: newState.winner, scores: newState.scores, totalMoves: game.gameState.moveCount || 0 });
                // Start post-game idle timers for human players (#390)
                for (let pi = 1; pi <= game.playerCount; pi++) {
                    const pid = `player${pi}`;
                    const p = game.players[pid];
                    if (p && !p.isCPU && !p.disconnectedAt) {
                        const playerSocket = io.sockets.sockets.get(p.id);
                        if (playerSocket) startPostgameTimer(playerSocket);
                    }
                }
                // Prometheus: record game completion + duration
                if (promMetrics) {
                    promMetrics.gamesCompletedTotal.inc();
                    if (game.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - game.createdAt) / 1000);
                }
                updateLeaderboard(game, newState.winner, log);
                recordGameHistory(game, newState.winner, log);
                // Issue #2: auto-submit daily challenge result server-side
                submitDailyChallengeResult(game, log).catch(err =>
                    log.error('Daily result auto-submit failed (CPU path)', { gameId, error: err.message })
                );
                await handleTournamentGameCompletion(io, log, gameId, game, newState.winner);
                // Defensive cleanup: clear any lingering rematch timer
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
                    await rematchStore.clearVotes(gameId);
                    await markGameFinished(gameId, 'normal');
                }, CLEANUP_DELAY_MS);
            } else {
                // Check if next player is also CPU
                const nextPlayerId = newState.currentPlayer;
                const nextPlayer = game.players[nextPlayerId];
                if (nextPlayer && nextPlayer.isCPU) {
                    const nextDelay = CPU_DELAYS[difficulty] || 1200;
                    scheduleCPUMove(io, log, gameId, nextDelay);
                }
            }
        } catch (err) {
            log.error('CPU move scheduling failed', { gameId, error: err.message });
        }
    }, delay);
}

/**
 * Remove a socket from the ranked queue.
 */
function removeFromRankedQueue(socketId) {
    const idx = rankedQueue.findIndex(e => e.socketId === socketId);
    if (idx !== -1) rankedQueue.splice(idx, 1);
    rankedQueueIndex.delete(socketId);
}

/**
 * Try to find a ranked match for a player in the queue.
 * Matches players within ±200 ELO (expands after 30s wait).
 */
async function tryRankedMatch(io, log, triggerSocket) {
    if (rankedQueue.length < 2) return;

    const now = Date.now();

    // Try to find a pair that matches ELO criteria + same grid size
    for (let i = 0; i < rankedQueue.length; i++) {
        for (let j = i + 1; j < rankedQueue.length; j++) {
            const a = rankedQueue[i];
            const b = rankedQueue[j];

            if (a.gridSize !== b.gridSize) continue;

            const eloDiff = Math.abs(a.elo - b.elo);
            const aWaitMs = now - a.joinedAt;
            const bWaitMs = now - b.joinedAt;
            const maxWait = Math.max(aWaitMs, bWaitMs);

            // Expand range after 30s wait
            const effectiveRange = maxWait >= RANKED_ELO_EXPAND_AFTER_MS
                ? RANKED_ELO_RANGE * 2
                : RANKED_ELO_RANGE;

            if (eloDiff > effectiveRange) continue;

            // Match found! Remove both from queue (remove higher index first)
            removeFromRankedQueue(b.socketId);
            removeFromRankedQueue(a.socketId);

            // Create a ranked game
            await createRankedGame(io, log, a, b);
            return;
        }
    }
}

/**
 * Create a ranked 2P game for two matched players.
 */
async function createRankedGame(io, log, playerA, playerB) {
    const gameId = await generateUniqueGameId();
    if (!gameId) {
        log.error('Failed to generate ranked game ID');
        return;
    }

    const initialState = initializeGameState(playerA.gridSize, 2);
    const tokenA = generateSessionToken();
    const tokenB = generateSessionToken();

    const game = {
        id: gameId,
        gridSize: playerA.gridSize,
        playerCount: 2,
        players: {
            player1: {
                id: playerA.socketId,
                username: playerA.username,
                avatar: playerA.avatar,
                color: PLAYER_COLORS.player1,
                token: tokenA,
                disconnectedAt: null,
            },
            player2: {
                id: playerB.socketId,
                username: playerB.username,
                avatar: playerB.avatar,
                color: PLAYER_COLORS.player2,
                token: tokenB,
                disconnectedAt: null,
            },
        },
        gameState: initialState,
        createdAt: Date.now(),
        matchType: 'ranked',
        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS, ranked: true },
    };

    // Track this as a ranked game
    rankedGameMap.set(gameId, {
        player1Username: playerA.username,
        player2Username: playerB.username,
    });

    await gameStore.setGame(gameId, game);
    await persistGame(game, 'playing', { ranked: true });

    // Join sockets to game room and emit matched event
    const assignments = [
        { socketId: playerA.socketId, playerId: 'player1', sessionToken: tokenA, username: playerA.username, elo: playerA.elo },
        { socketId: playerB.socketId, playerId: 'player2', sessionToken: tokenB, username: playerB.username, elo: playerB.elo },
    ];

    for (const assignment of assignments) {
        const playerSocket = io.sockets.sockets.get(assignment.socketId);
        if (playerSocket) {
            playerSocket.join(gameId);
            playerSocket.data.gameId = gameId;
            playerSocket.data.playerId = assignment.playerId;
            playerSocket.data.rankedQueue = false;
            playerSocket.data.username = assignment.username;

            const gameStateWithPlayers = buildGameStateWithPlayers(game);
            playerSocket.emit('ranked_queue_matched', {
                gameId,
                playerId: assignment.playerId,
                sessionToken: assignment.sessionToken,
                gridSize: game.gridSize,
                playerCount: 2,
                players: getPlayersList(game),
                gameState: gameStateWithPlayers,
                ranked: true,
            });
        }
    }

    io.to(gameId).emit('all_players_joined', { gameId });

    log.info('Ranked match created', {
        gameId,
        player1: playerA.username,
        player2: playerB.username,
        eloDiff: Math.abs(playerA.elo - playerB.elo),
    });
}

/**
 * Handle ranked game disconnect: apply auto-loss + cooldown to the disconnecting player.
 * Uses zero-sum ELO: both players exchange the same amount.
 */
async function handleRankedDisconnect(io, gameId, disconnectedPlayerId, game, log) {
    // Atomically claim this game to prevent TOCTOU race with handleRankedGameEnd
    const rankedInfo = rankedGameMap.get(gameId);
    if (!rankedInfo) return;
    rankedGameMap.delete(gameId);

    const disconnectedPlayer = game.players[disconnectedPlayerId];
    if (!disconnectedPlayer) return;

    const disconnectedUsername = disconnectedPlayer.username;
    const opponentPlayerId = disconnectedPlayerId === 'player1' ? 'player2' : 'player1';
    const opponentPlayer = game.players[opponentPlayerId];
    if (!opponentPlayer) return;

    const opponentUsername = opponentPlayer.username;

    // Get profiles
    const [disconnectedProfile, opponentProfile] = await Promise.all([
        RankedProfile.findOne({ username: disconnectedUsername }),
        RankedProfile.findOne({ username: opponentUsername }),
    ]);

    if (!disconnectedProfile || !opponentProfile) return;

    // Capture pre-game ELO BEFORE any mutations (Fix #9)
    const preDisconnectedElo = disconnectedProfile.elo;
    const preOpponentElo = opponentProfile.elo;

    const isPlacementDisc = disconnectedProfile.isInPlacement();
    const isPlacementOpp = opponentProfile.isInPlacement();

    // Zero-sum exchange: opponent wins, disconnected player loses (Fix #3)
    const eloChange = calculateRankedEloExchange(preOpponentElo, preDisconnectedElo, isPlacementOpp, isPlacementDisc);

    // Disconnected player loses ELO + gets cooldown
    disconnectedProfile.elo = Math.max(0, preDisconnectedElo - eloChange);
    disconnectedProfile.losses += 1;
    disconnectedProfile.cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS);
    disconnectedProfile.lastPlayedAt = new Date();
    if (isPlacementDisc) {
        disconnectedProfile.placementGames.push({
            result: 'loss',
            opponentElo: preOpponentElo,
            eloAfter: disconnectedProfile.elo,
        });
    }
    await disconnectedProfile.save();

    // Opponent gains same amount of ELO
    opponentProfile.elo = preOpponentElo + eloChange;
    opponentProfile.wins += 1;
    opponentProfile.lastPlayedAt = new Date();
    if (isPlacementOpp) {
        opponentProfile.placementGames.push({
            result: 'win',
            opponentElo: preDisconnectedElo,
            eloAfter: opponentProfile.elo,
        });
    }
    await opponentProfile.save();

    // Emit ranked game results (Fix #4 - these need a frontend listener)
    const opponentTier = getTierFromElo(opponentProfile.elo);
    const discTier = getTierFromElo(disconnectedProfile.elo);

    const opponentSocket = io.sockets?.sockets?.get(opponentPlayer.id);
    if (opponentSocket) {
        opponentSocket.emit('ranked_game_result', {
            result: 'win',
            eloChange: eloChange,
            newElo: opponentProfile.elo,
            tier: opponentTier.name,
            tierIcon: opponentTier.icon,
            isPlacement: isPlacementOpp,
            placementProgress: isPlacementOpp ? `${opponentProfile.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    const discSocket = io.sockets?.sockets?.get(disconnectedPlayer.id);
    if (discSocket) {
        discSocket.emit('ranked_game_result', {
            result: 'loss',
            eloChange: -eloChange,
            newElo: disconnectedProfile.elo,
            tier: discTier.name,
            tierIcon: discTier.icon,
            isPlacement: isPlacementDisc,
            placementProgress: isPlacementDisc ? `${disconnectedProfile.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    log.info('Ranked disconnect penalty applied', {
        gameId,
        disconnected: disconnectedUsername,
        eloChange,
        newElo: disconnectedProfile.elo,
        cooldownMinutes: COOLDOWN_DURATION_MS / 60000,
    });
}

/**
 * Handle end of a ranked game (normal completion or draw).
 * Uses zero-sum ELO: both players exchange the same amount.
 * Accepts `io` as first parameter for socket emission.
 */
async function handleRankedGameEnd(io, gameId, winnerPlayerId, game, log) {
    // Atomically claim this game to prevent TOCTOU race with handleRankedDisconnect
    const rankedInfo = rankedGameMap.get(gameId);
    if (!rankedInfo) return;
    rankedGameMap.delete(gameId);

    const isDraw = winnerPlayerId === 'draw';
    const player1 = game.players.player1;
    const player2 = game.players.player2;

    if (!player1 || !player2) return;

    const [profile1, profile2] = await Promise.all([
        RankedProfile.findOne({ username: player1.username }),
        RankedProfile.findOne({ username: player2.username }),
    ]);

    if (!profile1 || !profile2) return;

    // Capture pre-game ELO BEFORE any mutations (Fix #9)
    const preElo1 = profile1.elo;
    const preElo2 = profile2.elo;

    const isPlacement1 = profile1.isInPlacement();
    const isPlacement2 = profile2.isInPlacement();

    let result1, result2, eloChange1, eloChange2;

    if (isDraw) {
        // Draw: use draw exchange formula (Fix #8)
        // For zero-sum draws: player1 change = -player2 change
        const drawChange1 = calculateRankedDrawExchange(preElo1, preElo2, isPlacement1, isPlacement2);
        eloChange1 = drawChange1;
        eloChange2 = -drawChange1;
        result1 = 'draw';
        result2 = 'draw';
    } else {
        // Win/loss: zero-sum exchange (Fix #3)
        const winnerIsPlayer1 = winnerPlayerId === 'player1';
        const winnerElo = winnerIsPlayer1 ? preElo1 : preElo2;
        const loserElo = winnerIsPlayer1 ? preElo2 : preElo1;
        const winnerIsPlacement = winnerIsPlayer1 ? isPlacement1 : isPlacement2;
        const loserIsPlacement = winnerIsPlayer1 ? isPlacement2 : isPlacement1;

        const exchange = calculateRankedEloExchange(winnerElo, loserElo, winnerIsPlacement, loserIsPlacement);

        eloChange1 = winnerIsPlayer1 ? exchange : -exchange;
        eloChange2 = winnerIsPlayer1 ? -exchange : exchange;
        result1 = winnerIsPlayer1 ? 'win' : 'loss';
        result2 = winnerIsPlayer1 ? 'loss' : 'win';
    }

    // Apply ELO changes
    profile1.elo = Math.max(0, preElo1 + eloChange1);
    profile2.elo = Math.max(0, preElo2 + eloChange2);

    // Update win/loss/draw counters
    if (result1 === 'win') profile1.wins += 1;
    else if (result1 === 'loss') profile1.losses += 1;
    else if (result1 === 'draw') profile1.draws += 1;

    if (result2 === 'win') profile2.wins += 1;
    else if (result2 === 'loss') profile2.losses += 1;
    else if (result2 === 'draw') profile2.draws += 1;

    profile1.lastPlayedAt = new Date();
    profile2.lastPlayedAt = new Date();

    // Record placement games using pre-mutation opponent ELO (Fix #9)
    if (isPlacement1) {
        profile1.placementGames.push({
            result: result1,
            opponentElo: preElo2,
            eloAfter: profile1.elo,
        });
    }
    if (isPlacement2) {
        profile2.placementGames.push({
            result: result2,
            opponentElo: preElo1,
            eloAfter: profile2.elo,
        });
    }

    await Promise.all([profile1.save(), profile2.save()]);

    // Emit ranked game results to both players
    const tier1 = getTierFromElo(profile1.elo);
    const tier2 = getTierFromElo(profile2.elo);

    const socket1 = io.sockets?.sockets?.get(player1.id);
    if (socket1) {
        socket1.emit('ranked_game_result', {
            result: result1,
            eloChange: eloChange1,
            newElo: profile1.elo,
            tier: tier1.name,
            tierIcon: tier1.icon,
            isPlacement: isPlacement1,
            placementProgress: isPlacement1 ? `${profile1.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    const socket2 = io.sockets?.sockets?.get(player2.id);
    if (socket2) {
        socket2.emit('ranked_game_result', {
            result: result2,
            eloChange: eloChange2,
            newElo: profile2.elo,
            tier: tier2.name,
            tierIcon: tier2.icon,
            isPlacement: isPlacement2,
            placementProgress: isPlacement2 ? `${profile2.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    log.info('Ranked game ended', {
        gameId,
        result: isDraw ? 'draw' : `winner=${winnerPlayerId}`,
        player1Elo: `${preElo1} → ${profile1.elo}`,
        player2Elo: `${preElo2} → ${profile2.elo}`,
    });
}

function attachSocketHandlers(io, log) {
    restoreActiveGames(log);

    io.on('connection', (socket) => {
        log.info('New client connected:', socket.id);

        // Use the raw transport address - NOT x-forwarded-for, which clients can spoof.
        // Socket.IO doesn't inherit Express's trust-proxy settings, so XFF is unvalidated.
        // If deployed behind a known reverse proxy, configure TRUSTED_PROXY_IPS env var
        // and only then fall back to XFF for the real client IP.
        const rawAddr = socket.conn?.remoteAddress || socket.handshake?.address || 'unknown';
        const trustedProxies = process.env.TRUSTED_PROXY_IPS ? process.env.TRUSTED_PROXY_IPS.split(',').map(s => s.trim()).filter(Boolean) : [];
        const socketIP = normalizeIp(
            (trustedProxies.length > 0 && trustedProxies.includes(rawAddr))
                ? (socket.handshake?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || rawAddr)
                : rawAddr
        );

        const rateLimited = (eventName) => {
            if (!socketLimiter.allow(socket.id, eventName)) {
                log.warn('Rate limited socket event', { socketId: socket.id, eventName });
                socket.emit('error', 'Too many requests. Please slow down.');
                return true;
            }
            // IP-based rate limiting for abuse-prone events
            if (!ipLimiter.allow(socketIP, eventName)) {
                log.warn('IP rate limited socket event', { ip: socketIP, eventName });
                socket.emit('error', 'Too many requests from your network. Please slow down.');
                return true;
            }
            return false;
        };

        /**
         * Validate and sanitize a socket event payload.
         * Returns the validated payload or null (with error emitted).
         * Detailed validation errors are logged server-side only; clients get generic messages.
         */
        const validate = (eventName, payload) => {
            const result = validatePayload(eventName, payload);
            if (!result.valid) {
                log.warn('Payload validation failed', { socketId: socket.id, eventName, error: result.detailedError || result.error });
                socket.emit('error', result.error);
                return null;
            }
            return result.value;
        };

        // ── create_tournament ─────────────────────────────────────────────────
        socket.on('create_tournament', async (rawPayload) => {
            try {
                if (rateLimited('create_tournament')) return;
                // Cancel idle timers — player is creating a tournament (#390)
                cancelLobbyTimer(socket.id);
                cancelPostgameTimer(socket.id);
                const validated = validate('create_tournament', rawPayload);
                if (!validated) return;
                const { username, avatar, tournamentSize = 4, gridSize = 3 } = validated;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }

                const size = Number(tournamentSize);
                if (![4, 8].includes(size)) { socket.emit('error', 'Tournament size must be 4 or 8'); return; }

                const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
                if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

                const tournamentId = generateTournamentId();
                if (!tournamentId) {
                    socket.emit('error', 'Failed to generate tournament ID. Please try again.');
                    return;
                }

                const tournament = {
                    tournamentId,
                    status: 'waiting',
                    tournamentSize: size,
                    gridSize: gridResult.value,
                    participants: [{ username: uResult.value, avatar: sanitizeAvatar(avatar), socketId: socket.id }],
                    rounds: [],
                    champion: null,
                };

                tournaments.set(tournamentId, tournament);
                socket.join(`tournament:${tournamentId}`);
                socket.data.tournamentId = tournamentId;
                socket.emit('tournament_created', { tournament: buildTournamentSnapshot(tournament) });
            } catch (error) {
                log.error('Error creating tournament', { error: error.message });
                socket.emit('error', 'Failed to create tournament');
            }
        });

        // ── join_tournament ───────────────────────────────────────────────────
        socket.on('join_tournament', async (rawPayload) => {
            try {
                if (rateLimited('join_tournament')) return;
                // Cancel idle timers — player is joining a tournament (#390)
                cancelLobbyTimer(socket.id);
                cancelPostgameTimer(socket.id);
                const validated = validate('join_tournament', rawPayload);
                if (!validated) return;
                const { tournamentId, username, avatar } = validated;

                const tidResult = sanitizeTournamentId(tournamentId);
                if (!tidResult.valid) { socket.emit('error', tidResult.error); return; }
                const cleanTournamentId = tidResult.value;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;

                const tournament = tournaments.get(cleanTournamentId);
                const joinError = getTournamentJoinError(tournament, cleanUsername, socket.id);
                if (joinError) { socket.emit('error', joinError); return; }

                tournament.participants.push({
                    username: cleanUsername,
                    avatar: sanitizeAvatar(avatar),
                    socketId: socket.id,
                });
                socket.join(`tournament:${cleanTournamentId}`);
                socket.data.tournamentId = cleanTournamentId;

                io.to(`tournament:${cleanTournamentId}`).emit('tournament_update', {
                    tournament: buildTournamentSnapshot(tournament),
                });
                socket.emit('tournament_joined', { tournament: buildTournamentSnapshot(tournament) });

                if (tournament.participants.length === tournament.tournamentSize) {
                    tournament.status = 'in_progress';
                    tournament.rounds = initializeBracket(tournament.participants);

                    // Push notification: "Tournament starting in 2 min!" to all participants
                    for (const p of tournament.participants) {
                        try {
                            sendPushToUser(p.username, {
                                title: '🏆 Tournament Starting!',
                                body: 'Tournament starting in 2 min! Get ready!',
                                url: `/tournament/${cleanTournamentId}`,
                                tag: `tournament-start-${cleanTournamentId}`,
                            }).catch(() => {});
                        } catch (_) { /* push is best-effort */ }
                    }

                    await maybeStartTournamentRound(io, tournament, 0);
                    io.to(`tournament:${cleanTournamentId}`).emit('tournament_update', {
                        tournament: buildTournamentSnapshot(tournament),
                    });
                }
            } catch (error) {
                log.error('Error joining tournament', { error: error.message });
                socket.emit('error', 'Failed to join tournament');
            }
        });

        // ── get_tournament_state ──────────────────────────────────────────────
        // Issue #214: The 4th player joining a tournament may miss the
        // tournament_game_assigned event because their TournamentLobby
        // component hasn't mounted its listener yet.  This handler lets
        // the client query the current tournament state on mount so it
        // can recover missed game assignments.
        socket.on('get_tournament_state', async (rawPayload) => {
            try {
                if (rateLimited('get_tournament_state')) return;
                const validated = validate('get_tournament_state', rawPayload);
                if (!validated) return;
                const { tournamentId: rawTid } = validated;

                const tidResult = sanitizeTournamentId(rawTid);
                if (!tidResult.valid) { socket.emit('error', tidResult.error); return; }
                const cleanTournamentId = tidResult.value;

                const tournament = tournaments.get(cleanTournamentId);
                if (!tournament) { socket.emit('error', 'Tournament not found'); return; }

                // Find the requesting player in the tournament by socket id
                const participant = tournament.participants.find((p) => p.socketId === socket.id);
                if (!participant) {
                    // Not a participant - just send the snapshot
                    socket.emit('tournament_update', { tournament: buildTournamentSnapshot(tournament) });
                    return;
                }

                // If tournament hasn't started yet, send current state
                if (tournament.status === 'waiting') {
                    socket.emit('tournament_update', { tournament: buildTournamentSnapshot(tournament) });
                    return;
                }

                // Tournament is in progress or finished - check if this player
                // has a pending game assignment they may have missed
                const playerUsername = participant.username;

                for (const round of tournament.rounds) {
                    for (const match of round.matches) {
                        if (!match.gameId) continue;
                        if (match.winner) continue; // game already finished
                        if (match.player1 !== playerUsername && match.player2 !== playerUsername) continue;

                        // Found a match for this player - look up the game to get session details
                        const game = await gameStore.getGame(match.gameId);
                        if (!game) continue;

                        // Find which playerId slot this user occupies
                        for (let i = 1; i <= game.playerCount; i++) {
                            const pid = `player${i}`;
                            const player = game.players[pid];
                            if (player && player.username === playerUsername) {
                                // Re-emit the assignment to this socket only
                                socket.emit('tournament_game_assigned', {
                                    tournamentId: cleanTournamentId,
                                    gameId: match.gameId,
                                    playerId: pid,
                                    sessionToken: player.token,
                                    gridSize: tournament.gridSize,
                                    playerCount: 2,
                                });
                                return;
                            }
                        }
                    }
                }

                // No pending game assignment - just send the tournament snapshot
                socket.emit('tournament_update', { tournament: buildTournamentSnapshot(tournament) });
            } catch (error) {
                log.error('Error handling get_tournament_state', { error: error.message });
                socket.emit('error', 'Failed to get tournament state');
            }
        });

        // ── create_game ────────────────────────────────────────────────────────
        socket.on('create_game', async (rawPayload, callback) => {
            try {
                if (rateLimited('create_game')) return;
                // Cancel idle timers — player is actively creating a game (#390)
                cancelLobbyTimer(socket.id);
                cancelPostgameTimer(socket.id);
                const validated = validate('create_game', rawPayload);
                if (!validated) return;
                const { gridSize, username, avatar, playerCount = 2, cpuPlayers = 0, cpuDifficulty = 'medium', dailyChallenge = false, dailySeed = null } = validated;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
                if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

                const pcResult = validateNumber(playerCount, 2, 4, 'Player count');
                if (!pcResult.valid) { socket.emit('error', pcResult.error); return; }

                // Validate CPU params
                const cpuCount = Math.max(0, Math.min(Math.floor(Number(cpuPlayers) || 0), pcResult.value - 1));
                const validDifficulties = ['easy', 'medium', 'hard'];
                const cleanDifficulty = validDifficulties.includes(cpuDifficulty) ? cpuDifficulty : 'medium';

                // ── Daily challenge replay protection ────────────────────────
                const isDailyChallenge = dailyChallenge === true && dailySeed;
                if (isDailyChallenge) {
                    // Fix #2: Validate dailySeed matches today's UTC date
                    const todayStr = getTodayDateStr();
                    if (dailySeed !== todayStr) {
                        socket.emit('error', 'Invalid daily challenge seed');
                        return;
                    }

                    // Fix #1: Check if user already completed today's challenge
                    const existingResult = await DailyResult.findOne({ date: todayStr, username: cleanUsername });
                    if (existingResult) {
                        socket.emit('error', 'Already completed today\'s challenge');
                        return;
                    }

                    // Fix #1: Check if user already has an active daily game
                    if (activeDailyGames.has(cleanUsername)) {
                        socket.emit('error', 'You already have an active daily challenge game');
                        return;
                    }
                }

                const gameId = await generateUniqueGameId();
                if (!gameId) { socket.emit('error', 'Failed to generate game ID. Please try again.'); return; }
                const initialState = initializeGameState(gridResult.value, pcResult.value);

                // Issue #3: add moveCount tracker to game state
                initialState.moveCount = 0;

                // Issue #1: server-side board generation for daily challenges
                // Never trust client board - generate from seed server-side
                if (isDailyChallenge) {
                    const board = generateBoardFromSeed(dailySeed, gridResult.value);
                    // Apply pre-drawn lines onto initial state
                    // Pre-drawn lines use 1/0; game state uses playerId/null
                    // Mark pre-drawn lines as 'predrawn' so they don't count as player moves
                    for (let r = 0; r < board.predrawnH.length; r++) {
                        for (let c = 0; c < board.predrawnH[r].length; c++) {
                            if (board.predrawnH[r][c] === 1) {
                                initialState.horizontalLines[r][c] = 'predrawn';
                            }
                        }
                    }
                    for (let r = 0; r < board.predrawnV.length; r++) {
                        for (let c = 0; c < board.predrawnV[r].length; c++) {
                            if (board.predrawnV[r][c] === 1) {
                                initialState.verticalLines[r][c] = 'predrawn';
                            }
                        }
                    }
                }

                const sessionToken = generateSessionToken();

                const game = {
                    id: gameId,
                    gridSize: gridResult.value,
                    playerCount: pcResult.value,
                    players: {
                        player1: {
                            id: socket.id,
                            username: cleanUsername,
                            avatar: cleanAvatar,
                            color: PLAYER_COLORS.player1,
                            token: sessionToken,
                            disconnectedAt: null,
                        },
                    },
                    gameState: initialState,
                    createdAt: Date.now(),
                    metadata: {
                        reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                        // Issue #1: track daily challenge metadata for server-side result submission
                        ...(isDailyChallenge ? { dailyChallenge: true, dailySeed } : {}),
                    },
                    cpuDifficulty: cpuCount > 0 ? cleanDifficulty : null,
                };

                // Add CPU players immediately
                for (let i = 0; i < cpuCount; i++) {
                    const cpuSlot = `player${i + 2}`;
                    game.players[cpuSlot] = {
                        id: `cpu-${gameId}-${i}`,
                        username: CPU_NAMES[i] || `Bot-${i + 1}`,
                        avatar: CPU_AVATARS[i] || '🤖',
                        color: PLAYER_COLORS[cpuSlot],
                        token: `cpu-token-${gameId}-${i}`,
                        disconnectedAt: null,
                        isCPU: true,
                    };
                }

                await gameStore.setGame(gameId, game);
                socket.join(gameId);
                socket.data.gameId = gameId;
                socket.data.playerId = 'player1';
                socket.data.username = cleanUsername;

                // Track active daily challenge game
                if (isDailyChallenge) {
                    activeDailyGames.set(cleanUsername, gameId);
                }

                const filled = countFilledPlayers(game);
                const isFull = filled === game.playerCount;
                await persistGame(game, isFull ? 'playing' : 'waiting');
                log.info('Game created', { gameId, playerCount: game.playerCount, username: cleanUsername, cpuPlayers: cpuCount });

                const gameStateWithPlayers = buildGameStateWithPlayers(game);
                // If a callback was provided, the caller handles its own navigation.
                // Skip the game_created event emit to avoid a race condition where
                // the Lobby's listener navigates before the callback-based caller
                // (e.g., RecentOpponents) can show its toast/UI.
                if (!callback) {
                    socket.emit('game_created', { gameId, playerId: 'player1', sessionToken });
                }
                socket.emit('game_started', {
                    gameId, playerId: 'player1', sessionToken,
                    gridSize: game.gridSize, playerCount: game.playerCount,
                    players: getPlayersList(game), gameState: gameStateWithPlayers,
                    cpuDifficulty: game.cpuDifficulty,
                });

                if (isFull) {
                    io.to(gameId).emit('all_players_joined', { gameId });
                    // If first turn belongs to a CPU, trigger it
                    const firstPlayer = game.players[game.gameState.currentPlayer];
                    if (firstPlayer && firstPlayer.isCPU) {
                        const delay = CPU_DELAYS[cleanDifficulty] || 1200;
                        scheduleCPUMove(io, log, gameId, delay);
                    }
                }

                if (callback) callback({ gameId, playerId: 'player1', sessionToken });
            } catch (error) {
                log.error('Error creating game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to create game');
            }
        });

        // ── join_game ──────────────────────────────────────────────────────────
        socket.on('join_game', async (rawPayload) => {
            try {
                if (rateLimited('join_game')) return;
                // Cancel idle timers — player is actively joining a game (#390)
                cancelLobbyTimer(socket.id);
                cancelPostgameTimer(socket.id);
                const validated = validate('join_game', rawPayload);
                if (!validated) return;
                const { gameId, username, avatar, sessionToken, joinMode } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                // Load from Redis (shared across nodes) then DB fallback
                let game = await gameStore.getGame(cleanGameId);
                if (!game) {
                    game = await loadGameFromDB(cleanGameId, log);
                    if (!game) { socket.emit('error', 'Game not found'); return; }
                }

                // Spectator path: join room read-only and receive live updates
                if (isSpectatorJoinRequest(joinMode)) {
                    // Cap spectators to prevent unbounded resource usage (#374 review)
                    const MAX_SPECTATORS = 20;
                    const currentSpectators = await gameStore.getSpectatorCount(cleanGameId);
                    if (currentSpectators >= MAX_SPECTATORS) {
                        socket.emit('error', 'Spectator limit reached for this game');
                        return;
                    }

                    // Prevent spectator from rejoining as player mid-game
                    // (they chose spectator mode - they stay as spectator)
                    socket.join(cleanGameId);
                    socket.data.gameId = cleanGameId;
                    socket.data.playerId = 'spectator';
                    socket.data.isSpectator = true;
                    socket.data.spectatorUsername = cleanUsername;
                    socket.data.username = cleanUsername;

                    // Track spectator count atomically via dedicated Redis counter (#303)
                    const spectatorCount = await gameStore.adjustSpectatorCount(cleanGameId, +1);
                    game.spectatorCount = spectatorCount;
                    await gameStore.setGame(cleanGameId, game);

                    socket.emit('game_started', {
                        gameId: cleanGameId,
                        playerId: 'spectator',
                        role: 'spectator',
                        gridSize: game.gridSize,
                        playerCount: game.playerCount,
                        players: getPlayersList(game),
                        gameState: buildGameStateWithPlayers(game),
                        spectatorCount: game.spectatorCount,
                    });
                    // Notify all in room (players + other spectators) of updated count
                    io.to(cleanGameId).emit('spectator_count', { count: game.spectatorCount });
                    socket.to(cleanGameId).emit('spectator_joined', { username: cleanUsername, count: game.spectatorCount });
                    return;
                }

                // Reconnect path: username already in game
                for (let i = 1; i <= game.playerCount; i++) {
                    const playerId = `player${i}`;
                    const player = game.players[playerId];
                    if (player && player.username === cleanUsername) {
                        // Fix #13: Token comparison uses === (not timing-safe). Acceptable
                        // for socket session tokens — not passwords, server-side only.
                        if (!sessionToken || sessionToken !== player.token) {
                            log.warn('Rejected reconnect due to invalid token', { gameId: cleanGameId, playerId, username: cleanUsername });
                            socket.emit('error', 'Invalid session token for this username');
                            return;
                        }

                        // Cancel local timer if this node set it
                        const timerKey = `${cleanGameId}:${playerId}`;
                        if (localTimers.has(timerKey)) {
                            clearTimeout(localTimers.get(timerKey).timer);
                            localTimers.delete(timerKey);
                        }
                        // Clear disconnect state in Redis (visible to ALL nodes - cancels cross-node timers)
                        await disconnectStore.clearDisconnect(cleanGameId, playerId);

                        player.id = socket.id;
                        player.avatar = cleanAvatar || player.avatar;
                        player.disconnectedAt = null;
                        await gameStore.setGame(cleanGameId, game);
                        socket.join(cleanGameId);
                        socket.data.gameId = cleanGameId;
                        socket.data.playerId = playerId;
                        socket.data.isSpectator = false;
                        socket.data.username = cleanUsername;
                        await persistGame(game);

                        socket.emit('game_started', {
                            gameId: cleanGameId, playerId,
                            sessionToken: player.token,
                            gridSize: game.gridSize, playerCount: game.playerCount,
                            players: getPlayersList(game),
                            gameState: buildGameStateWithPlayers(game),
                        });
                        socket.to(cleanGameId).emit('player_reconnected', { playerId, username: cleanUsername });
                        return;
                    }
                }

                // Guard: prevent spectator from escalating to player by re-emitting join_game
                if (socket.data.isSpectator) {
                    socket.emit('error', 'Spectators cannot join as players. Leave and rejoin to play.');
                    return;
                }

                // New join path
                let assignedSlot = null;
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    if (!game.players[pid]) { assignedSlot = pid; break; }
                }
                if (!assignedSlot) { socket.emit('error', 'Game is full'); return; }

                const newSessionToken = generateSessionToken();
                game.players[assignedSlot] = {
                    id: socket.id,
                    username: cleanUsername,
                    avatar: cleanAvatar,
                    color: PLAYER_COLORS[assignedSlot],
                    token: newSessionToken,
                    disconnectedAt: null,
                };

                socket.join(cleanGameId);
                socket.data.gameId = cleanGameId;
                socket.data.playerId = assignedSlot;
                socket.data.isSpectator = false;
                socket.data.username = cleanUsername;
                const filled = countFilledPlayers(game);
                const cpuCount = countCPUPlayers(game);
                // Fix #3: Full-human rooms stay 'waiting' until host-start/AFK auto-start
                const status = (filled === game.playerCount && cpuCount > 0) ? 'playing' : 'waiting';
                await gameStore.setGame(cleanGameId, game);
                await persistGame(game, status);

                const gameStateWithPlayers = buildGameStateWithPlayers(game);

                // Fix #5: Emit player_joined BEFORE game_started so waiting room updates first
                io.to(cleanGameId).emit('player_joined', {
                    gameId: cleanGameId, slot: assignedSlot,
                    username: cleanUsername, avatar: cleanAvatar,
                    filled, playerCount: game.playerCount,
                });

                socket.emit('game_started', {
                    gameId: cleanGameId, playerId: assignedSlot, sessionToken: newSessionToken,
                    gridSize: game.gridSize, playerCount: game.playerCount,
                    players: getPlayersList(game), gameState: gameStateWithPlayers,
                });
                socket.to(cleanGameId).emit('game_started', {
                    gameId: cleanGameId,
                    gridSize: game.gridSize, playerCount: game.playerCount,
                    players: getPlayersList(game), gameState: gameStateWithPlayers,
                });

                // Push notification to game creator that a player joined (fire-and-forget)
                try {
                    const creator = game.players.player1;
                    if (creator && !creator.isCPU && creator.username !== cleanUsername) {
                        if (!isUserOnlineInGame(io, creator.username, cleanGameId, game)) {
                            sendPushToUser(creator.username, {
                                title: '🎮 Player Joined!',
                                body: `${cleanUsername} joined your game`,
                                url: `/join/${cleanGameId}`,
                                tag: `join-${cleanGameId}`,
                            }).catch(() => {});
                        }
                    }
                } catch (_) { /* push is best-effort */ }

                if (filled === game.playerCount) {
                    // Check if there are any CPU players
                    const cpuCount = countCPUPlayers(game);
                    if (cpuCount > 0) {
                        // Has CPUs — auto-start (existing behavior)
                        io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });
                    } else {
                        // All human players — let host click Start (with AFK timeout)
                        const deadline = Date.now() + HOST_START_TIMEOUT_MS;
                        io.to(cleanGameId).emit('room_full', { gameId: cleanGameId, autoStartAt: deadline });

                        // AFK host auto-start timer
                        if (hostStartTimers.has(cleanGameId)) clearTimeout(hostStartTimers.get(cleanGameId));
                        hostStartTimers.set(cleanGameId, setTimeout(async () => {
                            hostStartTimers.delete(cleanGameId);
                            try {
                                const g = await gameStore.getGame(cleanGameId);
                                if (!g || g.gameState?.winner) return;
                                // Fix #1: Use started flag instead of currentPlayer (which is set at init)
                                if (g.started) return;
                                // Only auto-start if room is still full and game hasn't started
                                const f = countFilledPlayers(g);
                                if (f < g.playerCount) return;
                                g.started = true;
                                await gameStore.setGame(cleanGameId, g);
                                await persistGame(g, 'playing');
                                // Fix #5: Emit game_started per-player (like start_game_early does)
                                // so WaitingRoom clients navigate correctly
                                const gsWithPlayers = buildGameStateWithPlayers(g);
                                for (let i = 1; i <= g.playerCount; i++) {
                                    const pid = `player${i}`;
                                    const player = g.players[pid];
                                    if (player && !player.isCPU) {
                                        const playerSocket = io.sockets.sockets.get(player.id);
                                        if (playerSocket) {
                                            playerSocket.emit('game_started', {
                                                gameId: cleanGameId,
                                                playerId: pid,
                                                sessionToken: player.token,
                                                gridSize: g.gridSize,
                                                playerCount: g.playerCount,
                                                players: getPlayersList(g),
                                                gameState: gsWithPlayers,
                                            });
                                        }
                                    }
                                }
                                io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });
                                log.info('Game auto-started (AFK host timeout)', { gameId: cleanGameId });
                            } catch (err) {
                                log.error('AFK host auto-start failed', { gameId: cleanGameId, error: err.message });
                            }
                        }, HOST_START_TIMEOUT_MS));
                    }
                }
            } catch (error) {
                log.error('Error joining game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to join game');
            }
        });


        // ── lobby_state — return current lobby state to the requester ─────────
        socket.on('lobby_state', async (rawPayload) => {
            try {
                if (rateLimited('lobby_state')) return;
                const validated = validate('lobby_state', rawPayload);
                if (!validated) return;
                const { gameId } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                // Fix #3: Only allow players who have joined the game room
                if (!socket.rooms.has(cleanGameId)) {
                    socket.emit('error', 'Not in this game');
                    return;
                }

                const game = await gameStore.getGame(cleanGameId);
                if (!game) { socket.emit('error', 'Game not found'); return; }

                const slots = [];
                for (let i = 1; i <= game.playerCount; i++) {
                    const playerId = `player${i}`;
                    const player = game.players[playerId];
                    if (player) {
                        slots.push({
                            slot: playerId,
                            username: player.username,
                            avatar: player.avatar,
                            isCPU: !!player.isCPU,
                            isHost: playerId === 'player1',
                            connected: !player.disconnectedAt,
                            disconnectedAt: player.disconnectedAt || null,
                        });
                    } else {
                        slots.push({
                            slot: playerId, username: null, avatar: null,
                            isCPU: false, isHost: false, connected: false, disconnectedAt: null,
                        });
                    }
                }

                socket.emit('lobby_state', {
                    gameId: cleanGameId, gridSize: game.gridSize,
                    playerCount: game.playerCount, cpuDifficulty: game.cpuDifficulty || null,
                    slots, filled: countFilledPlayers(game),
                });
            } catch (error) {
                log.error('Error fetching lobby state', { error: error.message });
                socket.emit('error', 'Failed to fetch lobby state');
            }
        });

        // ── replace_with_cpu — host replaces an empty/disconnected slot with CPU
        socket.on('replace_with_cpu', async (rawPayload) => {
            try {
                if (rateLimited('replace_with_cpu')) return;
                const validated = validate('replace_with_cpu', rawPayload);
                if (!validated) return;
                const { gameId, sessionToken, slot, difficulty } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const game = await gameStore.getGame(cleanGameId);
                if (!game) { socket.emit('error', 'Game not found'); return; }

                const host = game.players.player1;
                if (!host || host.token !== sessionToken) {
                    socket.emit('error', 'Only the game host can replace slots');
                    return;
                }

                const existing = game.players[slot];
                // Fix #8: Reject if slot is already a CPU player
                if (existing?.isCPU) {
                    socket.emit('error', 'This slot is already a CPU player');
                    return;
                }
                if (existing && !existing.disconnectedAt) {
                    socket.emit('error', 'Cannot replace a connected player');
                    return;
                }

                const slotIndex = parseInt(slot.replace('player', ''), 10) - 1;
                game.players[slot] = {
                    id: `cpu-${cleanGameId}-${slotIndex}`,
                    username: CPU_NAMES[slotIndex] || `Bot-${slotIndex + 1}`,
                    avatar: CPU_AVATARS[slotIndex] || '🤖',
                    color: PLAYER_COLORS[slot],
                    token: `cpu-token-${cleanGameId}-${slotIndex}`,
                    disconnectedAt: null,
                    isCPU: true,
                };
                game.cpuDifficulty = difficulty;

                const filled = countFilledPlayers(game);
                await gameStore.setGame(cleanGameId, game);
                await persistGame(game, filled === game.playerCount ? 'playing' : 'waiting');

                const lobbySlots = [];
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    const p = game.players[pid];
                    lobbySlots.push(p ? {
                        slot: pid, username: p.username, avatar: p.avatar,
                        isCPU: !!p.isCPU, isHost: pid === 'player1',
                        connected: !p.disconnectedAt, disconnectedAt: p.disconnectedAt || null,
                    } : {
                        slot: pid, username: null, avatar: null,
                        isCPU: false, isHost: false, connected: false, disconnectedAt: null,
                    });
                }

                io.to(cleanGameId).emit('lobby_state', {
                    gameId: cleanGameId, gridSize: game.gridSize,
                    playerCount: game.playerCount, cpuDifficulty: game.cpuDifficulty,
                    slots: lobbySlots, filled,
                });

                log.info('Slot replaced with CPU', { gameId: cleanGameId, slot, difficulty });
            } catch (error) {
                log.error('Error replacing slot with CPU', { error: error.message });
                socket.emit('error', 'Failed to replace slot');
            }
        });

        // ── start_game_early — host force-starts, filling empty slots with CPU
        socket.on('start_game_early', async (rawPayload) => {
            try {
                if (rateLimited('start_game_early')) return;
                // Cancel idle timers — game is starting (#390)
                cancelPostgameTimer(socket.id);
                const validated = validate('start_game_early', rawPayload);
                if (!validated) return;
                const { gameId, sessionToken, cpuDifficulty } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const game = await gameStore.getGame(cleanGameId);
                if (!game) { socket.emit('error', 'Game not found'); return; }

                const host = game.players.player1;
                if (!host || host.token !== sessionToken) {
                    socket.emit('error', 'Only the game host can start the game');
                    return;
                }

                const filledBefore = countFilledPlayers(game);
                // Fix #4: Require at least 2 players to start early
                if (filledBefore < 2) {
                    socket.emit('error', 'Need at least 2 players to start the game');
                    return;
                }

                const validDifficulties = ['easy', 'medium', 'hard'];
                const cleanDifficulty = validDifficulties.includes(cpuDifficulty) ? cpuDifficulty : 'medium';

                // Fix #2: Identify empty slots, then re-read to prevent race with concurrent joins
                const slotsToFill = [];
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    if (!game.players[pid]) {
                        slotsToFill.push(pid);
                    }
                }

                const freshGame = await gameStore.getGame(cleanGameId);
                if (!freshGame) { socket.emit('error', 'Game not found'); return; }

                for (const pid of slotsToFill) {
                    if (freshGame.players[pid] && !freshGame.players[pid].isCPU && freshGame.players[pid].username) {
                        continue;
                    }
                    const cpuIdx = parseInt(pid.replace('player', ''), 10) - 1;
                    freshGame.players[pid] = {
                        id: `cpu-${cleanGameId}-${cpuIdx}`,
                        username: CPU_NAMES[cpuIdx] || `Bot-${cpuIdx + 1}`,
                        avatar: CPU_AVATARS[cpuIdx] || '🤖',
                        color: PLAYER_COLORS[pid],
                        token: `cpu-token-${cleanGameId}-${cpuIdx}`,
                        disconnectedAt: null,
                        isCPU: true,
                    };
                }
                freshGame.cpuDifficulty = cleanDifficulty;

                freshGame.started = true;
                await gameStore.setGame(cleanGameId, freshGame);
                await persistGame(freshGame, 'playing');

                // Fix #1: Emit game_started per-player with correct playerId/sessionToken
                for (let i = 1; i <= freshGame.playerCount; i++) {
                    const pid = `player${i}`;
                    const player = freshGame.players[pid];
                    if (player && !player.isCPU) {
                        const playerSocket = io.sockets.sockets.get(player.id);
                        if (playerSocket) {
                            playerSocket.emit('game_started', {
                                gameId: cleanGameId,
                                playerId: pid,
                                sessionToken: player.token,
                                gridSize: freshGame.gridSize,
                                playerCount: freshGame.playerCount,
                                players: getPlayersList(freshGame),
                                gameState: buildGameStateWithPlayers(freshGame),
                                cpuDifficulty: cleanDifficulty,
                            });
                        }
                    }
                }
                io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });

                const firstPlayer = freshGame.players[freshGame.gameState.currentPlayer];
                if (firstPlayer && firstPlayer.isCPU) {
                    const delay = CPU_DELAYS[cleanDifficulty] || 1200;
                    scheduleCPUMove(io, log, cleanGameId, delay);
                }

                log.info('Game started early by host', { gameId: cleanGameId, filledBefore, total: freshGame.playerCount });
            } catch (error) {
                log.error('Error starting game early', { error: error.message });
                socket.emit('error', 'Failed to start game');
            }
        });

        // ── start_game — host starts a full room of human players ─────────────
        socket.on('start_game', async (rawPayload) => {
            try {
                if (rateLimited('start_game')) return;
                // Cancel idle timers — game is starting (#390)
                cancelPostgameTimer(socket.id);
                const validated = validate('start_game', rawPayload);
                if (!validated) return;
                const { gameId, sessionToken } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const game = await gameStore.getGame(cleanGameId);
                if (!game) { socket.emit('error', 'Game not found'); return; }

                // Only host (player1) can start
                const host = game.players.player1;
                if (!host || host.token !== sessionToken) {
                    socket.emit('error', 'Only the game host can start the game');
                    return;
                }

                // Fix #4: Use started flag instead of currentPlayer guard
                if (game.started) return;

                // Room must be full
                const filled = countFilledPlayers(game);
                if (filled < game.playerCount) {
                    socket.emit('error', 'Room is not full yet');
                    return;
                }

                // Double-click guard: if timer already cleared, game was started
                if (!hostStartTimers.has(cleanGameId)) return;

                // Clear AFK host timer — host clicked Start
                clearTimeout(hostStartTimers.get(cleanGameId));
                hostStartTimers.delete(cleanGameId);

                game.started = true;
                await gameStore.setGame(cleanGameId, game);
                await persistGame(game, 'playing');

                // Fix #5: Emit game_started per-player (like start_game_early does)
                // so WaitingRoom clients navigate correctly
                const gameStateWithPlayers = buildGameStateWithPlayers(game);
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    const player = game.players[pid];
                    if (player && !player.isCPU) {
                        const playerSocket = io.sockets.sockets.get(player.id);
                        if (playerSocket) {
                            playerSocket.emit('game_started', {
                                gameId: cleanGameId,
                                playerId: pid,
                                sessionToken: player.token,
                                gridSize: game.gridSize,
                                playerCount: game.playerCount,
                                players: getPlayersList(game),
                                gameState: gameStateWithPlayers,
                            });
                        }
                    }
                }
                io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });

                log.info('Game started by host', { gameId: cleanGameId, playerCount: game.playerCount });
            } catch (error) {
                log.error('Error starting game', { error: error.message });
                socket.emit('error', 'Failed to start game');
            }
        });

        // ── make_move ────────────────────────────────────────────────────────── 
        socket.on('make_move', async (rawPayload) => {
            try {
                if (rateLimited('make_move')) return;
                const validated = validate('make_move', rawPayload);
                if (!validated) return;
                const { gameId, playerId, sessionToken, type, r, c } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                // Always read from shared store (Redis) for authoritative state - prevents stale reads across nodes
                let game = await gameStore.getGame(cleanGameId);
                if (!game) {
                    game = await loadGameFromDB(cleanGameId, log);
                    if (!game) { socket.emit('error', 'Game not found'); return; }
                }

                const player = game.players[playerId];
                if (!player || player.id !== socket.id || player.token !== sessionToken) {
                    socket.emit('error', 'Unauthorized move');
                    return;
                }
                if (game.gameState.currentPlayer !== playerId) {
                    socket.emit('error', 'Not your turn');
                    return;
                }

                const newState = calculateNewState(game.gameState, game.gridSize, r, c, type);
                if (newState.error) { socket.emit('error', newState.error); return; }

                // Preserve moveCount across state replacement (calculateNewState doesn't carry it)
                const prevMoveCount = game.gameState.moveCount;
                game.gameState = newState;
                if (typeof prevMoveCount === 'number') {
                    game.gameState.moveCount = prevMoveCount + 1;
                }

                // Skip disconnected players' turns (#365)
                advanceTurnIfNeeded(game);

                // Record move in history for replay
                if (!game.moveHistory) game.moveHistory = [];
                game.moveHistory.push({
                    player: playerId,
                    row: r,
                    col: c,
                    type: type === 'horizontal' ? 'h' : 'v',
                    timestamp: new Date(),
                });

                // Write back to shared store BEFORE broadcasting
                await gameStore.setGame(cleanGameId, game);

                const status = newState.winner ? 'finished' : 'playing';
                await persistGame(game, status, newState.winner ? { reason: 'normal' } : null);

                io.to(cleanGameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

                if (newState.winner) {
                    // Issue #3: include totalMoves in game_over
                    io.to(cleanGameId).emit('game_over', { winner: newState.winner, scores: newState.scores, totalMoves: game.gameState.moveCount || 0 });
                    // Start post-game idle timers for human players (#390)
                    for (let i = 1; i <= game.playerCount; i++) {
                        const pid = `player${i}`;
                        const p = game.players[pid];
                        if (p && !p.isCPU && !p.disconnectedAt) {
                            const playerSocket = io.sockets.sockets.get(p.id);
                            if (playerSocket) startPostgameTimer(playerSocket);
                        }
                    }
                    // Prometheus: record game completion + duration
                    if (promMetrics) {
                        promMetrics.gamesCompletedTotal.inc();
                        if (game.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - game.createdAt) / 1000);
                    }
                    // Fire-and-forget leaderboard update
                    updateLeaderboard(game, newState.winner, log);
                    recordGameHistory(game, newState.winner, log);
                    // Issue #2: auto-submit daily challenge result server-side
                    submitDailyChallengeResult(game, log).catch(err =>
                        log.error('Daily result auto-submit failed', { gameId: cleanGameId, error: err.message })
                    );
                    await handleTournamentGameCompletion(io, log, cleanGameId, game, newState.winner);
                    // Ranked game ELO update (pass io for socket emission + handle draws)
                    if (rankedGameMap.has(cleanGameId)) {
                        handleRankedGameEnd(io, cleanGameId, newState.winner, game, log).catch(err =>
                            log.error('Ranked game end handler failed', { gameId: cleanGameId, error: err.message })
                        );
                    }
                    // Defensive cleanup: clear any lingering rematch timer
                    if (rematchTimers.has(cleanGameId)) {
                        clearTimeout(rematchTimers.get(cleanGameId));
                        rematchTimers.delete(cleanGameId);
                    }
                    if (hostStartTimers.has(cleanGameId)) {
                        clearTimeout(hostStartTimers.get(cleanGameId));
                        hostStartTimers.delete(cleanGameId);
                    }
                    setTimeout(async () => {
                        await gameStore.deleteGame(cleanGameId);
                        await rematchStore.clearVotes(cleanGameId);
                        await markGameFinished(cleanGameId, 'normal');
                        log.info('Game cleaned up', { gameId: cleanGameId });
                    }, CLEANUP_DELAY_MS);
                } else {
                    // Check if next turn belongs to a CPU player
                    const nextPlayerId = newState.currentPlayer;
                    const nextPlayer = game.players[nextPlayerId];
                    if (nextPlayer && nextPlayer.isCPU) {
                        const difficulty = game.cpuDifficulty || 'medium';
                        const delay = CPU_DELAYS[difficulty] || 1200;
                        scheduleCPUMove(io, log, cleanGameId, delay);
                    } else if (nextPlayer && !nextPlayer.isCPU) {
                        // Push notification for turn change (fire-and-forget)
                        try {
                            if (!isUserOnlineInGame(io, nextPlayer.username, cleanGameId, game)) {
                                sendPushToUser(nextPlayer.username, {
                                    title: '⚡ Your Turn!',
                                    body: "It's your move in GridLock",
                                    url: `/join/${cleanGameId}`,
                                    tag: `turn-${cleanGameId}`,
                                }).catch(() => {});
                            }
                        } catch (_) { /* push is best-effort */ }
                    }
                }
            } catch (error) {
                log.error('Error processing move', { error: error.message, stack: error.stack });
                socket.emit('error', 'Invalid move');
            }
        });

        // ── request_rematch ────────────────────────────────────────────────────
        socket.on('request_rematch', async (rawPayload) => {
            try {
                if (rateLimited('request_rematch')) return;
                // Cancel postgame idle timer — player wants a rematch (#390)
                cancelPostgameTimer(socket.id);
                const validated = validate('request_rematch', rawPayload);
                if (!validated) return;
                const { gameId, sessionToken } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const game = await gameStore.getGame(cleanGameId);
                if (!game) { socket.emit('error', 'Game not found'); return; }

                // Block spectators
                const requestingPlayerId = findPlayerBySocket(game, socket.id);
                if (!requestingPlayerId) { socket.emit('error', 'Player not found in game'); return; }
                if (socket.data?.isSpectator) { socket.emit('error', 'Spectators cannot request rematch'); return; }

                const player = game.players[requestingPlayerId];
                if (!player || player.token !== sessionToken) {
                    socket.emit('error', 'Unauthorized rematch request');
                    return;
                }

                // Block tournament games
                if (isTournamentGame(game)) {
                    socket.emit('error', 'Rematch is not available in tournament games');
                    return;
                }

                const gameFinished = game.gameState?.winner != null;
                if (!gameFinished) {
                    socket.emit('error', 'Rematch can only be requested after the game has finished');
                    return;
                }

                // Debounce: check if already voted
                const alreadyVoted = await rematchStore.hasVoted(cleanGameId, requestingPlayerId);
                if (alreadyVoted) { return; }

                // Auto-decline disconnected players
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    const p = game.players[pid];
                    if (p && !p.isCPU && p.disconnectedAt) {
                        io.to(cleanGameId).emit('rematch_failed', {
                            reason: `${p.username || 'A player'} has disconnected`,
                        });
                        await rematchStore.clearVotes(cleanGameId);
                        return;
                    }
                }

                // Add vote to shared Redis store - visible across ALL nodes
                const { count: humanCount } = await rematchStore.addVote(cleanGameId, requestingPlayerId);

                // Auto-count CPU players as having voted
                const cpuVotes = countCPUPlayers(game);
                const totalVotes = humanCount + cpuVotes;
                io.to(cleanGameId).emit('rematch_count', { count: totalVotes, total: game.playerCount });

                // Start rematch timeout on first vote
                if (humanCount === 1 && !rematchTimers.has(cleanGameId)) {
                    startRematchTimeout(io, log, cleanGameId, game);
                }

                // Push notification for rematch request to other players (fire-and-forget)
                try {
                    const requestingUsername = player.username;
                    for (let i = 1; i <= game.playerCount; i++) {
                        const pid = `player${i}`;
                        const p = game.players[pid];
                        if (p && !p.isCPU && p.username !== requestingUsername) {
                            if (!isUserOnlineInGame(io, p.username, cleanGameId, game)) {
                                sendPushToUser(p.username, {
                                    title: '🔄 Rematch?',
                                    body: `${requestingUsername} wants a rematch!`,
                                    url: `/join/${cleanGameId}`,
                                    tag: `rematch-${cleanGameId}`,
                                }).catch(() => {});
                            }
                        }
                    }
                } catch (_) { /* push is best-effort */ }

                if (totalVotes >= game.playerCount) {
                    // Clear the rematch timeout
                    if (rematchTimers.has(cleanGameId)) {
                        clearTimeout(rematchTimers.get(cleanGameId));
                        rematchTimers.delete(cleanGameId);
                    }

                    const newGameId = await generateUniqueGameId();
                    if (!newGameId) { socket.emit('error', 'Failed to generate rematch game ID'); return; }
                    const initialState = initializeGameState(game.gridSize, game.playerCount);
                    const newGame = {
                        id: newGameId,
                        gridSize: game.gridSize,
                        playerCount: game.playerCount,
                        players: buildRotatedPlayers(game, newGameId),
                        gameState: initialState,
                        createdAt: Date.now(),
                        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
                        cpuDifficulty: game.cpuDifficulty || null,
                    };

                    await gameStore.setGame(newGameId, newGame);
                    await rematchStore.clearVotes(cleanGameId);
                    await persistGame(newGame, 'playing');
                    await markGameFinished(cleanGameId, 'rematch_started');
                    io.to(cleanGameId).emit('rematch_ready', { newGameId });

                    // Trigger CPU move if first turn is CPU in rematch
                    const firstPlayer = newGame.players[newGame.gameState.currentPlayer];
                    if (firstPlayer && firstPlayer.isCPU && newGame.cpuDifficulty) {
                        const delay = CPU_DELAYS[newGame.cpuDifficulty] || 1200;
                        scheduleCPUMove(io, log, newGameId, delay);
                    }
                }
            } catch (error) {
                log.error('Error processing rematch request', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to process rematch request');
            }
        });

        // ── rematch_cancel ─────────────────────────────────────────────────────
        socket.on('rematch_cancel', async (rawPayload) => {
            try {
                if (rateLimited('rematch_cancel')) return;
                const validated = validate('rematch_cancel', rawPayload);
                if (!validated) return;
                const { gameId, sessionToken } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const game = await gameStore.getGame(cleanGameId);
                if (!game) { socket.emit('error', 'Game not found'); return; }

                const requestingPlayerId = findPlayerBySocket(game, socket.id);
                if (!requestingPlayerId) { socket.emit('error', 'Player not found in game'); return; }

                const player = game.players[requestingPlayerId];
                if (!player || player.token !== sessionToken) {
                    socket.emit('error', 'Unauthorized rematch cancel');
                    return;
                }

                // Only allow cancel after game has finished
                if (!game.gameState?.winner) {
                    socket.emit('error', 'Rematch cancel only valid after game has finished');
                    return;
                }

                const { count: humanCount, wasRemoved } = await rematchStore.removeVote(cleanGameId, requestingPlayerId);
                if (!wasRemoved) return; // wasn't voted

                const cpuVotes = countCPUPlayers(game);
                const totalVotes = humanCount + cpuVotes;
                io.to(cleanGameId).emit('rematch_count', { count: totalVotes, total: game.playerCount });

                // If no human votes remain, clear the timeout
                if (humanCount === 0 && rematchTimers.has(cleanGameId)) {
                    clearTimeout(rematchTimers.get(cleanGameId));
                    rematchTimers.delete(cleanGameId);
                }
            } catch (error) {
                log.error('Error processing rematch cancel', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to cancel rematch request');
            }
        });

        // ── queue_join (Quick Play matchmaking) ──────────────────────────────
        socket.on('queue_join', async (rawPayload) => {
            try {
                if (rateLimited('queue_join')) return;
                // Cancel idle timers — player is entering matchmaking (#390)
                cancelLobbyTimer(socket.id);
                cancelPostgameTimer(socket.id);
                const validated = validate('queue_join', rawPayload);
                if (!validated) return;
                const { username, avatar, gridSize, playerCount } = validated;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
                if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

                const pcResult = validateNumber(playerCount, 2, 4, 'Player count');
                if (!pcResult.valid) { socket.emit('error', pcResult.error); return; }

                const result = matchmaking.joinQueue(socket.id, cleanUsername, cleanAvatar, gridResult.value, pcResult.value);

                if (result.rejected) {
                    socket.emit('error', result.reason);
                    return;
                }

                if (result.matched) {
                    // Verify all matched sockets are still connected before game creation
                    const players = result.players;
                    const connected = [];
                    const disconnected = [];
                    for (const p of players) {
                        const s = io.sockets.sockets.get(p.socketId);
                        if (s && s.connected) {
                            connected.push(p);
                        } else {
                            disconnected.push(p);
                        }
                    }

                    if (disconnected.length > 0) {
                        // Re-queue connected players
                        for (const p of connected) {
                            const requeue = matchmaking.joinQueue(p.socketId, p.username, p.avatar, p.gridSize, p.playerCount);
                            const ps = io.sockets.sockets.get(p.socketId);
                            if (ps && requeue.queued) {
                                ps.data.queueKey = requeue.queueKey;
                                ps.emit('queue_status', { position: requeue.position, queueSize: requeue.queueSize, queueKey: requeue.queueKey, queueCounts: matchmaking.getAllQueueCounts() });
                                const timer = setTimeout(() => {
                                    if (matchmaking.isInQueue(p.socketId)) {
                                        ps.emit('queue_timeout', { suggestion: 'cpu' });
                                    }
                                }, QUEUE_TIMEOUT_MS);
                                matchmaking.setTimeoutTimer(p.socketId, timer);
                            }
                        }
                        log.info('Matched player disconnected before game creation, re-queued remaining', {
                            disconnected: disconnected.map(p => p.username),
                            requeued: connected.map(p => p.username),
                        });
                        return;
                    }

                    // Create game for matched players
                    const host = players[0];
                    const gameId = await generateUniqueGameId();
                    if (!gameId) { socket.emit('error', 'Failed to generate game ID'); return; }
                    const initialState = initializeGameState(host.gridSize, host.playerCount);

                    const game = {
                        id: gameId,
                        gridSize: host.gridSize,
                        playerCount: host.playerCount,
                        players: {},
                        gameState: initialState,
                        createdAt: Date.now(),
                        matchType: 'public',
                        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
                    };

                    for (let i = 0; i < players.length; i++) {
                        const slot = `player${i + 1}`;
                        const p = players[i];
                        const token = generateSessionToken();
                        game.players[slot] = {
                            id: p.socketId,
                            username: p.username,
                            avatar: p.avatar,
                            color: PLAYER_COLORS[slot],
                            token,
                            disconnectedAt: null,
                        };
                    }

                    // Guard: reject if any two slots share the same player ID
                    const slotIds = Object.values(game.players).map((p) => p.id);
                    if (new Set(slotIds).size !== slotIds.length) {
                        log.error('Self-match guard triggered in Quick Play - re-queuing affected players', { gameId, slotIds });
                        // Re-queue all matched players so they aren't silently dropped
                        for (const p of players) {
                            const ps = io.sockets.sockets.get(p.socketId);
                            if (ps && ps.connected) {
                                const requeue = matchmaking.joinQueue(p.socketId, p.username, p.avatar, p.gridSize, p.playerCount);
                                if (requeue.queued) {
                                    ps.data.queueKey = requeue.queueKey;
                                    ps.emit('queue_status', { position: requeue.position, queueSize: requeue.queueSize, queueKey: requeue.queueKey, queueCounts: matchmaking.getAllQueueCounts() });
                                    const timer = setTimeout(() => {
                                        if (matchmaking.isInQueue(p.socketId)) {
                                            ps.emit('queue_timeout', { suggestion: 'cpu' });
                                        }
                                    }, QUEUE_TIMEOUT_MS);
                                    matchmaking.setTimeoutTimer(p.socketId, timer);
                                }
                            }
                        }
                        return;
                    }

                    await gameStore.setGame(gameId, game);
                    await persistGame(game, game.playerCount === players.length ? 'playing' : 'waiting');

                    // Notify all matched players
                    for (let i = 0; i < players.length; i++) {
                        const slot = `player${i + 1}`;
                        const p = players[i];
                        const playerSocket = io.sockets.sockets.get(p.socketId);
                        if (playerSocket) {
                            playerSocket.join(gameId);
                            playerSocket.data.gameId = gameId;
                            playerSocket.data.playerId = slot;
                            playerSocket.data.queueKey = undefined;
                            playerSocket.data.username = p.username;

                            const gameStateWithPlayers = buildGameStateWithPlayers(game);
                            playerSocket.emit('queue_matched', {
                                gameId,
                                playerId: slot,
                                sessionToken: game.players[slot].token,
                                gridSize: game.gridSize,
                                playerCount: game.playerCount,
                                players: getPlayersList(game),
                                gameState: gameStateWithPlayers,
                            });
                        }
                    }

                    if (players.length === game.playerCount) {
                        io.to(gameId).emit('all_players_joined', { gameId });
                    }

                    // Push notification: "Your Quick Play match is ready!" for backgrounded players
                    for (const p of players) {
                        try {
                            const pSocket = io.sockets.sockets.get(p.socketId);
                            // If socket exists but document is hidden (player backgrounded tab), send push
                            // We can't check visibility server-side, so push to all - SW deduplicates via tag
                            sendPushToUser(p.username, {
                                title: '⚡ Match Found!',
                                body: 'Your Quick Play match is ready!',
                                url: `/join/${gameId}`,
                                tag: `quickplay-${gameId}`,
                            }).catch(() => {});
                        } catch (_) { /* push is best-effort */ }
                    }

                    log.info('Quick Play match created', { gameId, playerCount: game.playerCount, players: players.map((p) => p.username) });
                } else {
                    // Player queued - broadcast status to ALL waiters and set timeout
                    socket.data.queueKey = result.queueKey;
                    socket.data.username = cleanUsername;

                    // Notify every player in this queue of the updated status
                    const waiters = matchmaking.getWaiters(result.queueKey);
                    for (const waiterId of waiters) {
                        const waiterSocket = io.sockets.sockets.get(waiterId);
                        if (waiterSocket) {
                            const status = matchmaking.getQueueStatus(waiterId);
                            if (status) {
                                waiterSocket.emit('queue_status', {
                                    position: status.position,
                                    queueSize: status.queueSize,
                                    queueKey: status.queueKey,
                                    queueCounts: matchmaking.getAllQueueCounts(),
                                });
                            }
                        }
                    }

                    // Timeout: auto-create CPU game after QUEUE_TIMEOUT_MS
                    const timeoutTimer = setTimeout(async () => {
                        try {
                            if (!matchmaking.isInQueue(socket.id)) return;

                            // Retrieve player info before leaving queue
                            const qStatus = matchmaking.getQueueStatus(socket.id);
                            if (!qStatus) return;
                            const qKey = qStatus.queueKey;
                            const queueArr = matchmaking.queues.get(qKey);
                            const entry = queueArr?.find((e) => e.socketId === socket.id);
                            if (!entry) return;

                            const pGridSize = entry.gridSize;
                            const pPlayerCount = entry.playerCount;
                            const pUsername = entry.username;
                            const pAvatar = entry.avatar;

                            // Remove player from queue
                            matchmaking.leaveQueue(socket.id);

                            // Create a game with CPU opponent(s) filling remaining slots
                            const cpuGameId = await generateUniqueGameId();
                            if (!cpuGameId) { socket.emit('error', 'Failed to generate game ID'); return; }
                            const cpuInitialState = initializeGameState(pGridSize, pPlayerCount);
                            const cpuSessionToken = generateSessionToken();
                            const cpuDifficulty = 'medium';

                            const cpuGame = {
                                id: cpuGameId,
                                gridSize: pGridSize,
                                playerCount: pPlayerCount,
                                players: {
                                    player1: {
                                        id: socket.id,
                                        username: pUsername,
                                        avatar: pAvatar,
                                        color: PLAYER_COLORS.player1,
                                        token: cpuSessionToken,
                                        disconnectedAt: null,
                                    },
                                },
                                gameState: cpuInitialState,
                                createdAt: Date.now(),
                                metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
                                cpuDifficulty,
                            };

                            // Fill remaining slots with CPU players
                            for (let ci = 1; ci < pPlayerCount; ci++) {
                                const cpuSlot = `player${ci + 1}`;
                                cpuGame.players[cpuSlot] = {
                                    id: `cpu-${cpuGameId}-${ci - 1}`,
                                    username: CPU_NAMES[ci - 1] || `Bot-${ci}`,
                                    avatar: CPU_AVATARS[ci - 1] || '🤖',
                                    color: PLAYER_COLORS[cpuSlot],
                                    token: `cpu-token-${cpuGameId}-${ci - 1}`,
                                    disconnectedAt: null,
                                    isCPU: true,
                                };
                            }

                            await gameStore.setGame(cpuGameId, cpuGame);
                            socket.join(cpuGameId);
                            socket.data.gameId = cpuGameId;
                            socket.data.playerId = 'player1';
                            socket.data.queueKey = undefined;
                            socket.data.username = cleanUsername;

                            await persistGame(cpuGame, 'playing');

                            const cpuGameState = buildGameStateWithPlayers(cpuGame);
                            socket.emit('queue_matched', {
                                gameId: cpuGameId,
                                playerId: 'player1',
                                sessionToken: cpuSessionToken,
                                gridSize: cpuGame.gridSize,
                                playerCount: cpuGame.playerCount,
                                players: getPlayersList(cpuGame),
                                gameState: cpuGameState,
                                cpuDifficulty: cpuGame.cpuDifficulty,
                            });

                            io.to(cpuGameId).emit('all_players_joined', { gameId: cpuGameId });

                            // If first turn belongs to CPU, trigger it
                            const firstCpuPlayer = cpuGame.players[cpuGame.gameState.currentPlayer];
                            if (firstCpuPlayer && firstCpuPlayer.isCPU) {
                                const cpuDelay = CPU_DELAYS[cpuDifficulty] || 1200;
                                scheduleCPUMove(io, log, cpuGameId, cpuDelay);
                            }

                            log.info('Quick Play timeout - CPU game created', { gameId: cpuGameId, username: pUsername, cpuSlots: pPlayerCount - 1 });
                        } catch (err) {
                            log.error('Quick Play timeout CPU fallback failed', { error: err.message, stack: err.stack });
                            socket.emit('queue_timeout', { suggestion: 'cpu' });
                        }
                    }, QUEUE_TIMEOUT_MS);
                    matchmaking.setTimeoutTimer(socket.id, timeoutTimer);
                }
            } catch (error) {
                log.error('Error handling queue_join', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to join matchmaking queue');
            }
        });

        // ── send_game_invite ──────────────────────────────────────────────────
        socket.on('send_game_invite', async (rawPayload) => {
            try {
                if (rateLimited('send_game_invite')) return;
                const validated = validate('send_game_invite', rawPayload);
                if (!validated) return;
                const { gameId, targetUsername } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const toResult = sanitizeUsername(targetUsername);
                if (!toResult.valid) { socket.emit('error', toResult.error); return; }

                // Fix #3: Verify game exists and is joinable
                let game = await gameStore.getGame(cleanGameId);
                if (!game) {
                    game = await loadGameFromDB(cleanGameId, log);
                    if (!game) { socket.emit('error', 'Game not found'); return; }
                }

                // Only allow invites for games that are waiting for players
                const filled = countFilledPlayers(game);
                if (filled >= game.playerCount) {
                    socket.emit('error', 'Game is already full');
                    return;
                }

                // Fix #1: Derive fromUsername from socket identity, not client payload
                const senderPlayerId = findPlayerBySocket(game, socket.id);
                if (!senderPlayerId) {
                    socket.emit('error', 'You are not a player in this game');
                    return;
                }
                const senderUsername = game.players[senderPlayerId].username;

                // Fix #5: Sender-side rate limit - max 10 invites per 5 min per socket
                if (!inviteSenderLimiter.allow(socket.id)) {
                    socket.emit('error', 'Too many invites sent. Please slow down.');
                    return;
                }

                // Prevent self-invite
                if (toResult.value === senderUsername) {
                    socket.emit('error', 'Cannot invite yourself');
                    return;
                }

                sendPushToUser(toResult.value, {
                    title: '🎮 Game Invite!',
                    body: `${senderUsername} invited you to play!`,
                    url: `/join/${cleanGameId}`,
                    tag: `invite-${cleanGameId}`,
                }).catch(() => {});

                socket.emit('invite_sent', { targetUsername: toResult.value });
            } catch (error) {
                log.error('Error sending game invite push', { error: error.message });
                socket.emit('error', 'Failed to send invite');
            }
        });

        // ── queue_leave ────────────────────────────────────────────────────────
        socket.on('queue_leave', () => {
            if (rateLimited('queue_leave')) return;

            const info = matchmaking.playerIndex.get(socket.id);
            const queueKey = info?.queueKey;
            matchmaking.leaveQueue(socket.id);
            socket.data.queueKey = undefined;
            socket.emit('queue_left', {});

            // Broadcast updated status to remaining waiters
            if (queueKey) {
                const waiters = matchmaking.getWaiters(queueKey);
                for (const waiterId of waiters) {
                    const waiterSocket = io.sockets.sockets.get(waiterId);
                    if (waiterSocket) {
                        const status = matchmaking.getQueueStatus(waiterId);
                        if (status) {
                            waiterSocket.emit('queue_status', {
                                position: status.position,
                                queueSize: status.queueSize,
                                queueKey: status.queueKey,
                                queueCounts: matchmaking.getAllQueueCounts(),
                            });
                        }
                    }
                }
            }
        });

        // ── ranked_queue_join ────────────────────────────────────────────────
        socket.on('ranked_queue_join', async (rawPayload) => {
            try {
                if (rateLimited('ranked_queue_join')) return;
                // Cancel idle timers — player is entering ranked matchmaking (#390)
                cancelLobbyTimer(socket.id);
                cancelPostgameTimer(socket.id);
                const validated = validate('ranked_queue_join', rawPayload);
                if (!validated) return;
                const { username, avatar, gridSize } = validated;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
                if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

                // Get or create ranked profile
                let profile = await RankedProfile.findOne({ username: cleanUsername });
                if (!profile) {
                    profile = new RankedProfile({ username: cleanUsername });
                    await profile.save();
                }

                // Check cooldown
                if (profile.isOnCooldown()) {
                    const remaining = Math.ceil((new Date(profile.cooldownUntil) - new Date()) / 1000);
                    socket.emit('ranked_cooldown', {
                        cooldownUntil: profile.cooldownUntil,
                        remainingSeconds: remaining,
                    });
                    socket.emit('error', `You are on cooldown for ${remaining} more seconds`);
                    return;
                }

                // Remove from queue if already in it (O(1) check via rankedQueueIndex)
                if (rankedQueueIndex.has(socket.id)) {
                    removeFromRankedQueue(socket.id);
                }

                const entry = {
                    socketId: socket.id,
                    username: cleanUsername,
                    avatar: cleanAvatar,
                    elo: profile.elo,
                    gridSize: gridResult.value,
                    joinedAt: Date.now(),
                };

                rankedQueue.push(entry);
                rankedQueueIndex.set(socket.id, cleanUsername);
                socket.data.rankedQueue = true;
                socket.data.rankedUsername = cleanUsername;

                // Emit initial queue status (Fix #13: show actual position, not total size)
                const queuePosition = rankedQueue.findIndex(e => e.socketId === socket.id) + 1;
                socket.emit('ranked_queue_status', {
                    position: queuePosition,
                    queueSize: rankedQueue.length,
                    elo: profile.elo,
                    tier: getTierFromElo(profile.elo).name,
                    tierIcon: getTierFromElo(profile.elo).icon,
                });

                // Try to find a match
                await tryRankedMatch(io, log, socket);
            } catch (error) {
                log.error('Error handling ranked_queue_join', { error: error.message });
                socket.emit('error', 'Failed to join ranked queue');
            }
        });

        // ── ranked_queue_leave ───────────────────────────────────────────────
        socket.on('ranked_queue_leave', () => {
            if (rateLimited('ranked_queue_leave')) return;
            removeFromRankedQueue(socket.id);
            socket.data.rankedQueue = false;
            socket.emit('ranked_queue_left', {});
        });

        // ── get_ranked_profile — fetch player's ranked profile (#365) ────────
        socket.on('get_ranked_profile', async (rawPayload) => {
            try {
                if (rateLimited('get_ranked_profile')) return;
                const validated = validate('get_ranked_profile', rawPayload);
                if (!validated) return;
                const { username } = validated;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;

                const profile = await RankedProfile.findOne({ username: cleanUsername }).lean();
                if (profile) {
                    const tier = getTierFromElo(profile.elo);
                    socket.emit('ranked_profile', {
                        username: profile.username,
                        elo: profile.elo,
                        tier: tier.name,
                        tierIcon: tier.icon,
                        wins: profile.wins || 0,
                        losses: profile.losses || 0,
                        draws: profile.draws || 0,
                        isPlacement: (profile.placementGames || []).length < PLACEMENT_GAMES_REQUIRED,
                        placementProgress: `${(profile.placementGames || []).length}/${PLACEMENT_GAMES_REQUIRED}`,
                        lastPlayedAt: profile.lastPlayedAt || null,
                    });
                } else {
                    const defaultTier = getTierFromElo(1200);
                    socket.emit('ranked_profile', {
                        username: cleanUsername,
                        elo: 1200,
                        tier: defaultTier.name,
                        tierIcon: defaultTier.icon,
                        wins: 0,
                        losses: 0,
                        draws: 0,
                        isPlacement: true,
                        placementProgress: `0/${PLACEMENT_GAMES_REQUIRED}`,
                        lastPlayedAt: null,
                    });
                }
            } catch (error) {
                log.error('Error fetching ranked profile', { error: error.message });
                socket.emit('error', 'Failed to fetch ranked profile');
            }
        });

        // ── game_chat (in-game quick chat & emoji reactions - #216) ────────────
        socket.on('game_chat', async (rawPayload) => {
            try {
                if (rateLimited('game_chat')) return;
                const validated = validate('game_chat', rawPayload);
                if (!validated) return;
                const { gameId, content } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                // Validate content is from allowlist
                if (!ALLOWED_CHAT_CONTENT.has(content)) {
                    socket.emit('error', 'Invalid chat message');
                    return;
                }

                // Load game
                let game = await gameStore.getGame(cleanGameId);
                if (!game) {
                    game = await loadGameFromDB(cleanGameId, log);
                    if (!game) { socket.emit('error', 'Game not found'); return; }
                }

                // Game-over guard: reject chat after game has ended
                if (game.gameState?.winner || game.gameState?.gameOver) {
                    socket.emit('error', 'Game has ended');
                    return;
                }

                // Spectators cannot send
                if (socket.data?.isSpectator) {
                    socket.emit('error', 'Spectators cannot send chat messages');
                    return;
                }

                // Verify player is in the game
                const playerId = findPlayerBySocket(game, socket.id);
                if (!playerId) {
                    socket.emit('error', 'You are not a player in this game');
                    return;
                }

                // Chat-specific rate limit: 1 per 2s, 10 per minute
                if (!chatRateLimiter.allow(socket.id)) {
                    socket.emit('error', 'Chat rate limited. Please slow down.');
                    return;
                }

                const player = game.players[playerId];
                const playerIndex = parseInt(playerId.replace('player', ''), 10) - 1;
                const type = ALLOWED_EMOJIS.includes(content) ? 'emoji' : 'quick';

                io.to(cleanGameId).emit('game_chat_received', {
                    playerId,
                    username: player.username,
                    avatar: player.avatar,
                    playerIndex,
                    type,
                    content,
                    timestamp: Date.now(),
                });
            } catch (error) {
                log.error('Error processing game_chat', { error: error.message });
                socket.emit('error', 'Failed to send chat message');
            }
        });

        // ── leave_game — voluntary leave (no reconnect window) ────────────────
        socket.on('leave_game', async (rawPayload) => {
            try {
                if (rateLimited('leave_game')) return;
                const validated = validate('leave_game', rawPayload);
                if (!validated) return;
                const { gameId } = validated;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const game = await gameStore.getGame(cleanGameId);
                if (!game) return;

                const playerId = findPlayerBySocket(game, socket.id);
                if (!playerId) return;

                const player = game.players[playerId];
                if (!player) return;

                log.info('Player voluntarily left game', { gameId: cleanGameId, playerId, username: player.username });
                // Note: No dedicated Prometheus counter for voluntary leaves.
                // gamesCompletedTotal is incremented when the leave causes game-over (below).
                // Add a gridlock_voluntary_leaves_total counter here if per-leave tracking is needed.

                // Mark as permanently disconnected
                player.disconnectedAt = new Date();
                player.voluntaryLeave = true;
                player.id = null; // Prevent disconnect handler from finding this player

                // Cancel any existing disconnect timer for this player
                const timerKey = `${cleanGameId}:${playerId}`;
                if (localTimers.has(timerKey)) {
                    clearTimeout(localTimers.get(timerKey).timer);
                    localTimers.delete(timerKey);
                }
                await disconnectStore.clearDisconnect(cleanGameId, playerId);

                // Clean up host start timer if leaving during room_full phase
                if (hostStartTimers.has(cleanGameId)) {
                    clearTimeout(hostStartTimers.get(cleanGameId));
                    hostStartTimers.delete(cleanGameId);
                }

                // Notify others — voluntary leave, no reconnect window
                // Don't emit player_disconnected for voluntary leaves — that event
                // is for involuntary network drops. Only emit player_left.
                io.to(cleanGameId).emit('player_left', {
                    playerId,
                    username: player.username,
                    reason: 'voluntary',
                });

                // Leave socket room
                socket.leave(cleanGameId);
                socket.data.gameId = undefined;
                socket.data.playerId = undefined;

                // Player returns to lobby — start lobby idle timer (#390 P1)
                startLobbyTimer(socket);

                // If game already finished, just persist and return
                if (game.gameState?.winner) {
                    await rematchStore.removeVote(cleanGameId, playerId);
                    io.to(cleanGameId).emit('rematch_failed', {
                        reason: `${player.username || 'A player'} left the game`,
                    });
                    await rematchStore.clearVotes(cleanGameId);
                    if (rematchTimers.has(cleanGameId)) {
                        clearTimeout(rematchTimers.get(cleanGameId));
                        rematchTimers.delete(cleanGameId);
                    }
                    await gameStore.setGame(cleanGameId, game);
                    return;
                }

                // Count remaining active players
                const remaining = [];
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    const p = game.players[pid];
                    if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
                }

                if (remaining.length === 1) {
                    // Only 1 player left — they win by forfeit
                    const winner = remaining[0];
                    game.gameState.winner = winner;

                    await gameStore.setGame(cleanGameId, game);
                    io.to(cleanGameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });
                    io.to(cleanGameId).emit('player_forfeited', {
                        playerId,
                        username: player.username,
                        reason: 'voluntary_leave',
                    });
                    io.to(cleanGameId).emit('game_over', {
                        winner,
                        scores: game.gameState.scores,
                        reason: 'opponent_left',
                    });
                    // Start post-game idle timers for remaining human players (#390)
                    for (let pi = 1; pi <= game.playerCount; pi++) {
                        const pid = `player${pi}`;
                        const p = game.players[pid];
                        if (p && !p.isCPU && !p.disconnectedAt && pid !== playerId) {
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
                    await handleTournamentGameCompletion(io, log, cleanGameId, game, winner);

                    if (rankedGameMap.has(cleanGameId)) {
                        handleRankedDisconnect(io, cleanGameId, playerId, game, log).catch(err =>
                            log.error('Ranked leave handler failed', { gameId: cleanGameId, error: err.message })
                        );
                    }

                    await persistGame(game, 'finished', { reason: 'voluntary_leave' });
                    if (rematchTimers.has(cleanGameId)) {
                        clearTimeout(rematchTimers.get(cleanGameId));
                        rematchTimers.delete(cleanGameId);
                    }
                    setTimeout(async () => {
                        await gameStore.deleteGame(cleanGameId);
                        await rematchStore.clearVotes(cleanGameId);
                    }, CLEANUP_DELAY_MS);
                } else if (remaining.length === 0) {
                    // No players left — clean up
                    game.gameState.winner = 'draw';
                    await gameStore.setGame(cleanGameId, game);
                    await persistGame(game, 'finished', { reason: 'all_left' });
                    setTimeout(async () => {
                        await gameStore.deleteGame(cleanGameId);
                        await rematchStore.clearVotes(cleanGameId);
                    }, 10_000);
                } else {
                    // 2+ players remain — game continues, skip disconnected player's turns
                    if (game.gameState.currentPlayer === playerId) {
                        const activePlayers = remaining;
                        const nextPlayer = getNextActivePlayer(playerId, game.gameState.players, activePlayers);
                        if (nextPlayer) {
                            game.gameState.currentPlayer = nextPlayer;
                        }
                    }

                    await gameStore.setGame(cleanGameId, game);
                    io.to(cleanGameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

                    // If next player is CPU, schedule their move
                    const nextPlayerId = game.gameState.currentPlayer;
                    const nextPlayer = game.players[nextPlayerId];
                    if (nextPlayer && nextPlayer.isCPU) {
                        const difficulty = game.cpuDifficulty || 'medium';
                        const delay = CPU_DELAYS[difficulty] || 1200;
                        scheduleCPUMove(io, log, cleanGameId, delay);
                    }
                }
            } catch (error) {
                log.error('Error processing leave_game', { socketId: socket.id, error: error.message });
            }
        });

        // ── disconnect ─────────────────────────────────────────────────────────
        socket.on('disconnect', async () => {
            log.info('Client disconnected', { socketId: socket.id });
            socketLimiter.cleanup(socket.id);
            inviteSenderLimiter.cleanup(socket.id);
            chatRateLimiter.cleanup(socket.id);
            clearIdleTimers(socket.id);
            matchmaking.leaveQueue(socket.id);
            removeFromRankedQueue(socket.id);

            // Clean up active daily challenge tracking for this user
            if (socket.data?.username && activeDailyGames.get(socket.data.username)) {
                const dailyGameId = activeDailyGames.get(socket.data.username);
                const dailyGame = await gameStore.getGame(dailyGameId);
                // Only clean up if the game hasn't finished (result not yet submitted)
                if (dailyGame && !dailyGame.gameState?.winner) {
                    activeDailyGames.delete(socket.data.username);
                }
            }

            const processPlayerDisconnect = async (gameId, game, playerId) => {
                const player = game.players[playerId];
                if (!player) return;

                // Guard: skip if already processed (e.g., voluntary leave triggered first)
                if (player.disconnectedAt) return;

                // BLOCKER #2: Host disconnect while room is full but game not started
                // If host (player1) disconnects and we have an active host-start timer,
                // the room is full with humans waiting — auto-start the game immediately.
                if (playerId === 'player1' && hostStartTimers.has(gameId)) {
                    clearTimeout(hostStartTimers.get(gameId));
                    hostStartTimers.delete(gameId);

                    player.disconnectedAt = new Date();
                    io.to(gameId).emit('player_disconnected', {
                        playerId,
                        username: player.username,
                        reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                    });

                    // Auto-start — the room is full, just begin the game
                    await persistGame(game, 'playing');
                    io.to(gameId).emit('all_players_joined', { gameId });
                    log.info('Game auto-started (host disconnected in room_full)', { gameId });

                    // Set up normal disconnect/reconnect timer for the host
                    await disconnectStore.setDisconnect(gameId, playerId, socket.id, DISCONNECT_TIMEOUT_MS);
                    await gameStore.setGame(gameId, game);

                    const timerKey = `${gameId}:${playerId}`;
                    if (localTimers.has(timerKey)) clearTimeout(localTimers.get(timerKey).timer);
                    // Local forfeit timer — same as normal disconnect path
                    const hostForfeitTimer = setTimeout(async () => {
                        try {
                            localTimers.delete(timerKey);
                            const stillDisconnected = await disconnectStore.isDisconnected(gameId, playerId);
                            if (!stillDisconnected) return;
                            const currentGame = await gameStore.getGame(gameId);
                            if (!currentGame) return;
                            if (currentGame.gameState?.winner) return;
                            const currentPlayer = currentGame.players[playerId];
                            if (!currentPlayer || !currentPlayer.disconnectedAt) return;
                            currentPlayer.voluntaryLeave = false;
                            const remaining = [];
                            for (let i = 1; i <= currentGame.playerCount; i++) {
                                const pid = `player${i}`;
                                const p = currentGame.players[pid];
                                if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
                            }
                            io.to(gameId).emit('player_left', { playerId, username: currentPlayer.username, reason: 'disconnect_timeout' });
                            if (remaining.length === 1) {
                                const winner = remaining[0];
                                currentGame.gameState.winner = winner;
                                await gameStore.setGame(gameId, currentGame);
                                io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
                                io.to(gameId).emit('player_forfeited', { playerId, username: currentPlayer.username, reason: 'disconnect_timeout' });
                                io.to(gameId).emit('game_over', { winner, scores: currentGame.gameState.scores, reason: 'opponent_disconnected' });
                                // Start post-game idle timers for remaining human players (#390)
                                for (let pi = 1; pi <= currentGame.playerCount; pi++) {
                                    const pid2 = `player${pi}`;
                                    const p2 = currentGame.players[pid2];
                                    if (p2 && !p2.isCPU && !p2.disconnectedAt && pid2 !== playerId) {
                                        const pSock = io.sockets.sockets.get(p2.id);
                                        if (pSock) startPostgameTimer(pSock);
                                    }
                                }
                                if (promMetrics) {
                                    promMetrics.gamesCompletedTotal.inc();
                                    if (currentGame.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - currentGame.createdAt) / 1000);
                                }
                                updateLeaderboard(currentGame, winner, log);
                                recordGameHistory(currentGame, winner, log);
                                await handleTournamentGameCompletion(io, log, gameId, currentGame, winner);
                                if (rankedGameMap.has(gameId)) {
                                    handleRankedDisconnect(io, gameId, playerId, currentGame, log).catch(err =>
                                        log.error('Ranked disconnect handler failed', { gameId, error: err.message })
                                    );
                                }
                                await persistGame(currentGame, 'finished', { reason: 'disconnect_forfeit' });
                                setTimeout(async () => {
                                    await gameStore.deleteGame(gameId);
                                    await rematchStore.clearVotes(gameId);
                                }, CLEANUP_DELAY_MS);
                            } else if (remaining.length === 0) {
                                currentGame.gameState.winner = 'draw';
                                await gameStore.setGame(gameId, currentGame);
                                await persistGame(currentGame, 'finished', { reason: 'all_disconnected' });
                                setTimeout(async () => {
                                    await gameStore.deleteGame(gameId);
                                    await rematchStore.clearVotes(gameId);
                                }, 10_000);
                            } else {
                                if (currentGame.gameState.currentPlayer === playerId) {
                                    const activePlayers = remaining;
                                    const nextPlayer = getNextActivePlayer(playerId, currentGame.gameState.players, activePlayers);
                                    if (nextPlayer) currentGame.gameState.currentPlayer = nextPlayer;
                                }
                                await gameStore.setGame(gameId, currentGame);
                                io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
                            }
                        } catch (err) {
                            log.error('Host forfeit timer error', { gameId, playerId, error: err.message });
                        }
                    }, DISCONNECT_TIMEOUT_MS);
                    localTimers.set(timerKey, { timer: hostForfeitTimer, socketId: socket.id });
                    return;
                }

                player.disconnectedAt = new Date();

                io.to(gameId).emit('player_disconnected', {
                    playerId,
                    username: player.username,
                    reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                });

                // If game already finished, handle rematch vote auto-decline then persist
                if (game.gameState?.winner) {
                    // Auto-decline: remove this player's rematch vote
                    await rematchStore.removeVote(gameId, playerId);
                    // Emit rematch_failed since a player disconnected
                    io.to(gameId).emit('rematch_failed', {
                        reason: `${player.username || 'A player'} disconnected`,
                    });
                    await rematchStore.clearVotes(gameId);
                    // Clear rematch timer
                    if (rematchTimers.has(gameId)) {
                        clearTimeout(rematchTimers.get(gameId));
                        rematchTimers.delete(gameId);
                    }
                    await gameStore.setGame(gameId, game);
                    persistGame(game, 'finished').catch((err) =>
                        log.error('Persist after disconnect failed', { gameId, error: err.message })
                    );
                    return;
                }

                // Mark disconnect state in Redis (TTL = reconnect window; expiry = forfeit)
                await disconnectStore.setDisconnect(gameId, playerId, socket.id, DISCONNECT_TIMEOUT_MS);
                await gameStore.setGame(gameId, game);

                // Cancel any existing local timer for this slot
                const timerKey = `${gameId}:${playerId}`;
                if (localTimers.has(timerKey)) clearTimeout(localTimers.get(timerKey).timer);

                // Local forfeit timer - fires on THIS node after timeout
                const timer = setTimeout(async () => {
                    try {
                        localTimers.delete(timerKey);

                        // Check Redis: if disconnect key is gone, player reconnected on some node
                        const stillDisconnected = await disconnectStore.isDisconnected(gameId, playerId);
                        if (!stillDisconnected) return;

                        const currentGame = await gameStore.getGame(gameId);
                        if (!currentGame) return;

                        // Skip forfeit if game already ended
                        if (currentGame.gameState?.winner) return;

                        const currentPlayer = currentGame.players[playerId];
                        if (!currentPlayer || !currentPlayer.disconnectedAt) return;

                        // Mark as permanently disconnected (timeout expired)
                        currentPlayer.voluntaryLeave = false;

                        // Count remaining active players
                        const remaining = [];
                        for (let i = 1; i <= currentGame.playerCount; i++) {
                            const pid = `player${i}`;
                            const p = currentGame.players[pid];
                            if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
                        }

                        // Emit player_left — this player is gone permanently
                        io.to(gameId).emit('player_left', {
                            playerId,
                            username: currentPlayer.username,
                            reason: 'disconnect_timeout',
                        });


                        if (remaining.length >= 2) {
                            // 2+ players remain — game continues, skip this player's turns
                            io.to(gameId).emit('player_forfeited', {
                                playerId,
                                username: currentPlayer.username,
                                reason: 'disconnect_timeout',
                            });

                            // Advance turn if it was the disconnected player's turn
                            if (currentGame.gameState.currentPlayer === playerId) {
                                const nextPlayer = getNextActivePlayer(playerId, currentGame.gameState.players, remaining);
                                if (nextPlayer) {
                                    currentGame.gameState.currentPlayer = nextPlayer;
                                }
                            }

                            await gameStore.setGame(gameId, currentGame);
                            io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });

                            // If next player is CPU, schedule their move
                            const nextPlayerId = currentGame.gameState.currentPlayer;
                            const nextPlayerObj = currentGame.players[nextPlayerId];
                            if (nextPlayerObj && nextPlayerObj.isCPU) {
                                const difficulty = currentGame.cpuDifficulty || 'medium';
                                const delay = CPU_DELAYS[difficulty] || 1200;
                                scheduleCPUMove(io, log, gameId, delay);
                            }

                            // Ranked disconnect penalty still applies even if game continues
                            if (rankedGameMap.has(gameId)) {
                                handleRankedDisconnect(io, gameId, playerId, currentGame, log).catch(err =>
                                    log.error('Ranked disconnect handler failed', { gameId, error: err.message })
                                );
                            }
                        } else {
                            // 0-1 players remain — end the game
                            const scores = currentGame.gameState?.scores || {};
                            const winner = pickForfeitWinner(remaining, scores);
                            currentGame.gameState.winner = winner;

                            await gameStore.setGame(gameId, currentGame);
                            io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
                            io.to(gameId).emit('player_forfeited', {
                                playerId,
                                username: currentPlayer.username,
                                reason: 'disconnect_timeout',
                            });
                            io.to(gameId).emit('game_over', {
                                winner,
                                scores: currentGame.gameState.scores,
                                reason: 'opponent_disconnected',
                            });
                            // Start post-game idle timers for remaining human players (#390)
                            for (let pi = 1; pi <= currentGame.playerCount; pi++) {
                                const pid2 = `player${pi}`;
                                const p2 = currentGame.players[pid2];
                                if (p2 && !p2.isCPU && !p2.disconnectedAt && pid2 !== playerId) {
                                    const pSock = io.sockets.sockets.get(p2.id);
                                    if (pSock) startPostgameTimer(pSock);
                                }
                            }
                            // Prometheus: record game completion + duration (forfeit)
                            if (promMetrics) {
                                promMetrics.gamesCompletedTotal.inc();
                                if (currentGame.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - currentGame.createdAt) / 1000);
                            }
                            // Fire-and-forget leaderboard update for forfeit
                            updateLeaderboard(currentGame, winner, log);
                            recordGameHistory(currentGame, winner, log);
                            await handleTournamentGameCompletion(io, log, gameId, currentGame, winner);

                            // Ranked anti-smurf: if this was a ranked game, auto-loss + cooldown
                            if (rankedGameMap.has(gameId)) {
                                handleRankedDisconnect(io, gameId, playerId, currentGame, log).catch(err =>
                                    log.error('Ranked disconnect handler failed', { gameId, error: err.message })
                                );
                            }

                            await persistGame(currentGame, 'finished', { reason: 'disconnect_forfeit' });

                            // Defensive cleanup: clear any lingering rematch timer
                            if (rematchTimers.has(gameId)) {
                                clearTimeout(rematchTimers.get(gameId));
                                rematchTimers.delete(gameId);
                            }
                            setTimeout(async () => {
                                await gameStore.deleteGame(gameId);
                                await rematchStore.clearVotes(gameId);
                            }, CLEANUP_DELAY_MS);
                        }
                    } catch (err) {
                        log.error('Disconnect timeout handler failed', { gameId, playerId, error: err.message });
                    }
                }, DISCONNECT_TIMEOUT_MS);

                localTimers.set(timerKey, { timer, socketId: socket.id });

                persistGame(game).catch((err) =>
                    log.error('Persist after disconnect failed', { gameId, error: err.message })
                );
            };

            try {
                const processedGameIds = new Set();

                // Fast path: use socket-attached game context first.
                const hintedGameId = socket.data?.gameId;
                const hintedPlayerId = socket.data?.playerId;
                const hintedIsSpectator = socket.data?.isSpectator === true || hintedPlayerId === 'spectator';
                if (hintedGameId && hintedPlayerId) {
                    if (hintedIsSpectator) {
                        // Decrement spectator count atomically (#303)
                        try {
                            const newCount = await gameStore.adjustSpectatorCount(hintedGameId, -1);
                            const hintedGame = await gameStore.getGame(hintedGameId);
                            if (hintedGame) {
                                hintedGame.spectatorCount = newCount;
                                await gameStore.setGame(hintedGameId, hintedGame);
                                io.to(hintedGameId).emit('spectator_count', { count: newCount });
                                io.to(hintedGameId).emit('spectator_left', {
                                    username: socket.data.spectatorUsername || 'A spectator',
                                    count: newCount,
                                });
                            }
                        } catch (err) {
                            log.error('Spectator disconnect cleanup failed', { gameId: hintedGameId, error: err.message });
                        }
                        return;
                    }
                    const hintedGame = await gameStore.getGame(hintedGameId);
                    if (hintedGame?.players?.[hintedPlayerId]?.id === socket.id) {
                        await processPlayerDisconnect(hintedGameId, hintedGame, hintedPlayerId);
                        processedGameIds.add(hintedGameId);
                    }
                }

                // Fallback path for legacy sockets / missing hints, or multi-game cleanup.
                const allGames = await gameStore.getAllActiveGames();
                for (const [gameId, game] of allGames.entries()) {
                    if (processedGameIds.has(gameId)) continue;
                    const playerId = findPlayerBySocket(game, socket.id);
                    if (!playerId) continue;
                    await processPlayerDisconnect(gameId, game, playerId);
                }
            } catch (error) {
                log.error('Error handling disconnect', { socketId: socket.id, error: error.message });
            } finally {
                socket.data.gameId = undefined;
                socket.data.playerId = undefined;
                socket.data.isSpectator = undefined;
                socket.data.tournamentId = undefined;
            }
        });
    });

    return { gameStore, rematchStore, disconnectStore, localTimers };
};

module.exports = attachSocketHandlers;
module.exports._internal = {
    isSpectatorJoinRequest,
    initializeBracket,
    buildTournamentSnapshot,
    sanitizeTournamentId,
    generateTournamentId,
    getTournamentJoinError,
    applyTournamentMatchResult,
    scheduleCPUMove,
    rankedQueue,
    rankedQueueIndex,
    rankedGameMap,
    removeFromRankedQueue,
    activeDailyGames,
    chatRateLimiter,
    recordGameHistory,
};
