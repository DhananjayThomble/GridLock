const mongoose = require('mongoose');

const GameHistorySchema = new mongoose.Schema({
  gameId: { type: String, required: true, index: true },
  username: { type: String, required: true },
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
// Auto-delete old records after 90 days
GameHistorySchema.index({ playedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('GameHistory', GameHistorySchema);
