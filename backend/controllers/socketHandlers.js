const crypto = require('crypto');
const Game = require('../models/Game');
const Leaderboard = require('../models/Leaderboard');
const { calculateNewState, initializeGameState } = require('../utils/gameLogic');
const { sanitizeUsername, sanitizeAvatar, sanitizeGameId, validateNumber } = require('../utils/sanitize');
const { socketLimiter } = require('../middleware/rateLimiter');
const gameStore = require('../stores/gameStore');
const rematchStore = require('../stores/rematchStore');
const disconnectStore = require('../stores/disconnectStore');

const DISCONNECT_TIMEOUT_MS = 60_000;

// Node-local timer handles only — state visibility is handled via disconnectStore (Redis)
const localTimers = new Map(); // key: `${gameId}:${playerId}` -> { timer, socketId }

const PLAYER_COLORS = {
    player1: '#3B82F6',
    player2: '#EF4444',
    player3: '#10B981',
    player4: '#A855F7',
};

function generateSessionToken() {
    return crypto.randomBytes(24).toString('hex');
}

function countFilledPlayers(game) {
    return Object.keys(game.players).filter((pid) => !!game.players[pid]).length;
}

function gameStatusFromPlayers(game) {
    const filled = countFilledPlayers(game);
    if (game.gameState?.winner) return 'finished';
    return filled >= game.playerCount ? 'playing' : 'waiting';
}

