const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, csrfHeader } = require('../middleware/auth');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { sendPushToUser } = require('../services/pushService');

const log = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.get('/', async (req, res) => {
    const me = String(req.user._id);
    const rows = await Friendship.find({ members: req.user._id }).populate('members', 'username').lean();
    res.set('Cache-Control', 'no-store').json(rows.flatMap(row => {
        const other = row.members.find(user => String(user._id) !== me);
        if (!other) return [];
        const invite = String(row.invite?.to) === me && row.invite.expires > new Date();
        return [{ id: other._id, name: other.username, status: row.accepted ? 'friend' :
            String(row.requestedBy) === me ? 'sent' : 'received', gameId: invite ? row.invite.gameId : null }];
    }));
});
router.use(csrfHeader, rateLimit({ windowMs: 60_000, limit: 30 }));
router.post('/', async (req, res) => {
    const name = req.body?.username;
    if (typeof name !== 'string' || !/^[\w-]{2,16}$/.test(name)) return res.status(400).json({ error: 'Enter a valid username.' });
    const other = await User.findOne({ username: name, usernameSetupComplete: true }).select('_id');
    if (!other || other._id.equals(req.user._id)) return res.status(400).json({ error: 'Choose another registered player.' });
    const members = [String(req.user._id), String(other._id)].sort();
    await Friendship.updateOne({ _id: members.join('-') }, { $setOnInsert: { members, requestedBy: req.user._id } }, { upsert: true });
    res.sendStatus(204);
});
router.param('id', (req, res, next, id) => {
    if (!/^[a-f0-9]{24}$/.test(id)) return res.sendStatus(400);
    req.pair = [String(req.user._id), id].sort().join('-');
    next();
});
router.post('/:id/accept', async (req, res) => {
    const result = await Friendship.updateOne({ _id: req.pair, requestedBy: req.params.id }, { accepted: true });
    res.sendStatus(result.matchedCount ? 204 : 404);
});
router.delete('/:id', async (req, res) => {
    await Friendship.deleteOne({ _id: req.pair });
    res.sendStatus(204);
});
router.post('/:id/invite', async (req, res) => {
    const { gameId, sessionToken } = req.body || {};
    if (typeof gameId !== 'string' || !/^[A-Z0-9]{4,8}$/.test(gameId) || typeof sessionToken !== 'string' || !sessionToken) return res.sendStatus(400);
    const room = await req.app.locals.gameStore.getGame(gameId);
    const players = Object.values(room?.players || {}).filter(Boolean);
    if (!room || room.gameState.gameOver || players.length >= room.playerCount ||
        !players.some(p => !p.isCPU && p.token === sessionToken)) return res.status(409).json({ error: 'Open a room with an available seat.' });
    const invite = { to: req.params.id, gameId, expires: new Date(Date.now() + 15 * 60_000) };
    const updated = await Friendship.updateOne({ _id: req.pair, accepted: true,
        $nor: [{ 'invite.to': req.params.id, 'invite.gameId': gameId, 'invite.expires': { $gt: new Date() } }]
    }, { $set: { invite } });
    if (!updated.matchedCount) return res.status(409).json({ error: 'Already invited or no longer friends.' });
    try {
        await sendPushToUser(req.params.id, {
            title: 'GridLock invitation',
            body: req.user.username + ' invited you to play Dots and Boxes.',
            url: '/join/' + gameId,
            tag: 'invite-' + gameId,
        }, { accountId: req.params.id });
    } catch (err) {
        // The invitation remains available in the lobby even if push delivery fails.
        log.warn('Could not dispatch friend invitation notification', { message: err.message });
    }
    res.sendStatus(204);
});
module.exports = router;
