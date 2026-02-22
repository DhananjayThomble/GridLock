// models/Leaderboard.js
const mongoose = require('mongoose');

const LeaderboardSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    totalWins: {
        type: Number,
        default: 0
    },
    totalLosses: {
        type: Number,
        default: 0
    },
    totalDraws: {
        type: Number,
        default: 0
    },
    rank: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('Leaderboard', LeaderboardSchema);