function buildGameStateWithPlayers(game) {
    const state = { ...game.gameState };
    for (let i = 1; i <= game.playerCount; i++) {
        const playerId = `player${i}`;
        const player = game.players[playerId];
        if (player) {
            state[`${playerId}Name`] = player.username;
            state[`${playerId}Avatar`] = player.avatar;
            state[`${playerId}Color`] = player.color;
        } else {
            state[`${playerId}Name`] = `Waiting for Player ${i}...`;
            state[`${playerId}Avatar`] = '⏳';
            state[`${playerId}Color`] = PLAYER_COLORS[playerId];
        }
    }
    state.gameOver = !!state.winner;
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
            if (player && player.username) {
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
            const eloScore = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;

            const opponentElos = playerEntries
                .filter((p) => p.username !== username)
                .map((p) => (Number.isFinite(eloMap[p.username]) ? eloMap[p.username] : 1000));
            const avgOpponentElo =
                opponentElos.length > 0
                    ? Math.round(opponentElos.reduce((a, b) => a + b, 0) / opponentElos.length)
                    : 1000;

            const fallbackElo = Number.isFinite(eloMap[username]) ? eloMap[username] : 1000;

            const winInc = result === 'win' ? 1 : 0;
            const lossInc = result === 'loss' ? 1 : 0;
            const drawInc = result === 'draw' ? 1 : 0;

            const MAX_ELO_UPDATE_RETRIES = 5;
            let applied = false;

            // Optimistic concurrency loop: guard update by current stored ELO.
            for (let attempt = 1; attempt <= MAX_ELO_UPDATE_RETRIES; attempt++) {
                const existing = await Leaderboard.findOne({ username }).select('_id elo').lean();
                const baseElo = Number.isFinite(existing?.elo) ? existing.elo : fallbackElo;
                const newElo = Leaderboard.calculateElo(baseElo, avgOpponentElo, eloScore);

                const filter = existing
                    ? { _id: existing._id, elo: baseElo }
                    : { username, gamesPlayed: { $exists: false } };

                try {
                    const updatedDoc = await Leaderboard.findOneAndUpdate(
                        filter,
                        [
                            {
                                $set: {
                                    username,
                                    elo: newElo,
                                    lastPlayedAt: now,
                                    updatedAt: now,
                                    createdAt: { $ifNull: ['$createdAt', now] },
                                    gamesPlayed: { $add: [{ $ifNull: ['$gamesPlayed', 0] }, 1] },
                                    wins: { $add: [{ $ifNull: ['$wins', 0] }, winInc] },
                                    losses: { $add: [{ $ifNull: ['$losses', 0] }, lossInc] },
                                    draws: { $add: [{ $ifNull: ['$draws', 0] }, drawInc] },
                                    currentStreak:
                                        result === 'win'
                                            ? { $add: [{ $ifNull: ['$currentStreak', 0] }, 1] }
                                            : result === 'loss'
                                                ? 0
                                                : { $ifNull: ['$currentStreak', 0] },
                                    bestStreak: { $ifNull: ['$bestStreak', 0] },
                                },
                            },
                            {
                                $set: {
                                    bestStreak:
                                        result === 'win'
                                            ? { $max: ['$bestStreak', '$currentStreak'] }
                                            : '$bestStreak',
                                },
                            },
                            {
                                $set: {
                                    winRate: {
                                        $cond: [
                                            { $gt: ['$gamesPlayed', 0] },
                                            {
                                                $round: [
                                                    { $multiply: [{ $divide: ['$wins', '$gamesPlayed'] }, 100] },
                                                    2,
                                                ],
                                            },
                                            0,
                                        ],
                                    },
                                },
                            },
                        ],
                        { upsert: !existing, new: true }
                    ).lean();

                    // Null = optimistic filter miss due to concurrent writer; retry.
                    if (!updatedDoc) continue;

                    eloMap[username] = updatedDoc.elo;
                    applied = true;
                    break;
                } catch (error) {
                    // Upsert races against unique username are transient; retry.
                    if (error?.code === 11000 || error?.code === 11001) continue;
                    throw error;
                }
            }

            if (!applied) {
                throw new Error(`Failed to update leaderboard for ${username} after ${MAX_ELO_UPDATE_RETRIES} retries`);
            }
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

module.exports = function attachSocketHandlers(io, log) {
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

        // ── create_game ────────────────────────────────────────────────────────
        socket.on('create_game', async ({ gridSize, username, avatar, playerCount = 2 }, callback) => {
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

                const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
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
                };

                await gameStore.setGame(gameId, game);
                socket.join(gameId);
                socket.data.gameId = gameId;
                socket.data.playerId = 'player1';
                await persistGame(game, 'waiting');
                log.info('Game created', { gameId, playerCount: game.playerCount, username: cleanUsername });

                const gameStateWithPlayers = buildGameStateWithPlayers(game);
                socket.emit('game_created', { gameId, playerId: 'player1', sessionToken });
                socket.emit('game_started', {
                    gameId, playerId: 'player1', sessionToken,
                    gridSize: game.gridSize, playerCount: game.playerCount,
                    players: getPlayersList(game), gameState: gameStateWithPlayers,
                });
                if (callback) callback({ gameId, playerId: 'player1', sessionToken });
            } catch (error) {
                log.error('Error creating game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to create game');
            }
        });

        // ── join_game ──────────────────────────────────────────────────────────
        socket.on('join_game', async ({ gameId, username, avatar, sessionToken }) => {
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
                    setTimeout(async () => {
                        await gameStore.deleteGame(cleanGameId);
                        await rematchStore.clearVotes(cleanGameId);
                        await markGameFinished(cleanGameId, 'normal');
                        log.info('Game cleaned up', { gameId: cleanGameId });
                    }, 60_000);
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
                const { count } = await rematchStore.addVote(cleanGameId, requestingPlayerId);
                io.to(cleanGameId).emit('rematch_count', { count, total: game.playerCount });

                if (count >= game.playerCount) {
                    const newGameId = Math.random().toString(36).substring(2, 8).toUpperCase();
                    const initialState = initializeGameState(game.gridSize, game.playerCount);
                    const newGame = {
                        id: newGameId,
                        gridSize: game.gridSize,
                        playerCount: game.playerCount,
                        players: {},
                        gameState: initialState,
                        createdAt: Date.now(),
                        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
                    };
                    for (let i = 1; i <= game.playerCount; i++) {
                        const pid = `player${i}`;
                        const oldPlayer = game.players[pid];
                        if (oldPlayer) {
                            newGame.players[pid] = {
                                id: oldPlayer.id, username: oldPlayer.username,
                                avatar: oldPlayer.avatar, color: PLAYER_COLORS[pid],
                                token: oldPlayer.token, disconnectedAt: null,
                            };
                        }
                    }
                    await gameStore.setGame(newGameId, newGame);
                    await rematchStore.clearVotes(cleanGameId);
                    await persistGame(newGame, 'playing');
                    await markGameFinished(cleanGameId, 'rematch_started');
                    io.to(cleanGameId).emit('rematch_ready', { newGameId });
                }
            } catch (error) {
                log.error('Error processing rematch request', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to process rematch request');
            }
        });

        // ── disconnect ─────────────────────────────────────────────────────────
        socket.on('disconnect', async () => {
            log.info('Client disconnected', { socketId: socket.id });
            socketLimiter.cleanup(socket.id);

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
                // Fast path: use socket-attached game context to avoid scanning all active games.
                const hintedGameId = socket.data?.gameId;
                const hintedPlayerId = socket.data?.playerId;
                if (hintedGameId && hintedPlayerId) {
                    const hintedGame = await gameStore.getGame(hintedGameId);
                    if (hintedGame?.players?.[hintedPlayerId]?.id === socket.id) {
                        await processPlayerDisconnect(hintedGameId, hintedGame, hintedPlayerId);
                        return;
                    }
                }

                // Fallback path for legacy sockets / missing hints.
                const allGames = await gameStore.getAllActiveGames();
                for (const [gameId, game] of allGames.entries()) {
                    const playerId = findPlayerBySocket(game, socket.id);
                    if (!playerId) continue;
                    await processPlayerDisconnect(gameId, game, playerId);
                    break;
                }
            } catch (error) {
                log.error('Error handling disconnect', { socketId: socket.id, error: error.message });
            } finally {
                socket.data.gameId = undefined;
                socket.data.playerId = undefined;
            }
        });
    });

    return { gameStore, rematchStore, disconnectStore, localTimers };
};
