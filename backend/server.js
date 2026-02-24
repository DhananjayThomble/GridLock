// server.js - Production-ready multiplayer game server (2-4 players)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { calculateNewState, initializeGameState } = require('./utils/gameLogic');

const app = express();
const server = http.createServer(app);

// Logging utility with levels
const LOG_LEVEL = process.env.LOG_LEVEL || 'DEBUG';
const log = {
    debug: (...args) => ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(LOG_LEVEL) && console.log('[DEBUG]', new Date().toISOString(), ...args),
    info: (...args) => ['INFO', 'WARN', 'ERROR'].includes(LOG_LEVEL) && console.log('[INFO]', new Date().toISOString(), ...args),
    warn: (...args) => ['WARN', 'ERROR'].includes(LOG_LEVEL) && console.warn('[WARN]', new Date().toISOString(), ...args),
    error: (...args) => ['ERROR'].includes(LOG_LEVEL) && console.error('[ERROR]', new Date().toISOString(), ...args)
};

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGO_URI)
.then(() => log.info('MongoDB connected'))
.catch(err => log.error('MongoDB connection error:', err));

// Socket.io Setup
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// In-memory game store
const activeGames = new Map();

// Player colors for UI
const PLAYER_COLORS = {
    player1: '#3B82F6', // Blue
    player2: '#EF4444', // Red
    player3: '#10B981', // Green
    player4: '#A855F7'  // Purple
};

io.on('connection', (socket) => {
    log.info('New client connected:', socket.id);

    /**
     * Create new game
     * Supports 2-4 players
     */
    socket.on('create_game', ({ gridSize, username, avatar, playerCount = 2 }, callback) => {
        try {
            log.debug('create_game event', { gridSize, username, avatar, playerCount, socketId: socket.id });
            
            // Validation
            if (!username || username.trim().length === 0) {
                socket.emit('error', 'Username required');
                return;
            }
            if (gridSize < 2 || gridSize > 10) {
                socket.emit('error', 'Grid size must be between 2 and 10');
                return;
            }
            if (playerCount < 2 || playerCount > 4) {
                socket.emit('error', 'Player count must be between 2 and 4');
                return;
            }
            
            const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
            const initialState = initializeGameState(gridSize, playerCount);
            
            const newGame = {
                id: gameId,
                gridSize,
                playerCount,
                players: {},
                gameState: initialState,
                createdAt: Date.now()
            };

            // Add player 1
            newGame.players.player1 = { 
                id: socket.id, 
                username: username.trim(), 
                avatar: avatar || '👦',
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
            log.debug('join_game event', { gameId, username, avatar, socketId: socket.id });
            
            if (!gameId || !username) {
                socket.emit('error', 'Game ID and username required');
                return;
            }

            const game = activeGames.get(gameId);
            
            if (!game) {
                log.warn('Game not found', { gameId });
                socket.emit('error', 'Game not found');
                return;
            }

            // Check if reconnecting
            for (let i = 1; i <= game.playerCount; i++) {
                const playerId = `player${i}`;
                const player = game.players[playerId];
                
                if (player && player.username === username.trim()) {
                    log.info('Player reconnecting', { gameId, playerId, username });
                    
                    // Update socket ID
                    player.id = socket.id;
                    if (avatar) player.avatar = avatar;
                    socket.join(gameId);
                    
                    const gameStateWithPlayers = buildGameStateWithPlayers(game);
                    socket.emit('game_started', {
                        gameId,
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
                const playerId = `player${i}`;
                if (!game.players[playerId]) {
                    assignedSlot = playerId;
                    break;
                }
            }

            if (!assignedSlot) {
                log.warn('Game is full', { gameId, username });
                socket.emit('error', 'Game is full');
                return;
            }

            log.info('New player joining', { gameId, playerId: assignedSlot, username });

            // Add new player
            game.players[assignedSlot] = {
                id: socket.id,
                username: username.trim(),
                avatar: avatar || '👦',
                color: PLAYER_COLORS[assignedSlot]
            };
            
            socket.join(gameId);

            // Build updated game state
            const gameStateWithPlayers = buildGameStateWithPlayers(game);
            
            // Notify all players
            io.to(gameId).emit('game_started', {
                gameId,
                gridSize: game.gridSize,
                playerCount: game.playerCount,
                players: getPlayersList(game),
                gameState: gameStateWithPlayers
            });

            // Check if game is ready to start
            const playersFilled = Object.keys(game.players).length;
            if (playersFilled === game.playerCount) {
                log.info('Game ready - all players joined', { gameId, playerCount: game.playerCount });
                io.to(gameId).emit('all_players_joined', { gameId });
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
     * Handle disconnect
     */
    socket.on('disconnect', () => {
        log.info('Client disconnected:', socket.id);
        // TODO: Handle player disconnect notifications
    });
});

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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        activeGames: activeGames.size,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
    log.info('Environment:', process.env.NODE_ENV || 'development');
    log.info('Log level:', LOG_LEVEL);
});
