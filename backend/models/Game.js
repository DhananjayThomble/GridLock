// backend/models/Game.js
// Persistent game storage for active and completed sessions

const mongoose = require('mongoose');

const PlayerSchema = new mongoose.Schema({
    id: { type: String, default: null },          // current socket id
    username: { type: String, required: true },
    avatar: { type: String, default: '👦' },
    color: { type: String, required: true },
    token: { type: String, required: true },      // auth token for reconnect/auth
    disconnectedAt: { type: Date, default: null },
}, { _id: false });

const GameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    gridSize: {
        type: Number,
        required: true,
        min: 2,
        max: 10,
    },
    playerCount: {
        type: Number,
        required: true,
        min: 2,
        max: 4,
    },

    // Flexible players object: { player1: {...}, player2: {...}, ... }
    players: {
        type: Map,
        of: PlayerSchema,
        default: {},
    },

    // Full game state blob (lines, boxes, scores, current player, etc.)
    gameState: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
    },

    status: {
        type: String,
        enum: ['waiting', 'playing', 'finished', 'abandoned'],
        default: 'waiting',
        index: true,
    },

    matchType: {
        type: String,
        enum: ['private', 'public'],
        default: 'private',
    },

    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    lastActivityAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    finishedAt: {
        type: Date,
        default: null,
    },

    metadata: {
        reason: { type: String, default: null },
        reconnectWindowMs: { type: Number, default: 60000 },
    },
}, {
    versionKey: false,
});

GameSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    if (!this.lastActivityAt) this.lastActivityAt = this.updatedAt;
    next();
});

module.exports = mongoose.model('Game', GameSchema);
