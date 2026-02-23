// models/Game.js
const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true
    },
    gridSize: {
        type: Number,
        default: 3
    },
    player1: {
        type: String, // Storing socketId or username
        default: null
    },
    player2: {
        type: String,
        default: null
    },
    gameState: {
        horizontalLines: { type: Array, default: [] },
        verticalLines: { type: Array, default: [] },
        boxes: { type: Array, default: [] },
        currentPlayer: { type: String, default: 'player1' },
        scores: { 
            player1: { type: Number, default: 0 },
            player2: { type: Number, default: 0 }
        },
        winner: { type: String, default: null }
    },
    status: {
        type: String, // 'waiting', 'playing', 'finished'
        default: 'waiting'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Game', GameSchema);
