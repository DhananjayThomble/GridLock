const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
    username: { type: String, required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true },
    },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
