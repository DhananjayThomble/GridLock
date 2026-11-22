const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Game = require('../models/Game');
const AdminAction = require('../models/AdminAction');
const { requireAuth } = require('../middleware/auth');
const adminRoutes = require('../routes/admin');

const app = express();
app.use(express.json(), cookieParser());
app.use('/admin', adminRoutes);
app.get('/signed-in', requireAuth, (_req, res) => res.sendStatus(204));

let database;
let operator;
let player;
const secret = 'gridlock-admin-test';
const cookie = user => `gridlock_token=${jwt.sign({ sub: String(user._id) }, secret)}`;
const moderate = body => request(app).post('/admin/moderation')
    .set('Cookie', cookie(operator)).set('X-Requested-With', 'XMLHttpRequest').send(body);

beforeAll(async () => {
    process.env.ADMIN_GOOGLE_IDS = 'operator-sub';
    process.env.JWT_SECRET = secret;
    database = await MongoMemoryServer.create();
    await mongoose.connect(database.getUri());
    [operator, player] = await User.create([
        { googleId: 'operator-sub', email: 'operator@example.com', displayName: 'Operator', username: 'operator' },
        { googleId: 'player-sub', email: 'player@example.com', displayName: 'Player', username: 'player' },
    ]);
});

afterAll(async () => {
    delete process.env.ADMIN_GOOGLE_IDS;
    delete process.env.JWT_SECRET;
    await mongoose.disconnect();
    await database?.stop();
});

test('only an allowlisted signed-in operator can read the console', async () => {
    await request(app).get('/admin/accounts').expect(401);
    await request(app).get('/admin/accounts').set('Cookie', cookie(player)).expect(403);
    const response = await request(app).get('/admin/accounts?search=player').set('Cookie', cookie(operator)).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ username: 'player', suspended: false });
    expect(response.body.items[0]).not.toHaveProperty('googleId');
});

test('requires CSRF and reason, protects operators, and applies audited suspension and restoration', async () => {
    const action = { kind: 'account', target: String(player._id), blocked: true, reason: 'Support review' };
    await request(app).post('/admin/moderation').set('Cookie', cookie(operator)).send(action).expect(403);
    await moderate({ ...action, reason: ' ' }).expect(400);
    await moderate({ ...action, target: String(operator._id) }).expect(403);
    await moderate(action).expect(201);
    await request(app).get('/signed-in').set('Cookie', cookie(player)).expect(403);
    await moderate({ ...action, blocked: false }).expect(201);
    await request(app).get('/signed-in').set('Cookie', cookie(player)).expect(204);
    const audit = await request(app).get('/admin/audit').set('Cookie', cookie(operator)).expect(200);
    expect(audit.body.items.map(item => item.blocked)).toEqual([false, true]);
});

test('room listing omits seat credentials and reflects chat moderation', async () => {
    await Game.collection.insertOne({
        gameId: 'TROOM1', gridSize: 3, playerCount: 2, status: 'playing', lastActivityAt: new Date(),
        players: { player1: { username: 'player', token: 'private-seat-token', id: 'private-socket' } },
        gameState: { scores: { player1: 1 } },
    });
    await moderate({ kind: 'room-chat', target: 'troom1', blocked: true, reason: 'Room review' }).expect(201);
    expect(await AdminAction.isBlocked('room-chat', 'TROOM1')).toBe(true);
    const response = await request(app).get('/admin/games?search=troom1&status=playing').set('Cookie', cookie(operator)).expect(200);
    expect(response.body.items[0]).toMatchObject({
        gameId: 'TROOM1', chatMuted: true, players: { player1: { username: 'player' } },
    });
    expect(response.body.items[0].players.player1).not.toHaveProperty('token');
    expect(response.body.items[0].players.player1).not.toHaveProperty('id');
});
