const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
jest.mock('../services/pushService', () => ({ sendPushToUser: jest.fn().mockResolvedValue([]) }));
const { sendPushToUser } = require('../services/pushService');
const app = express();
app.use(express.json(), cookieParser());
app.use('/friends', require('../routes/friends'));
app.locals.gameStore = { getGame: async () => ({ players: { player1: { token: 'seat' } }, playerCount: 2, gameState: {} }) };

let mongo, alice, bob;
let previousSecret;
beforeAll(async () => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'local-friend-test';
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    [alice, bob] = await Promise.all(['Alice', 'Bob'].map(username => User.create({
        username, displayName: username, googleId: username, email: username + '@example.test', usernameSetupComplete: true,
    })));
});
afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
});
function post(user, path, body) {
    return request(app).post('/friends' + path)
        .set('Cookie', 'gridlock_token=' + jwt.sign({ sub: user.id }, process.env.JWT_SECRET))
        .set('X-Requested-With', 'XMLHttpRequest').send(body);
}
test('only accepted friends receive invitations from a player holding a room seat', async () => {
    const room = { gameId: 'ABC123', sessionToken: 'seat' };
    const invite = '/' + bob.id + '/invite';
    await post(alice, '', { username: bob.username }).expect(204);
    await post(alice, '/' + bob.id + '/accept').expect(404);
    await post(alice, invite, room).expect(409);
    await post(bob, '/' + alice.id + '/accept').expect(204);
    await post(alice, invite, { ...room, sessionToken: 'other' }).expect(409);
    await post(alice, invite, room).expect(204);
    await post(alice, invite, room).expect(409);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith(bob.id, expect.objectContaining({ url: '/join/ABC123' }), { accountId: bob.id });
    expect((await Friendship.findOne()).invite.to.toString()).toBe(bob.id);
});
