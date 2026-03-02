// models/Leaderboard.js
const mongoose = require('mongoose');

const LeaderboardSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        gamesPlayed: {
            type: Number,
            default: 0,
            min: 0,
        },
        wins: {
            type: Number,
            default: 0,
            min: 0,
        },
        losses: {
            type: Number,
            default: 0,
            min: 0,
        },
        draws: {
            type: Number,
            default: 0,
            min: 0,
        },
        winRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        bestStreak: {
            type: Number,
            default: 0,
            min: 0,
        },
        currentStreak: {
            type: Number,
            default: 0,
            min: 0,
        },
        elo: {
            type: Number,
            default: 1000,
            min: 0,
        },
        lastPlayedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Support leaderboard sorting at scale.
LeaderboardSchema.index({ wins: -1, winRate: -1, elo: -1 });

/**
 * Compute winRate before saving (wins / gamesPlayed * 100, rounded to 2dp).
 */
LeaderboardSchema.pre('save', function (next) {
    if (this.gamesPlayed > 0) {
        this.winRate = parseFloat(((this.wins / this.gamesPlayed) * 100).toFixed(2));
    } else {
        this.winRate = 0;
    }
    next();
});

/**
 * Calculate new ELO rating.
 * @param {number} currentElo - Current player ELO
 * @param {number} opponentElo - Opponent ELO (average for multi-player)
 * @param {number} score - 1 for win, 0.5 for draw, 0 for loss
 * @param {number} kFactor - K-factor (default 32)
 * @returns {number} New ELO rating
 */
LeaderboardSchema.statics.calculateElo = function (currentElo, opponentElo, score, kFactor = 32) {
    const safeCurrent = Number.isFinite(currentElo) ? currentElo : 1000;
    const safeOpponent = Number.isFinite(opponentElo) && opponentElo >= 0 ? opponentElo : 1000;
    const expectedScore = 1 / (1 + Math.pow(10, (safeOpponent - safeCurrent) / 400));
    const newElo = Math.round(safeCurrent + kFactor * (score - expectedScore));
    return Math.max(0, newElo);
};

module.exports = mongoose.model('Leaderboard', LeaderboardSchema);
