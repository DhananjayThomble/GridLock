const crypto = require('crypto');
const Game = require('../models/Game');
const { calculateNewState, initializeGameState, getNextPlayer } = require('../utils/gameLogic');
const { sanitizeUsername, sanitizeAvatar, sanitizeGameId, validateNumber } = require('../utils/sanitize');
const { socketLimiter } = require('../middleware/rateLimiter');

// In-memory game store (hot state)
const activeGames = new Map();

// Rematch tracking: { gameId -> Set of playerIds who requested rematch }
const rematchRequests = new Map();

// Disconnect timeout tracking: { `${gameId}:${playerId}` -> { timer, socketId } }
const disconnectTimers = new Map();
const DISCONNECT_TIMEOUT_MS = 60_000;

// Player colors for UI
const PLAYER_COLORS = {
    player1: '#3B82F6', // Blue
    player2: '#EF4444', // Red
    player3: '#10B981', // Green
    player4: '#A855F7', // Purple
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

/**
 * Build game state with all player information
 */
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

/**
 * Get simplified players list
 */
function getPlayersList(game) {
    const players = {};
    for (let i = 1; i <= game.playerCount; i++) {
        const playerId = `player${i}`;
        players[playerId] = game.players[playerId] ? game.players[playerId].username : null;
    }
    return players;
}

/**
 * Persist game to MongoDB
 */
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

    if (metadata) {
        payload.metadata = { ...(game.metadata || {}), ...metadata };
    }

    if (finalStatus === 'finished' || finalStatus === 'abandoned') {
        payload.finishedAt = now;
    }

    await Game.findOneAndUpdate(
        { gameId: game.id },
        { $set: payload, $setOnInsert: { createdAt: game.createdAt ? new Date(game.createdAt) : now } },
        { upsert: true, new: false }
    );
}

/**
 * Mark game finished in persistence layer
 */
async function markGameFinished(gameId, reason = null) {
    const patch = {
        status: 'finished',
        finishedAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
    };

    if (reason) {
        patch['metadata.reason'] = reason;
    }

    await Game.findOneAndUpdate({ gameId }, { $set: patch }, { new: false });
}

/**
 * Restore active games from MongoDB on startup
 */
async function restoreActiveGames(log) {
    try {
        const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h
        const docs = await Game.find({
            status: { $in: ['waiting', 'playing'] },
            lastActivityAt: { $gte: staleCutoff },
        }).lean();

        for (const doc of docs) {
            const players = doc.players
                ? (doc.players instanceof Map ? Object.fromEntries(doc.players) : doc.players)
                : {};

            activeGames.set(doc.gameId, {
                id: doc.gameId,
                gridSize: doc.gridSize,
                playerCount: doc.playerCount,
                players,
                gameState: doc.gameState,
                createdAt: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now(),
                metadata: doc.metadata || {},
            });
        }

        if (docs.length > 0) {
            log.info('Recovered active games from database', { count: docs.length });
        }
    } catch (error) {
        log.error('Failed to restore active games from DB', { error: error.message });
    }
}

/**
 * Find player by socket id in a specific game
 */
function findPlayerBySocket(game, socketId) {
    for (let i = 1; i <= game.playerCount; i++) {
        const playerId = `player${i}`;
        if (game.players[playerId]?.id === socketId) {
            return playerId;
        }
    }
    return null;
}

