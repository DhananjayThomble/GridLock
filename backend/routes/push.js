const express = require('express');
const PushSubscription = require('../models/PushSubscription');

const router = express.Router();

// POST /api/push/subscribe — upsert subscription by endpoint
router.post('/subscribe', async (req, res) => {
    try {
        const { username, subscription } = req.body;
        if (!username || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await PushSubscription.findOneAndUpdate(
            { endpoint: subscription.endpoint },
            {
                username,
                endpoint: subscription.endpoint,
                keys: {
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth,
                },
            },
            { upsert: true, new: true }
        );

        res.status(201).json({ message: 'Subscription saved' });
    } catch (err) {
        console.error('[PUSH] Subscribe error:', err.message);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// DELETE /api/push/unsubscribe — remove subscription by endpoint
router.delete('/unsubscribe', async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ error: 'Missing endpoint' });
        }

        await PushSubscription.deleteOne({ endpoint });
        res.json({ message: 'Subscription removed' });
    } catch (err) {
        console.error('[PUSH] Unsubscribe error:', err.message);
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
});

module.exports = router;
