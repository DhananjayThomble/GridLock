// models/DailyResult.js
// Schema for individual player results in a daily challenge
const mongoose = require('mongoose');

const DailyResultSchema = new mongoose.Schema(
  {
    date: {
      type: String, // YYYY-MM-DD format
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
      sparse: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
    },
    moves: {
      type: Number,
      required: true,
      min: 0,
    },
    duration: {
      type: Number, // seconds
      required: true,
      min: 0,
    },
    completedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index — one attempt per user per day
DailyResultSchema.index({ date: 1, username: 1 }, { unique: true });

// Compound unique index — one attempt per userId per day (authenticated users)
// partialFilterExpression ensures only docs with non-null userId are indexed
DailyResultSchema.index(
  { date: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } }
);

// Leaderboard sorting: higher score first, fewer moves as tiebreaker, then duration
DailyResultSchema.index({ date: 1, score: -1, moves: 1, duration: 1 });

module.exports = mongoose.model('DailyResult', DailyResultSchema);
