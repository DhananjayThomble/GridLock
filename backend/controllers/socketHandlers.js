const { calculateNewState, initializeGameState } = require('../utils/gameLogic');
const { sanitizeUsername, sanitizeAvatar, sanitizeGameId, validateNumber } = require('../utils/sanitize');
const { socketLimiter } = require('../middleware/rateLimiter');

// In-memory game store
const activeGames = new Map();

// Rematch tracking: { gameId -> Set of playerIds who requested rematch }
const rematchRequests = new Map();

// Player colors for UI
const PLAYER_COLORS = {
    player1: '#3B82F6', // Blue
    player2: '#EF4444', // Red
    player3: '#10B981', // Green
    player4: '#A855F7'  // Purple
};

// Disconnect timeout tracking: { gameId:playerId -> timeoutHandle }
const disconnectTimers = new Map();
const DISCONNECT_TIMEOUT_MS = 60_000; // 60 seconds to reconnect

/**
 * Build game state with all player information
 */
function buildGameStateWithPlayers(game) {
    const state = { ...game.gameState };
    
    // Add player info for each slot
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
    
    // Ensure gameOver flag is always present
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

module.exports = function(io, log) {
    io.on('connection', (socket) => {
        log.info('New client connected:', socket.id);

        /**
         * Rate-limit guard helper
         */
        const rateLimited = (eventName) => {
            if (!socketLimiter.allow(socket.id, eventName)) {
                log.warn('Rate limited', { socketId: socket.id, event: eventName });
                socket.emit('error', 'Too many requests. Please slow down.');
                return true;
            }
            return false;
        };

        /**
         * Create new game
         * Supports 2-4 players
         */
        socket.on('create_game', ({ gridSize, username, avatar, playerCount = 2 }, callback) => {
            try {
                if (rateLimited('create_game')) return;

                log.debug('create_game event', { gridSize, username, avatar, playerCount, socketId: socket.id });
                
                // Sanitize inputs
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
                
                const newGame = {
                    id: gameId,
                    gridSize: gridResult.value,
                    playerCount: pcResult.value,
                    players: {},
                    gameState: initialState,
                    createdAt: Date.now()
                };

                // Add player 1
                newGame.players.player1 = { 
                    id: socket.id, 
                    username: cleanUsername, 
                    avatar: cleanAvatar,
                    color: PLAYER_COLORS.player1
                };

                activeGames.set(gameId, newGame);
                socket.join(gameId);
                
                log.info(`Game created: ${gameId} by ${username}, ${playerCount} players`, { gameId, username, playerCount });
                
                // Build game state with player info
                const gameStateWithPlayers = buildGameStateWithPlayers(newGame);
                
                socket.emit('game_created', { gameId, playerId: 'player1' });
                socket.emit('game_started', {
                    gameId,
                    gridSize,
                    playerCount,
                    players: getPlayersList(newGame),
                    gameState: gameStateWithPlayers
                });
                
                if (callback) callback({ gameId, playerId: 'player1' });
                
            } catch (error) {
                log.error('Error creating game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to create game');
            }
        });

        /**
         * Join existing game
         */
        socket.on('join_game', ({ gameId, username, avatar }) => {
            try {
                if (rateLimited('join_game')) return;

                log.debug('join_game event', { gameId, username, avatar, socketId: socket.id });
                
                // Sanitize inputs
                const uResult = sanitizeUsername(username);
                if (!uResult.valid) {
                    socket.emit('error', uResult.error);
                    return;
                }
                const cleanUsername = uResult.value;
                const cleanAvatar = sanitizeAvatar(avatar);

                const gidResult = sanitizeGameId(gameId);
                if (!gidResult.valid) {
                    socket.emit('error', gidResult.error);
                    return;
                }

                const game = activeGames.get(gidResult.value);
                
                if (!game) {
                    log.warn('Game not found', { gameId: gidResult.value });
                    socket.emit('error', 'Game not found');
                    return;
                }

                // Check if reconnecting
                for (let i = 1; i <= game.playerCount; i++) {
                    const playerId = `player${i}`;
                    const player = game.players[playerId];
                    
                    if (player && player.username === cleanUsername) {
                        log.info('Player reconnecting', { gameId: gidResult.value, playerId, username: cleanUsername });
                        
                        // Cancel any pending disconnect timer
                        const timerKey = `${gidResult.value}:${playerId}`;
                        if (disconnectTimers.has(timerKey)) {
                            clearTimeout(disconnectTimers.get(timerKey));
                            disconnectTimers.delete(timerKey);
                            log.info('Cancelled disconnect timer for reconnecting player', { timerKey });
                            // Notify others that player is back
                            socket.to(gidResult.value).emit('player_reconnected', { playerId, username: cleanUsername });
                        }
                        
                        // Update socket ID
                        player.id = socket.id;
                        if (avatar) player.avatar = cleanAvatar;
                        socket.join(gidResult.value);
                        
                        const gameStateWithPlayers = buildGameStateWithPlayers(game);
                        socket.emit('game_started', {
                            gameId: gidResult.value,
                            playerId,
                            gridSize: game.gridSize,
                            playerCount: game.playerCount,
                            players: getPlayersList(game),
                            gameState: gameStateWithPlayers
                        });
                        return;
                    }
                }

                // Find empty slot
                let assignedSlot = null;
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    if (!game.players[pid]) {
                        assignedSlot = pid;
                        break;
                    }
                }

                if (!assignedSlot) {
                    log.warn('Game is full', { gameId: gidResult.value, username: cleanUsername });
                    socket.emit('error', 'Game is full');
                    return;
                }

                log.info('New player joining', { gameId: gidResult.value, playerId: assignedSlot, username: cleanUsername });

                // Add new player
                game.players[assignedSlot] = {
                    id: socket.id,
                    username: cleanUsername,
                    avatar: cleanAvatar,
                    color: PLAYER_COLORS[assignedSlot]
                };
                
                socket.join(gidResult.value);

                // Build updated game state
                const gameStateWithPlayers = buildGameStateWithPlayers(game);
                
                // Notify the joining player with their assigned playerId
                socket.emit('game_started', {
                    gameId: gidResult.value,
                    playerId: assignedSlot,
                    gridSize: game.gridSize,
                    playerCount: game.playerCount,
                    players: getPlayersList(game),
                    gameState: gameStateWithPlayers
                });
                // Notify other players in the room
                socket.to(gidResult.value).emit('game_started', {
                    gameId: gidResult.value,
                    gridSize: game.gridSize,
                    playerCount: game.playerCount,
                    players: getPlayersList(game),
                    gameState: gameStateWithPlayers
                });

                // Check if game is ready to start
                const playersFilled = Object.keys(game.players).length;
                if (playersFilled === game.playerCount) {
                    log.info('Game ready - all players joined', { gameId: gidResult.value, playerCount: game.playerCount });
                    io.to(gidResult.value).emit('all_players_joined', { gameId: gidResult.value });
                }

            } catch (error) {
                log.error('Error joining game', { error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to join game');
            }
        });

        /**
         * Handle player move
         */
        socket.on('make_move', ({ gameId, playerId, type, r, c }) => {
            try {
                if (rateLimited('make_move')) return;

                log.debug('make_move event', { gameId, playerId, type, r, c, socketId: socket.id });
                
                const game = activeGames.get(gameId);
                if (!game) {
                    log.warn('Game not found for move', { gameId });
                    socket.emit('error', 'Game not found');
                    return;
                }

                // Validate turn
                const currentTurn = game.gameState.currentPlayer;
                if (currentTurn !== playerId) {
                    log.warn('Not player turn', { gameId, currentTurn, attemptedBy: playerId });
                    socket.emit('error', 'Not your turn');
                    return;
                }

                // Calculate new state
                const newState = calculateNewState(game.gameState, game.gridSize, r, c, type);
                
                if (newState.error) {
                    log.warn('Invalid move', { gameId, error: newState.error, move: { type, r, c } });
                    socket.emit('error', newState.error);
                    return;
                }

                log.debug('Move successful', { gameId, currentPlayer: newState.currentPlayer, scores: newState.scores });

                // Update game state
                game.gameState = newState;
                activeGames.set(gameId, game);

                // Build game state with player info
                const gameStateWithPlayers = buildGameStateWithPlayers(game);

                log.info('Broadcasting game_update', { gameId, currentPlayer: newState.currentPlayer, scores: newState.scores });

                // Broadcast update
                io.to(gameId).emit('game_update', {
                    gameState: gameStateWithPlayers
                });

                // Check for game over
                if (newState.winner) {
                    log.info('Game over', { gameId, winner: newState.winner, scores: newState.scores });
                    io.to(gameId).emit('game_over', { 
                        winner: newState.winner,
                        scores: newState.scores 
                    });
                    
                    // Cleanup after delay (optional)
                    setTimeout(() => {
                        activeGames.delete(gameId);
                        log.info('Game cleaned up', { gameId });
                    }, 60000); // 1 minute
                }

            } catch (error) {
                log.error('Error processing move', { gameId, error: error.message, stack: error.stack });
                socket.emit('error', 'Invalid move');
            }
        });

        /**
         * Handle rematch request
         */
        socket.on('request_rematch', ({ gameId }) => {
            try {
                if (rateLimited('request_rematch')) return;

                log.debug('request_rematch event', { gameId, socketId: socket.id });
                
                const game = activeGames.get(gameId);
                if (!game) {
                    log.warn('Game not found for rematch', { gameId });
                    socket.emit('error', 'Game not found');
                    return;
                }

                // Find which player this socket belongs to
                let requestingPlayerId = null;
                for (let i = 1; i <= game.playerCount; i++) {
                    const playerId = `player${i}`;
                    if (game.players[playerId]?.id === socket.id) {
                        requestingPlayerId = playerId;
                        break;
                    }
                }

                if (!requestingPlayerId) {
                    log.warn('Player not found in game for rematch', { gameId, socketId: socket.id });
                    socket.emit('error', 'Player not found in game');
                    return;
                }

                // Initialize rematch tracking for this game if needed
                if (!rematchRequests.has(gameId)) {
                    rematchRequests.set(gameId, new Set());
                }

                const requests = rematchRequests.get(gameId);
                requests.add(requestingPlayerId);

                log.info('Rematch requested', { 
                    gameId, 
                    playerId: requestingPlayerId, 
                    totalRequests: requests.size,
                    playerCount: game.playerCount
                });

                // Broadcast rematch count to all players in the game
                io.to(gameId).emit('rematch_count', { 
                    count: requests.size,
                    total: game.playerCount
                });

                // Check if all players have requested rematch
                if (requests.size === game.playerCount) {
                    log.info('All players requested rematch, creating new game', { gameId });

                    // Create new game with same settings
                    const newGameId = Math.random().toString(36).substring(2, 8).toUpperCase();
                    const initialState = initializeGameState(game.gridSize, game.playerCount);
                    
                    const newGame = {
                        id: newGameId,
                        gridSize: game.gridSize,
                        playerCount: game.playerCount,
                        players: {},
                        gameState: initialState,
                        createdAt: Date.now()
                    };

                    // Add all players from old game to new game
                    for (let i = 1; i <= game.playerCount; i++) {
                        const playerId = `player${i}`;
                        const oldPlayer = game.players[playerId];
                        if (oldPlayer) {
                            newGame.players[playerId] = {
                                id: oldPlayer.id,
                                username: oldPlayer.username,
                                avatar: oldPlayer.avatar,
                                color: PLAYER_COLORS[playerId]
                            };
                        }
                    }

                    activeGames.set(newGameId, newGame);
                    
                    // Clean up old rematch requests
                    rematchRequests.delete(gameId);

                    log.info('New rematch game created', { 
                        oldGameId: gameId, 
                        newGameId, 
                        playerCount: game.playerCount 
                    });

                    // Notify all players in the old game room
                    io.to(gameId).emit('rematch_ready', { newGameId });
                    
                }

            } catch (error) {
                log.error('Error processing rematch request', { gameId, error: error.message, stack: error.stack });
                socket.emit('error', 'Failed to process rematch request');
            }
        });

        /**
         * Handle disconnect — start grace period for reconnection
         */
        socket.on('disconnect', () => {
            log.info('Client disconnected:', socket.id);
            
            // Clean up rate limiter tracking
            socketLimiter.cleanup(socket.id);
            
            // Find which games this socket was in
            for (const [gameId, game] of activeGames.entries()) {
                for (let i = 1; i <= game.playerCount; i++) {
                    const playerId = `player${i}`;
                    if (game.players[playerId]?.id === socket.id) {
                        const timerKey = `${gameId}:${playerId}`;
                        const playerName = game.players[playerId].username;
                        
                        // If game is already over, just clean up rematch requests
                        if (game.gameState.winner) {
                            // Clean up rematch request
                            const requests = rematchRequests.get(gameId);
                            if (requests) {
                                requests.delete(playerId);
                                if (requests.size > 0) {
                                    io.to(gameId).emit('rematch_count', { count: requests.size, total: game.playerCount });
                                } else {
                                    rematchRequests.delete(gameId);
                                }
                            }
                            break;
                        }
                        
                        // Notify others that player disconnected (with grace period)
                        io.to(gameId).emit('player_disconnected', { 
                            playerId, 
                            username: playerName,
                            reconnectWindowMs: DISCONNECT_TIMEOUT_MS 
                        });
                        
                        log.info('Starting disconnect timer', { gameId, playerId, timeoutMs: DISCONNECT_TIMEOUT_MS });
                        
                        // Start grace period timer
                        const timer = setTimeout(() => {
                            disconnectTimers.delete(timerKey);
                            const currentGame = activeGames.get(gameId);
                            if (!currentGame) return;
                            
                            // Check if player reconnected (socket.id would have changed)
                            const player = currentGame.players[playerId];
                            if (player && player.id === socket.id) {
                                // Still disconnected after timeout — forfeit
                                log.info('Player forfeited due to disconnect timeout', { gameId, playerId, username: playerName });
                                
                                io.to(gameId).emit('player_forfeited', { 
                                    playerId, 
                                    username: playerName 
                                });
                                
                                // Remove player from game
                                delete currentGame.players[playerId];
                                
                                // If only 1 player left, they win
                                const remainingPlayers = Object.keys(currentGame.players).filter(
                                    pid => currentGame.players[pid] !== undefined
                                );
                                
                                if (remainingPlayers.length === 1) {
                                    const winner = remainingPlayers[0];
                                    currentGame.gameState.winner = winner;
                                    const gameStateWithPlayers = buildGameStateWithPlayers(currentGame);
                                    io.to(gameId).emit('game_update', { gameState: gameStateWithPlayers });
                                    io.to(gameId).emit('game_over', { 
                                        winner, 
                                        scores: currentGame.gameState.scores,
                                        reason: 'opponent_disconnected'
                                    });
                                    
                                    // Clean up
                                    setTimeout(() => activeGames.delete(gameId), 60_000);
                                } else if (currentGame.gameState.currentPlayer === playerId) {
                                    // Skip to next player's turn
                                    const { getNextPlayer } = require('../utils/gameLogic');
                                    currentGame.gameState.currentPlayer = getNextPlayer(
                                        playerId, 
                                        currentGame.gameState.players
                                    );
                                    const gameStateWithPlayers = buildGameStateWithPlayers(currentGame);
                                    io.to(gameId).emit('game_update', { gameState: gameStateWithPlayers });
                                }
                            }
                        }, DISCONNECT_TIMEOUT_MS);
                        
                        disconnectTimers.set(timerKey, timer);
                        break;
                    }
                }
            }
        });
    });

    return { activeGames };
};