// models/DailyChallenge.js
// Schema for daily challenge configuration — one document per day
const mongoose = require('mongoose');

const DailyChallengeSchema = new mongoose.Schema(
  {
    date: {
      type: String, // YYYY-MM-DD format
      required: true,
      unique: true,
      index: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    seed: {
      type: String,
      required: true,
    },
    gridSize: {
      type: Number,
      default: 3,
      min: 2,
      max: 6,
    },
    dayNumber: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('DailyChallenge', DailyChallengeSchema);
