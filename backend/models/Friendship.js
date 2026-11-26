const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    _id: String, // Sorted pair of user IDs: one relationship per pair
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    requestedBy: mongoose.Schema.Types.ObjectId,
    accepted: { type: Boolean, default: false },
    invite: { to: mongoose.Schema.Types.ObjectId, gameId: String, expires: Date },
});

module.exports = mongoose.model('Friendship', schema);
