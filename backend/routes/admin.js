const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, csrfHeader } = require('../middleware/auth');
const AdminAction = require('../models/AdminAction');
const User = require('../models/User');
const Game = require('../models/Game');
const DailyResult = require('../models/DailyResult');
const RankedProfile = require('../models/RankedProfile');
const GameHistory = require('../models/GameHistory');
const { getTodayDateStr } = require('../utils/dailyHelpers');
const { gameCount } = require('../stores/gameStore');
const { sanitizeGameId } = require('../utils/sanitize');

const router = express.Router();
const PAGE_SIZE = 25;
const GAME_STATUSES = ['waiting', 'playing', 'finished', 'abandoned'];
const userFields = 'googleId username displayName email createdAt lastLoginAt';
const gameFields = [
    'gameId status gridSize playerCount matchType createdAt lastActivityAt finishedAt metadata.reason',
    'gameState.scores gameState.winner',
    ...['player1', 'player2', 'player3', 'player4'].map(seat => `players.${seat}.username players.${seat}.disconnectedAt`),
].join(' ');

function isOperator(user) {
    return Boolean(user.googleId) && (process.env.ADMIN_GOOGLE_IDS || '')
        .split(',').some(id => id.trim() === user.googleId);
}

function pageNumber(query) {
    const page = Number(query.page);
    return Number.isInteger(page) && page > 0 && page <= 1000 ? page : 1;
}

async function paginate(query, page, sort) {
    const rows = await query.sort(sort).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE + 1).lean();
    return { items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE && page < 1000 };
}

router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});
router.use(requireAuth, (req, res, next) => {
    if (!isOperator(req.user)) return res.status(403).json({ error: 'Admin access required' });
    next();
});

router.get('/overview', async (req, res) => {
    const [accounts, rankedPlayers, dailyResults, finishedToday, activeStoreEntries] = await Promise.all([
        User.estimatedDocumentCount(),
        RankedProfile.estimatedDocumentCount(),
        DailyResult.countDocuments({ date: getTodayDateStr() }),
        Game.countDocuments({ status: 'finished', finishedAt: { $gte: new Date(getTodayDateStr()) } }),
        gameCount(),
    ]);
    res.json({
        operator: req.user.username,
        accounts, rankedPlayers, dailyResults, finishedToday, activeStoreEntries,
        connectedSockets: req.app.locals.io?.engine?.clientsCount ?? null,
        uptimeSeconds: Math.round(process.uptime()),
    });
});

router.get('/accounts', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search.length > 254) return res.status(400).json({ error: 'Search is too long' });
    const filter = search ? { $or: [{ username: search }, { email: search.toLowerCase() }] } : {};
    const result = await paginate(User.find(filter).select(userFields), pageNumber(req.query), { createdAt: -1, _id: -1 });
    const blocked = await AdminAction.blockedTargets('account', result.items.map(user => String(user._id)));
    result.items = result.items.map(({ googleId, ...user }) => ({
        ...user, operator: isOperator({ googleId }), suspended: blocked.has(String(user._id)),
    }));
    res.json(result);
});

router.get('/accounts/:id/history', async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ error: 'Account not found' });
    const user = await User.findById(req.params.id).select('username').lean();
    if (!user) return res.status(404).json({ error: 'Account not found' });
    const [matches, ranked] = await Promise.all([
        GameHistory.find({ username: user.username }).sort({ playedAt: -1 }).limit(10)
            .select('gameId playedAt result opponents scores').lean(),
        RankedProfile.findOne({ username: user.username }).select('elo wins losses draws').lean(),
    ]);
    res.json({ matches, ranked });
});

router.get('/games', async (req, res) => {
    const filter = {};
    if (req.query.status) {
        if (!GAME_STATUSES.includes(req.query.status)) return res.status(400).json({ error: 'Invalid game status' });
        filter.status = { $eq: req.query.status };
    }
    if (req.query.search) {
        const id = sanitizeGameId(req.query.search);
        if (!id.valid) return res.status(400).json({ error: id.error });
        filter.gameId = { $eq: id.value };
    }
    const result = await paginate(Game.find(filter).select(gameFields), pageNumber(req.query), { lastActivityAt: -1, _id: -1 });
    const blocked = await AdminAction.blockedTargets('room-chat', result.items.map(game => game.gameId));
    result.items = result.items.map(game => ({ ...game, chatMuted: blocked.has(game.gameId) }));
    res.json(result);
});

router.get('/audit', async (req, res) => {
    res.json(await paginate(AdminAction.find(), pageNumber(req.query), { _id: -1 }));
});

router.post('/moderation', csrfHeader, async (req, res) => {
    const { kind, target, blocked, reason } = req.body || {};
    if (!['account', 'room-chat'].includes(kind) || typeof target !== 'string'
        || typeof blocked !== 'boolean' || typeof reason !== 'string'
        || !reason.trim() || reason.trim().length > 300) {
        return res.status(400).json({ error: 'A valid target, action, and reason (1–300 characters) are required' });
    }
    let id;
    let label;
    if (kind === 'account') {
        if (!mongoose.isObjectIdOrHexString(target)) return res.status(404).json({ error: 'Account not found' });
        const user = await User.findById(target).select('username googleId').lean();
        if (!user) return res.status(404).json({ error: 'Account not found' });
        if (isOperator(user)) return res.status(403).json({ error: 'Operator accounts are managed through the server allowlist' });
        id = String(user._id);
        label = user.username;
    } else {
        const gameId = sanitizeGameId(target);
        if (!gameId.valid) return res.status(400).json({ error: gameId.error });
        const exists = await Game.exists({ gameId: gameId.value, status: { $in: ['waiting', 'playing'] } });
        if (!exists) return res.status(404).json({ error: 'Active room not found' });
        id = gameId.value;
        label = id;
    }
    const action = await AdminAction.create({
        actor: req.user.username, kind, target: id, label, blocked, reason: reason.trim(),
    });
    res.status(201).json({ action });
});

module.exports = router;