module.exports = function attachSocketHandlers(io, log) {
    // Best effort restore. Do not block startup.
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

        /**
         * Create game
         */
        socket.on('create_game', async ({ gridSize, username, avatar, playerCount = 2 }, callback) => {
            try {
                if (rateLimited('create_game')) return;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) {
                    socket.emit('error', uResult.error);
                    return;
                }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const gridResult = validateNumber(gridSize, 2, 10, 'Grid size');
                if (!gridResult.valid) {
                    socket.emit('error', gridResult.error);
                    return;
                }

                const pcResult = validateNumber(playerCount, 2, 4, 'Player count');
                if (!pcResult.valid) {
                    socket.emit('error', pcResult.error);
                    return;
                }

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
                    metadata: {
                        reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                    },
                };

                activeGames.set(gameId, game);
                socket.join(gameId);

                await persistGame(game, 'waiting');

                log.info('Game created', { gameId, playerCount: game.playerCount, username: cleanUsername });

                const gameStateWithPlayers = buildGameStateWithPlayers(game);

                socket.emit('game_created', { gameId, playerId: 'player1', sessionToken });
                socket.emit('game_started', {
                    gameId,
                    playerId: 'player1',
                    sessionToken,
                    gridSize: game.gridSize,
                    playerCount: game.playerCount,
                    players: getPlayersList(game),
                    gameState: gameStateWithPlayers,
                });

                if (callback) callback({ gameId, playerId: 'player1', sessionToken });
            } catch (error) {
                log.error('Error creating game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to create game');
            }
        });

        /**
         * Join/reconnect game
         */
        socket.on('join_game', async ({ gameId, username, avatar, sessionToken }) => {
            try {
                if (rateLimited('join_game')) return;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) {
                    socket.emit('error', gidResult.error);
                    return;
                }
                const cleanGameId = gidResult.value;

                const uResult = sanitizeUsername(username);
                if (!uResult.valid) {
                    socket.emit('error', uResult.error);
                    return;
                }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const game = activeGames.get(cleanGameId);
                if (!game) {
                    socket.emit('error', 'Game not found');
                    return;
                }

                // Reconnect path: username already in game
                for (let i = 1; i <= game.playerCount; i++) {
                    const playerId = `player${i}`;
                    const player = game.players[playerId];

                    if (player && player.username === cleanUsername) {
                        if (!sessionToken || sessionToken !== player.token) {
                            log.warn('Rejected reconnect due to invalid token', {
                                gameId: cleanGameId,
                                playerId,
                                username: cleanUsername,
                            });
                            socket.emit('error', 'Invalid session token for this username');
                            return;
                        }

                        // Cancel disconnect timer if any
                        const timerKey = `${cleanGameId}:${playerId}`;
                        if (disconnectTimers.has(timerKey)) {
                            clearTimeout(disconnectTimers.get(timerKey).timer);
                            disconnectTimers.delete(timerKey);
                        }

                        player.id = socket.id;
                        player.avatar = cleanAvatar || player.avatar;
                        player.disconnectedAt = null;

                        socket.join(cleanGameId);

                        await persistGame(game);

                        socket.emit('game_started', {
                            gameId: cleanGameId,
                            playerId,
                            sessionToken: player.token,
                            gridSize: game.gridSize,
                            playerCount: game.playerCount,
                            players: getPlayersList(game),
                            gameState: buildGameStateWithPlayers(game),
                        });

                        socket.to(cleanGameId).emit('player_reconnected', {
                            playerId,
                            username: cleanUsername,
                        });

                        return;
                    }
                }

                // New join path
                let assignedSlot = null;
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    if (!game.players[pid]) {
                        assignedSlot = pid;
                        break;
                    }
                }

                if (!assignedSlot) {
                    socket.emit('error', 'Game is full');
                    return;
                }

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

                const filled = countFilledPlayers(game);
                const status = filled === game.playerCount ? 'playing' : 'waiting';
                await persistGame(game, status);

                const gameStateWithPlayers = buildGameStateWithPlayers(game);

                // Joining player gets token
                socket.emit('game_started', {
                    gameId: cleanGameId,
                    playerId: assignedSlot,
                    sessionToken: newSessionToken,
                    gridSize: game.gridSize,
                    playerCount: game.playerCount,
                    players: getPlayersList(game),
                    gameState: gameStateWithPlayers,
                });

                // Others don't get this player's token
                socket.to(cleanGameId).emit('game_started', {
                    gameId: cleanGameId,
                    gridSize: game.gridSize,
                    playerCount: game.playerCount,
                    players: getPlayersList(game),
                    gameState: gameStateWithPlayers,
                });

                if (filled === game.playerCount) {
                    io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });
                }
            } catch (error) {
                log.error('Error joining game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to join game');
            }
        });

        /**
         * Make move
         */
        socket.on('make_move', async ({ gameId, playerId, sessionToken, type, r, c }) => {
            try {
                if (rateLimited('make_move')) return;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) {
                    socket.emit('error', gidResult.error);
                    return;
                }

                const game = activeGames.get(gidResult.value);
                if (!game) {
                    socket.emit('error', 'Game not found');
                    return;
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
                if (newState.error) {
                    socket.emit('error', newState.error);
                    return;
                }

                game.gameState = newState;

                const status = newState.winner ? 'finished' : 'playing';
                await persistGame(game, status, newState.winner ? { reason: 'normal' } : null);

                io.to(gidResult.value).emit('game_update', {
                    gameState: buildGameStateWithPlayers(game),
                });

                if (newState.winner) {
                    io.to(gidResult.value).emit('game_over', {
                        winner: newState.winner,
                        scores: newState.scores,
                    });

                    // Keep in memory briefly for rematch UX then cleanup
                    setTimeout(async () => {
                        activeGames.delete(gidResult.value);
                        rematchRequests.delete(gidResult.value);
                        await markGameFinished(gidResult.value, 'normal');
                        log.info('Game cleaned up from memory', { gameId: gidResult.value });
                    }, 60_000);
                }
            } catch (error) {
                log.error('Error processing move', { error: error.message, stack: error.stack });
                socket.emit('error', 'Invalid move');
            }
        });

        /**
         * Request rematch
         */
        socket.on('request_rematch', async ({ gameId, sessionToken }) => {
            try {
                if (rateLimited('request_rematch')) return;

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) {
                    socket.emit('error', gidResult.error);
                    return;
                }
                const cleanGameId = gidResult.value;

                const game = activeGames.get(cleanGameId);
                if (!game) {
                    socket.emit('error', 'Game not found');
                    return;
                }

                const requestingPlayerId = findPlayerBySocket(game, socket.id);
                if (!requestingPlayerId) {
                    socket.emit('error', 'Player not found in game');
                    return;
                }

                const player = game.players[requestingPlayerId];
                if (!player || player.token !== sessionToken) {
                    socket.emit('error', 'Unauthorized rematch request');
                    return;
                }

                if (!rematchRequests.has(cleanGameId)) {
                    rematchRequests.set(cleanGameId, new Set());
                }

                const requests = rematchRequests.get(cleanGameId);
                requests.add(requestingPlayerId);

                io.to(cleanGameId).emit('rematch_count', {
                    count: requests.size,
                    total: game.playerCount,
                });

                if (requests.size === game.playerCount) {
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

                    // Carry players & existing tokens forward (continuity)
                    for (let i = 1; i <= game.playerCount; i++) {
                        const pid = `player${i}`;
                        const oldPlayer = game.players[pid];
                        if (oldPlayer) {
                            newGame.players[pid] = {
                                id: oldPlayer.id,
                                username: oldPlayer.username,
                                avatar: oldPlayer.avatar,
                                color: PLAYER_COLORS[pid],
                                token: oldPlayer.token,
                                disconnectedAt: null,
                            };
                        }
                    }

                    activeGames.set(newGameId, newGame);
                    rematchRequests.delete(cleanGameId);

                    await persistGame(newGame, 'playing');
                    await markGameFinished(cleanGameId, 'rematch_started');

                    io.to(cleanGameId).emit('rematch_ready', { newGameId });
                }
            } catch (error) {
                log.error('Error processing rematch request', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to process rematch request');
            }
        });

        /**
         * Disconnect
         */
        socket.on('disconnect', () => {
            log.info('Client disconnected', { socketId: socket.id });
            socketLimiter.cleanup(socket.id);

            for (const [gameId, game] of activeGames.entries()) {
                const playerId = findPlayerBySocket(game, socket.id);
                if (!playerId) continue;

                const player = game.players[playerId];
                player.disconnectedAt = new Date();

                // Inform room
                io.to(gameId).emit('player_disconnected', {
                    playerId,
                    username: player.username,
                    reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                });

                // If already finished, no forfeit workflow needed
                if (game.gameState?.winner) {
                    persistGame(game, 'finished').catch((err) => {
                        log.error('Persist after disconnect failed', { gameId, error: err.message });
                    });
                    continue;
                }

                const timerKey = `${gameId}:${playerId}`;
                if (disconnectTimers.has(timerKey)) {
                    clearTimeout(disconnectTimers.get(timerKey).timer);
                }

                const timer = setTimeout(async () => {
                    try {
                        disconnectTimers.delete(timerKey);
                        const currentGame = activeGames.get(gameId);
                        if (!currentGame) return;

                        const currentPlayer = currentGame.players[playerId];
                        if (!currentPlayer) return;

                        // If player reconnected, socket id won't match old socket id
                        if (currentPlayer.id !== socket.id || !currentPlayer.disconnectedAt) {
                            return;
                        }

                        // Forfeit disconnected player, pick first connected remaining player
                        const remaining = [];
                        for (let i = 1; i <= currentGame.playerCount; i++) {
                            const pid = `player${i}`;
                            const p = currentGame.players[pid];
                            if (p && pid !== playerId && !p.disconnectedAt) {
                                remaining.push(pid);
                            }
                        }

                        let winner = 'draw';
                        if (remaining.length > 0) {
                            winner = remaining[0];
                        }

                        currentGame.gameState.winner = winner;

                        const stateWithPlayers = buildGameStateWithPlayers(currentGame);
                        io.to(gameId).emit('game_update', { gameState: stateWithPlayers });
                        io.to(gameId).emit('game_over', {
                            winner,
                            scores: currentGame.gameState.scores,
                            reason: 'opponent_disconnected',
                        });

                        await persistGame(currentGame, 'finished', { reason: 'disconnect_forfeit' });

                        setTimeout(() => {
                            activeGames.delete(gameId);
                            rematchRequests.delete(gameId);
                        }, 60_000);
                    } catch (err) {
                        log.error('Disconnect timeout handler failed', { gameId, playerId, error: err.message });
                    }
                }, DISCONNECT_TIMEOUT_MS);

                disconnectTimers.set(timerKey, { timer, socketId: socket.id });

                persistGame(game).catch((err) => {
                    log.error('Persist after disconnect failed', { gameId, error: err.message });
                });
            }
        });
    });

    return {
        activeGames,
        rematchRequests,
        disconnectTimers,
    };
};
