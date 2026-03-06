// Mock web-push before requiring pushService
jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
}));

// Mock PushSubscription model
jest.mock('../models/PushSubscription', () => {
    const mockFind = jest.fn();
    const mockDeleteOne = jest.fn();
    const mockFindOneAndUpdate = jest.fn();
    const Model = jest.fn();
    Model.find = mockFind;
    Model.deleteOne = mockDeleteOne;
    Model.findOneAndUpdate = mockFindOneAndUpdate;
    return Model;
});

// Set env vars before importing service
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_EMAIL = 'mailto:test@test.com';

const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const { sendPushToUser, isUserOnlineInGame, _internal } = require('../services/pushService');

beforeEach(() => {
    jest.clearAllMocks();
    _internal.lastPushTimestamps.clear();
});

describe('sendPushToUser', () => {
    test('sends push to all subscriptions for a user', async () => {
        const subs = [
            { endpoint: 'https://push.example/1', keys: { p256dh: 'key1', auth: 'auth1' } },
            { endpoint: 'https://push.example/2', keys: { p256dh: 'key2', auth: 'auth2' } },
        ];
        PushSubscription.find.mockResolvedValue(subs);
        webpush.sendNotification.mockResolvedValue({});

        const results = await sendPushToUser('alice', { title: 'Test', body: 'Hello' });

        expect(PushSubscription.find).toHaveBeenCalledWith({ username: 'alice' });
        expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
        expect(results).toHaveLength(2);
        expect(results[0].status).toBe('fulfilled');
    });

    test('returns early when no subscriptions found', async () => {
        PushSubscription.find.mockResolvedValue([]);

        const results = await sendPushToUser('nobody', { title: 'Test' });

        expect(results).toBeUndefined();
        expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    test('debounces pushes within 10 seconds', async () => {
        PushSubscription.find.mockResolvedValue([
            { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } },
        ]);
        webpush.sendNotification.mockResolvedValue({});

        await sendPushToUser('bob', { title: 'First' });
        expect(webpush.sendNotification).toHaveBeenCalledTimes(1);

        // Second call within debounce window should be skipped
        await sendPushToUser('bob', { title: 'Second' });
        expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    });

    test('allows push after debounce window expires', async () => {
        PushSubscription.find.mockResolvedValue([
            { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } },
        ]);
        webpush.sendNotification.mockResolvedValue({});

        // Set a past timestamp beyond debounce
        _internal.lastPushTimestamps.set('charlie', Date.now() - _internal.DEBOUNCE_MS - 1);

        await sendPushToUser('charlie', { title: 'Allowed' });
        expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    });

    test('deletes subscription on 410 Gone error', async () => {
        const sub = { endpoint: 'https://push.example/expired', keys: { p256dh: 'k', auth: 'a' } };
        PushSubscription.find.mockResolvedValue([sub]);
        PushSubscription.deleteOne.mockResolvedValue({});
        const error = new Error('Gone');
        error.statusCode = 410;
        webpush.sendNotification.mockRejectedValue(error);

        const results = await sendPushToUser('dave', { title: 'Test' });

        expect(PushSubscription.deleteOne).toHaveBeenCalledWith({ endpoint: sub.endpoint });
        expect(results[0].status).toBe('rejected');
    });

    test('deletes subscription on 404 error', async () => {
        const sub = { endpoint: 'https://push.example/gone', keys: { p256dh: 'k', auth: 'a' } };
        PushSubscription.find.mockResolvedValue([sub]);
        PushSubscription.deleteOne.mockResolvedValue({});
        const error = new Error('Not Found');
        error.statusCode = 404;
        webpush.sendNotification.mockRejectedValue(error);

        await sendPushToUser('eve', { title: 'Test' });

        expect(PushSubscription.deleteOne).toHaveBeenCalledWith({ endpoint: sub.endpoint });
    });
});

describe('isUserOnlineInGame', () => {
    function makeIo(roomSocketIds, socketDataMap) {
        return {
            sockets: {
                adapter: {
                    rooms: new Map([['GAME1', new Set(roomSocketIds)]]),
                },
                sockets: new Map(
                    roomSocketIds.map((id) => [id, { data: socketDataMap[id] || {} }])
                ),
            },
        };
    }

    test('returns true when user has active socket in room', () => {
        const game = {
            playerCount: 2,
            players: {
                player1: { id: 'sock1', username: 'alice', isCPU: false },
                player2: { id: 'sock2', username: 'bob', isCPU: false },
            },
        };
        const io = makeIo(['sock1', 'sock2'], {
            sock1: { playerId: 'player1' },
            sock2: { playerId: 'player2' },
        });

        expect(isUserOnlineInGame(io, 'alice', 'GAME1', game)).toBe(true);
        expect(isUserOnlineInGame(io, 'bob', 'GAME1', game)).toBe(true);
    });

    test('returns false when user socket is not in room', () => {
        const game = {
            playerCount: 2,
            players: {
                player1: { id: 'sock1', username: 'alice', isCPU: false },
                player2: { id: 'sock-old', username: 'bob', isCPU: false },
            },
        };
        const io = makeIo(['sock1'], {
            sock1: { playerId: 'player1' },
        });

        expect(isUserOnlineInGame(io, 'bob', 'GAME1', game)).toBe(false);
    });

    test('returns false when room does not exist', () => {
        const game = {
            playerCount: 2,
            players: {
                player1: { id: 'sock1', username: 'alice', isCPU: false },
            },
        };
        const io = makeIo([], {});
        io.sockets.adapter.rooms = new Map();

        expect(isUserOnlineInGame(io, 'alice', 'GAME1', game)).toBe(false);
    });

    test('returns false for null/missing arguments', () => {
        expect(isUserOnlineInGame(null, 'alice', 'GAME1', {})).toBe(false);
        expect(isUserOnlineInGame({}, 'alice', null, {})).toBe(false);
        expect(isUserOnlineInGame({}, 'alice', 'GAME1', null)).toBe(false);
    });
});
