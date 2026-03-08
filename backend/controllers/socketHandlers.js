const crypto = require('crypto');
const Game = require('../models/Game');
const Leaderboard = require('../models/Leaderboard');
const { calculateNewState, initializeGameState } = require('../utils/gameLogic');
const { sanitizeUsername, sanitizeAvatar, sanitizeGameId, validateNumber } = require('../utils/sanitize');
const { socketLimiter } = require('../middleware/rateLimiter');
const gameStore = require('../stores/gameStore');
const rematchStore = require('../stores/rematchStore');
const disconnectStore = require('../stores/disconnectStore');
const { updateLeaderboardWithOptimisticElo } = require('../services/leaderboardUpdateService');
const { chooseCPUMove, CPU_NAMES, CPU_AVATARS, CPU_DELAYS } = require('../services/cpuPlayer');
const { sendPushToUser, isUserOnlineInGame } = require('../services/pushService');
const matchmaking = require('../services/matchmaking');
const { QUEUE_TIMEOUT_MS } = require('../services/matchmaking');

const DISCONNECT_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 8_000 : 60_000;

// Node-local timer handles only — state visibility is handled via disconnectStore (Redis)
const localTimers = new Map(); // key: `${gameId}:${playerId}` -> { timer, socketId }

const PLAYER_COLORS = {
    player1: '#3B82F6',
    player2: '#EF4444',
    player3: '#10B981',
    player4: '#A855F7',
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

            game.gameState = newState;
            await gameStore.setGame(gameId, game);

            const status = newState.winner ? 'finished' : 'playing';
            await persistGame(game, status, newState.winner ? { reason: 'normal' } : null);

            io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

            if (newState.winner) {
                io.to(gameId).emit('game_over', { winner: newState.winner, scores: newState.scores });
                updateLeaderboard(game, newState.winner, log);
                await handleTournamentGameCompletion(io, log, gameId, game, newState.winner);
                setTimeout(async () => {
                    await gameStore.deleteGame(gameId);
                    await rematchStore.clearVotes(gameId);
                    await markGameFinished(gameId, 'normal');
                }, 60_000);
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

function attachSocketHandlers(io, log) {
    restoreActiveGames(log);

    io.on('connection', (socket) => {
        log.info('New client connected:', socket.id);

        const rateLimited = (eventName) => {
            if (!socketLimiter.allow(socket.id, eventName)) {
                log.warn('Rate limited socket event', { socketId: socket.id, eventName });
                socket.emit('error', 'Too many requests. Please slow down.');
                return true;
            }
            return false;
        };

        // ── create_tournament ─────────────────────────────────────────────────
        socket.on('create_tournament', async ({ username, avatar, tournamentSize = 4, gridSize = 3 }) => {
            try {
                if (rateLimited('create_tournament')) return;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }

                const size = Number(tournamentSize);
                if (![4, 8].includes(size)) { socket.emit('error', 'Tournament size must be 4 or 8'); return; }

                const gridResult = validateNumber(gridSize, 2, 10, 'Grid size');
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
        socket.on('join_tournament', async ({ tournamentId, username, avatar }) => {
            try {
                if (rateLimited('join_tournament')) return;

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

        // ── create_game ────────────────────────────────────────────────────────
        socket.on('create_game', async ({ gridSize, username, avatar, playerCount = 2, cpuPlayers = 0, cpuDifficulty = 'medium' }, callback) => {
            try {
                if (rateLimited('create_game')) return;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const gridResult = validateNumber(gridSize, 2, 10, 'Grid size');
                if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

                const pcResult = validateNumber(playerCount, 2, 4, 'Player count');
                if (!pcResult.valid) { socket.emit('error', pcResult.error); return; }

                // Validate CPU params
                const cpuCount = Math.max(0, Math.min(Math.floor(Number(cpuPlayers) || 0), pcResult.value - 1));
                const validDifficulties = ['easy', 'medium', 'hard'];
                const cleanDifficulty = validDifficulties.includes(cpuDifficulty) ? cpuDifficulty : 'medium';

                const gameId = await generateUniqueGameId();
                if (!gameId) { socket.emit('error', 'Failed to generate game ID. Please try again.'); return; }
                const initialState = initializeGameState(gridResult.value, pcResult.value);
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
                    metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
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

                const filled = countFilledPlayers(game);
                const isFull = filled === game.playerCount;
                await persistGame(game, isFull ? 'playing' : 'waiting');
                log.info('Game created', { gameId, playerCount: game.playerCount, username: cleanUsername, cpuPlayers: cpuCount });

                const gameStateWithPlayers = buildGameStateWithPlayers(game);
                socket.emit('game_created', { gameId, playerId: 'player1', sessionToken });
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
        socket.on('join_game', async ({ gameId, username, avatar, sessionToken, joinMode }) => {
            try {
                if (rateLimited('join_game')) return;

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
                    socket.join(cleanGameId);
                    socket.data.gameId = cleanGameId;
                    socket.data.playerId = 'spectator';
                    socket.data.isSpectator = true;
                    socket.emit('game_started', {
                        gameId: cleanGameId,
                        playerId: 'spectator',
                        role: 'spectator',
                        gridSize: game.gridSize,
                        playerCount: game.playerCount,
                        players: getPlayersList(game),
                        gameState: buildGameStateWithPlayers(game),
                    });
                    socket.to(cleanGameId).emit('spectator_joined', { username: cleanUsername });
                    return;
                }

                // Reconnect path: username already in game
                for (let i = 1; i <= game.playerCount; i++) {
                    const playerId = `player${i}`;
                    const player = game.players[playerId];
                    if (player && player.username === cleanUsername) {
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
                        // Clear disconnect state in Redis (visible to ALL nodes — cancels cross-node timers)
                        await disconnectStore.clearDisconnect(cleanGameId, playerId);

                        player.id = socket.id;
                        player.avatar = cleanAvatar || player.avatar;
                        player.disconnectedAt = null;
                        await gameStore.setGame(cleanGameId, game);
                        socket.join(cleanGameId);
                        socket.data.gameId = cleanGameId;
                        socket.data.playerId = playerId;
                        socket.data.isSpectator = false;
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
                const filled = countFilledPlayers(game);
                const status = filled === game.playerCount ? 'playing' : 'waiting';
                await gameStore.setGame(cleanGameId, game);
                await persistGame(game, status);

                const gameStateWithPlayers = buildGameStateWithPlayers(game);
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
                    io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });
                }
            } catch (error) {
                log.error('Error joining game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to join game');
            }
        });


        // ── make_move ──────────────────────────────────────────────────────────
        socket.on('make_move', async ({ gameId, playerId, sessionToken, type, r, c }) => {
            try {
                if (rateLimited('make_move')) return;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                // Always read from shared store (Redis) for authoritative state — prevents stale reads across nodes
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

                game.gameState = newState;
                // Write back to shared store BEFORE broadcasting
                await gameStore.setGame(cleanGameId, game);

                const status = newState.winner ? 'finished' : 'playing';
                await persistGame(game, status, newState.winner ? { reason: 'normal' } : null);

                io.to(cleanGameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

                if (newState.winner) {
                    io.to(cleanGameId).emit('game_over', { winner: newState.winner, scores: newState.scores });
                    // Fire-and-forget leaderboard update
                    updateLeaderboard(game, newState.winner, log);
                    await handleTournamentGameCompletion(io, log, cleanGameId, game, newState.winner);
                    setTimeout(async () => {
                        await gameStore.deleteGame(cleanGameId);
                        await rematchStore.clearVotes(cleanGameId);
                        await markGameFinished(cleanGameId, 'normal');
                        log.info('Game cleaned up', { gameId: cleanGameId });
                    }, 60_000);
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
        socket.on('request_rematch', async ({ gameId, sessionToken }) => {
            try {
                if (rateLimited('request_rematch')) return;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
                const cleanGameId = gidResult.value;

                const game = await gameStore.getGame(cleanGameId);
                if (!game) { socket.emit('error', 'Game not found'); return; }

                const requestingPlayerId = findPlayerBySocket(game, socket.id);
                if (!requestingPlayerId) { socket.emit('error', 'Player not found in game'); return; }

                const player = game.players[requestingPlayerId];
                if (!player || player.token !== sessionToken) {
                    socket.emit('error', 'Unauthorized rematch request');
                    return;
                }

                const gameFinished = game.gameState?.winner != null;
                if (!gameFinished) {
                    socket.emit('error', 'Rematch can only be requested after the game has finished');
                    return;
                }

                // Add vote to shared Redis store — visible across ALL nodes
                const { count: humanCount } = await rematchStore.addVote(cleanGameId, requestingPlayerId);

                // Auto-count CPU players as having voted (they can't send request_rematch)
                let cpuVotes = 0;
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    if (game.players[pid]?.isCPU) cpuVotes++;
                }
                const totalVotes = humanCount + cpuVotes;
                io.to(cleanGameId).emit('rematch_count', { count: totalVotes, total: game.playerCount });

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
                    const newGameId = await generateUniqueGameId();
                    if (!newGameId) { socket.emit('error', 'Failed to generate rematch game ID'); return; }
                    const initialState = initializeGameState(game.gridSize, game.playerCount);
                    const newGame = {
                        id: newGameId,
                        gridSize: game.gridSize,
                        playerCount: game.playerCount,
                        players: {},
                        gameState: initialState,
                        createdAt: Date.now(),
                        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
                        cpuDifficulty: game.cpuDifficulty || null,
                    };
                    for (let i = 1; i <= game.playerCount; i++) {
                        const pid = `player${i}`;
                        const oldPlayer = game.players[pid];
                        if (oldPlayer) {
                            newGame.players[pid] = {
                                id: oldPlayer.isCPU ? `cpu-${newGameId}-${i}` : oldPlayer.id,
                                username: oldPlayer.username,
                                avatar: oldPlayer.avatar, color: PLAYER_COLORS[pid],
                                token: oldPlayer.isCPU ? `cpu-token-${newGameId}-${i}` : oldPlayer.token,
                                disconnectedAt: null,
                                ...(oldPlayer.isCPU ? { isCPU: true } : {}),
                            };
                        }
                    }
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

        // ── queue_join (Quick Play matchmaking) ──────────────────────────────
        socket.on('queue_join', async ({ username, avatar, gridSize, playerCount }) => {
            try {
                if (rateLimited('queue_join')) return;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) { socket.emit('error', uResult.error); return; }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const gridResult = validateNumber(gridSize, 2, 10, 'Grid size');
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
                                ps.emit('queue_status', { position: requeue.position, queueSize: requeue.queueSize, queueKey: requeue.queueKey });
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
                        log.error('Self-match guard triggered in Quick Play — re-queuing affected players', { gameId, slotIds });
                        // Re-queue all matched players so they aren't silently dropped
                        for (const p of players) {
                            const ps = io.sockets.sockets.get(p.socketId);
                            if (ps && ps.connected) {
                                const requeue = matchmaking.joinQueue(p.socketId, p.username, p.avatar, p.gridSize, p.playerCount);
                                if (requeue.queued) {
                                    ps.data.queueKey = requeue.queueKey;
                                    ps.emit('queue_status', { position: requeue.position, queueSize: requeue.queueSize, queueKey: requeue.queueKey });
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

                    log.info('Quick Play match created', { gameId, playerCount: game.playerCount, players: players.map((p) => p.username) });
                } else {
                    // Player queued — broadcast status to ALL waiters and set timeout
                    socket.data.queueKey = result.queueKey;

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

                            log.info('Quick Play timeout — CPU game created', { gameId: cpuGameId, username: pUsername, cpuSlots: pPlayerCount - 1 });
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

        // ── queue_leave ────────────────────────────────────────────────────────
        socket.on('queue_leave', () => {
            if (!socketLimiter.allow(socket.id, 'queue_leave')) return;

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
                            });
                        }
                    }
                }
            }
        });

        // ── disconnect ─────────────────────────────────────────────────────────
        socket.on('disconnect', async () => {
            log.info('Client disconnected', { socketId: socket.id });
            socketLimiter.cleanup(socket.id);
            matchmaking.leaveQueue(socket.id);

            const processPlayerDisconnect = async (gameId, game, playerId) => {
                const player = game.players[playerId];
                if (!player) return;

                player.disconnectedAt = new Date();

                io.to(gameId).emit('player_disconnected', {
                    playerId,
                    username: player.username,
                    reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                });

                // If game already finished, just persist and skip forfeit flow
                if (game.gameState?.winner) {
                    await rematchStore.clearVotes(gameId);
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

                // Local forfeit timer — fires on THIS node after timeout
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

                        // Forfeit: pick first still-connected player as winner
                        const remaining = [];
                        for (let i = 1; i <= currentGame.playerCount; i++) {
                            const pid = `player${i}`;
                            const p = currentGame.players[pid];
                            if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
                        }
                        const winner = remaining.length > 0 ? remaining[0] : 'draw';
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
                        // Fire-and-forget leaderboard update for forfeit
                        updateLeaderboard(currentGame, winner, log);
                        await handleTournamentGameCompletion(io, log, gameId, currentGame, winner);
                        await persistGame(currentGame, 'finished', { reason: 'disconnect_forfeit' });

                        setTimeout(async () => {
                            await gameStore.deleteGame(gameId);
                            await rematchStore.clearVotes(gameId);
                        }, 60_000);
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
                    if (hintedIsSpectator) return;
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
};
