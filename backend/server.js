// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { calculateNewState, initializeGameState } = require('./utils/gameLogic');

const app = express();
const server = http.createServer(app);

// Logging utility
const LOG_LEVEL = process.env.LOG_LEVEL || 'DEBUG'; // DEBUG, INFO, WARN, ERROR
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
        origin: "*", // Allow all origins for now
        methods: ["GET", "POST"]
    }
});

// In-memory game store (for MVP)
const activeGames = new Map();

io.on('connection', (socket) => {
    log.info('New client connected:', socket.id);

    // Create Game
    socket.on('create_game', ({ gridSize, username }, callback) => {
        log.debug('create_game event received', { gridSize, username, socketId: socket.id });
        
        const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const initialState = initializeGameState(gridSize);
        const newGame = {
            id: gameId,
            gridSize,
            players: {
                player1: { id: socket.id, username },
                player2: null
            },
            gameState: initialState
        };

        activeGames.set(gameId, newGame);
        socket.join(gameId);
        
        log.info(`Game created: ${gameId} by ${username}`, { gameId, username, socketId: socket.id });
        
        // Send initial game state to player 1 (waiting for player 2)
        const gameStateWithNames = {
            ...initialState,
            player1Name: username,
            player2Name: 'Waiting for player...'
        };
        
        socket.emit('game_started', {
            gameId,
            gridSize,
            players: {
                player1: username,
                player2: null
            },
            gameState: gameStateWithNames
        });
        
        log.debug('Initial game state sent to player 1', { gameId, gameState: gameStateWithNames });
        
        // Callback if provided (Ack)
        if (callback) {
            log.debug('Sending callback to client', { gameId, playerId: 'player1' });
            callback({ gameId, playerId: 'player1' });
        }
        
        // Also emit event for consistency
        socket.emit('game_created', { gameId, playerId: 'player1' });
        log.debug('game_created event emitted', { gameId, playerId: 'player1' });
    });

    // Join Game or Reconnect
    socket.on('join_game', ({ gameId, username }) => {
        log.debug('join_game event received', { gameId, username, socketId: socket.id });
        
        const game = activeGames.get(gameId);
        
        if (!game) {
            log.warn('Game not found', { gameId, username });
            socket.emit('error', 'Game not found');
            return;
        }

        log.debug('Game found', { 
            gameId, 
            player1: game.players.player1.username, 
            player2: game.players.player2 ? game.players.player2.username : null 
        });

        // Check if user is already Player 1
        if (game.players.player1.username === username) {
            log.info('Player 1 reconnecting', { gameId, username, socketId: socket.id });
            
            // Update socket ID in case of reconnect
            game.players.player1.id = socket.id;
            socket.join(gameId);
            
            // Add player names to game state
            const gameStateWithNames = {
                ...game.gameState,
                player1Name: game.players.player1.username,
                player2Name: game.players.player2 ? game.players.player2.username : 'Waiting...'
            };
            
            log.debug('Emitting game_started to player 1', { gameId, gameState: gameStateWithNames });
            
            socket.emit('game_started', { 
                gameId, 
                gridSize: game.gridSize,
                players: {
                    player1: game.players.player1.username,
                    player2: game.players.player2 ? game.players.player2.username : null
                },
                gameState: gameStateWithNames
            });
            return;
        }

        // Check if user is already Player 2
        if (game.players.player2 && game.players.player2.username === username) {
            log.info('Player 2 reconnecting', { gameId, username, socketId: socket.id });
            
            game.players.player2.id = socket.id;
            socket.join(gameId);
            
            // Add player names to game state
            const gameStateWithNames = {
                ...game.gameState,
                player1Name: game.players.player1.username,
                player2Name: game.players.player2.username
            };
            
            log.debug('Emitting game_started to player 2', { gameId, gameState: gameStateWithNames });
            
            socket.emit('game_started', { 
                gameId, 
                gridSize: game.gridSize,
                players: {
                    player1: game.players.player1.username,
                    player2: game.players.player2.username
                },
                gameState: gameStateWithNames
            });
            return;
        }

        // New Player 2 joining
        if (game.players.player2) {
            log.warn('Game is full', { gameId, username });
            socket.emit('error', 'Game is full');
            return;
        }

        log.info('Player 2 joining game', { gameId, username, socketId: socket.id });

        game.players.player2 = { id: socket.id, username };
        socket.join(gameId);
        
        // Add player names to game state
        const gameStateWithNames = {
            ...game.gameState,
            player1Name: game.players.player1.username,
            player2Name: game.players.player2.username
        };
        
        log.debug('Emitting game_started to both players', { gameId, gameState: gameStateWithNames });
        
        // Notify both players
        io.to(gameId).emit('game_started', { 
            gameId, 
            gridSize: game.gridSize,
            players: {
                player1: game.players.player1.username,
                player2: game.players.player2.username
            },
            gameState: gameStateWithNames
        });
        
        log.info(`User ${username} joined game ${gameId}. Game started!`);
    });

    // Make Move
    socket.on('make_move', ({ gameId, playerId, type, r, c }) => {
        log.debug('make_move event received', { gameId, playerId, type, r, c, socketId: socket.id });
        
        const game = activeGames.get(gameId);
        if (!game) {
            log.warn('Game not found for move', { gameId });
            return;
        }

        // Validate turn
        const currentTurn = game.gameState.currentPlayer; // 'player1' or 'player2'
        
        log.debug('Validating turn', { currentTurn, playerId, match: currentTurn === playerId });
        
        // Check if the requester is the current player
        // playerId should be 'player1' or 'player2' (sent from client)
        if (currentTurn !== playerId) {
            log.warn('Not player turn', { gameId, currentTurn, attemptedBy: playerId });
            socket.emit('error', 'Not your turn');
            return;
        }

        // Calculate new state
        try {
            const newState = calculateNewState(game.gameState, game.gridSize, r, c, type);
            
            if (newState.error) {
                log.warn('Invalid move', { gameId, error: newState.error, move: { type, r, c } });
                socket.emit('error', newState.error);
                return;
            }

            log.debug('Move successful, updating state', { gameId, newState });

            // Update game state
            game.gameState = newState;
            activeGames.set(gameId, game);

            // Add player names to game state for broadcast
            const gameStateWithNames = {
                ...newState,
                player1Name: game.players.player1.username,
                player2Name: game.players.player2 ? game.players.player2.username : 'Waiting...'
            };

            log.info('Broadcasting game_update', { gameId, currentPlayer: newState.currentPlayer, scores: newState.scores });

            // Broadcast update
            io.to(gameId).emit('game_update', {
                gameState: gameStateWithNames
            });

            if (newState.winner) {
                log.info('Game over', { gameId, winner: newState.winner });
                io.to(gameId).emit('game_over', { winner: newState.winner });
                activeGames.delete(gameId); // Cleanup
            }

        } catch (e) {
            log.error('Error processing move', { gameId, error: e.message, stack: e.stack });
            socket.emit('error', 'Invalid move');
        }
    });

    socket.on('disconnect', () => {
        log.info('Client disconnected:', socket.id);
        // Handle cleanup (optional: notify opponent)
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => log.info(`Server running on port ${PORT}`));
