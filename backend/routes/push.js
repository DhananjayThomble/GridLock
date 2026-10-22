const express = require('express');
const rateLimit = require('express-rate-limit');
const PushSubscription = require('../models/PushSubscription');
const { sanitizeUsername } = require('../utils/sanitize');
const log = require('../utils/logger');

const router = express.Router();

// Fix #6/#7: Rate limiter for subscribe/unsubscribe endpoints
const pushEndpointLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,                   // 20 requests per IP per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

// Fix #8: Shared unsubscribe handler — extracted to avoid duplication
async function handleUnsubscribe(req, res) {
    try {
        const { endpoint } = req.body;
        if (!endpoint || typeof endpoint !== 'string') {
            return res.status(400).json({ error: 'Missing endpoint' });
        }

        await PushSubscription.deleteOne({ endpoint: { $eq: endpoint } });
        res.json({ message: 'Subscription removed' });
    } catch (err) {
        log.error('[PUSH] Unsubscribe error:', err.message);
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
}

// GET /api/push/vapid-public-key — return VAPID public key for frontend subscription
router.get('/vapid-public-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
        return res.status(503).json({ error: 'Push notifications not configured' });
    }
    res.json({ publicKey: key });
});

// POST /api/push/subscribe — upsert subscription by endpoint
// Fix #6: Rate limited + basic socket-based ownership validation
router.post('/subscribe', pushEndpointLimiter, async (req, res) => {
    try {
        const { username, subscription, socketId } = req.body;
        if (!username || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        // Reject non-string credential fields to prevent NoSQL operator injection
        if (
            typeof subscription.endpoint !== 'string' ||
            typeof subscription.keys.p256dh !== 'string' ||
            typeof subscription.keys.auth !== 'string'
        ) {
            return res.status(400).json({ error: 'Invalid subscription fields' });
        }

        const san = sanitizeUsername(username);
        if (!san.valid) return res.status(400).json({ error: 'Invalid username' });
        const cleanUsername = san.value;

        // Fix #6: Verify socket ownership if io is available
        if (req.app.locals.io && socketId) {
            const connectedSocket = req.app.locals.io.sockets.sockets.get(socketId);
            if (!connectedSocket) {
                return res.status(403).json({ error: 'Invalid socket ID — not connected' });
            }
            // Verify the socket's identity matches the claimed username
            if (connectedSocket.data.username && connectedSocket.data.username !== cleanUsername) {
                return res.status(403).json({ error: 'Socket identity mismatch' });
            }
        } else if (req.app.locals.io && !socketId) {
            // io is available but no socketId provided — reject
            return res.status(400).json({ error: 'socketId is required for subscription verification' });
        }

        await PushSubscription.findOneAndUpdate(
            { endpoint: { $eq: subscription.endpoint } },
            {
                username: cleanUsername,
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
        log.error('[PUSH] Subscribe error:', err.message);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// POST /api/push/unsubscribe — remove subscription by endpoint
// Fix #7: Rate limited + Fix #8: shared handler
router.post('/unsubscribe', pushEndpointLimiter, handleUnsubscribe);

// DELETE /api/push/unsubscribe — backwards-compatible alias
// Fix #7: Rate limited + Fix #8: shared handler
router.delete('/unsubscribe', pushEndpointLimiter, handleUnsubscribe);

module.exports = router;
