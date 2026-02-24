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

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('MongoDB connected'))
.catch(err => console.log(err));

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
    console.log('New client connected:', socket.id);

    // Create Game
    socket.on('create_game', ({ gridSize, username }, callback) => {
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
        
        // Callback if provided (Ack)
        if (callback) callback({ gameId, playerId: 'player1' });
        
        // Also emit event for consistency
        socket.emit('game_created', { gameId, playerId: 'player1' });
        console.log(`Game created: ${gameId} by ${username}`);
    });

    // Join Game or Reconnect
    socket.on('join_game', ({ gameId, username }) => {
        const game = activeGames.get(gameId);
        
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }

        // Check if user is already Player 1
        if (game.players.player1.username === username) {
            // Update socket ID in case of reconnect
            game.players.player1.id = socket.id;
            socket.join(gameId);
            
            // Add player names to game state
            const gameStateWithNames = {
                ...game.gameState,
                player1Name: game.players.player1.username,
                player2Name: game.players.player2 ? game.players.player2.username : 'Waiting...'
            };
            
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
            game.players.player2.id = socket.id;
            socket.join(gameId);
            
            // Add player names to game state
            const gameStateWithNames = {
                ...game.gameState,
                player1Name: game.players.player1.username,
                player2Name: game.players.player2.username
            };
            
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
            socket.emit('error', 'Game is full');
            return;
        }

        game.players.player2 = { id: socket.id, username };
        socket.join(gameId);
        
        // Add player names to game state
        const gameStateWithNames = {
            ...game.gameState,
            player1Name: game.players.player1.username,
            player2Name: game.players.player2.username
        };
        
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
        
        console.log(`User ${username} joined game ${gameId}`);
    });

    // Make Move
    socket.on('make_move', ({ gameId, playerId, type, r, c }) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        // Validate turn
        const currentTurn = game.gameState.currentPlayer; // 'player1' or 'player2'
        
        // Check if the requester is the current player
        // playerId should be 'player1' or 'player2' (sent from client)
        if (currentTurn !== playerId) {
            socket.emit('error', 'Not your turn');
            return;
        }

        // Calculate new state
        try {
            const newState = calculateNewState(game.gameState, game.gridSize, r, c, type);
            
            if (newState.error) {
                socket.emit('error', newState.error);
                return;
            }

            // Update game state
            game.gameState = newState;
            activeGames.set(gameId, game);

            // Add player names to game state for broadcast
            const gameStateWithNames = {
                ...newState,
                player1Name: game.players.player1.username,
                player2Name: game.players.player2 ? game.players.player2.username : 'Waiting...'
            };

            // Broadcast update
            io.to(gameId).emit('game_update', {
                gameState: gameStateWithNames
            });

            if (newState.winner) {
                io.to(gameId).emit('game_over', { winner: newState.winner });
                activeGames.delete(gameId); // Cleanup
            }

        } catch (e) {
            console.error(e);
            socket.emit('error', 'Invalid move');
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        // Handle cleanup (optional: notify opponent)
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
