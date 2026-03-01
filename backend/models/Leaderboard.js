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
        timestamps: true, // adds createdAt and updatedAt
    }
);

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
 * Same recalculation for findOneAndUpdate operations.
 */
LeaderboardSchema.pre('findOneAndUpdate', function (next) {
    const update = this.getUpdate();
    const inc = update.$inc || {};
    const set = update.$set || {};

    // We'll recalculate winRate in the route after the update, using the returned doc.
    // This hook is a no-op placeholder kept for future middleware expansion.
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
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - currentElo) / 400));
    const newElo = Math.round(currentElo + kFactor * (score - expectedScore));
    return Math.max(0, newElo); // ELO floor at 0
};

module.exports = mongoose.model('Leaderboard', LeaderboardSchema);
