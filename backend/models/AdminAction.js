const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    actor: { type: String, required: true },
    kind: { type: String, enum: ['account', 'room-chat'], required: true },
    target: { type: String, required: true },
    label: { type: String, required: true },
    blocked: { type: Boolean, required: true },
    reason: { type: String, required: true, maxlength: 300 },
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ kind: 1, target: 1, _id: -1 });

// The audit entry is also the moderation decision, so one write does both jobs.
schema.statics.blockedTargets = async function (kind, targets) {
    if (targets.length === 0) return new Set();
    const states = await this.aggregate([
        { $match: { kind, target: { $in: targets } } },
        { $sort: { _id: -1 } },
        { $group: { _id: '$target', blocked: { $first: '$blocked' } } },
        { $match: { blocked: true } },
    ]);
    return new Set(states.map(state => state._id));
};

schema.statics.isBlocked = async function (kind, target) {
    const action = await this.findOne({ kind, target }).sort({ _id: -1 }).select('blocked').lean();
    return action?.blocked === true;
};

module.exports = mongoose.model('AdminAction', schema);
