const mongoose = require('mongoose');

const GameHistorySchema = new mongoose.Schema({
  gameId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
    sparse: true,
  },
  opponents: [String],
  playerCount: { type: Number, required: true },
  gridSize: { type: Number, required: true },
  result: { type: String, enum: ['win', 'loss', 'draw'], required: true },
  scores: {
    player: { type: Number, default: 0 },
    opponent: { type: Number, default: 0 },
  },
  eloBefore: { type: Number },
  eloAfter: { type: Number },
  duration: { type: Number },
  playedAt: { type: Date, default: Date.now },
});

GameHistorySchema.index({ username: 1, playedAt: -1 });

// Recommended compound indexes for filtered queries at scale:
//   { username: 1, result: 1, playedAt: -1 }
//   { username: 1, playerCount: 1, playedAt: -1 }
//   { username: 1, gridSize: 1, playedAt: -1 }
// Currently the { username, playedAt } index handles sorting but filter fields
// require in-memory filtering. Add these when query volume justifies the write overhead.

// Auto-delete old records after 90 days
GameHistorySchema.index({ playedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('GameHistory', GameHistorySchema);
