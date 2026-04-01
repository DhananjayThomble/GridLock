// backend/__tests__/sessionConflict.test.js
// Tests for multi-tab session conflict detection (#478)

// Mock the Game model before any requires (shared.js imports it at module level)
jest.mock('../models/Game', () => ({
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    findOne: jest.fn().mockResolvedValue(null),
}));

jest.mock('../models/DailyResult', () => ({
    findOne: jest.fn().mockResolvedValue(null),
}));

jest.mock('../models/Leaderboard', () => ({
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    findOne: jest.fn().mockResolvedValue(null),
}));

jest.mock('../models/RankedProfile', () => {
    function RankedProfile() {}
    RankedProfile.findOne = jest.fn().mockResolvedValue(null);
    RankedProfile.findOneAndUpdate = jest.fn().mockResolvedValue(null);
    return RankedProfile;
});

jest.mock('../models/GameHistory', () => ({
    create: jest.fn().mockResolvedValue(null),
}));

jest.mock('../models/PushSubscription', () => {
    function PushSubscription() {}
    PushSubscription.find = jest.fn().mockResolvedValue([]);
    return PushSubscription;
});

jest.mock('../stores/redisClient', () => ({
    getRedisClient: jest.fn().mockResolvedValue(null),
}));

const { gameStore, localTimers, generateSessionToken } = require('../controllers/handlers/shared');
const { register } = require('../controllers/handlers/gameHandler');

const createdGames = [];

// ── Helpers ─────────────────────────────────────────────────────────────────────

function createMockSocket(id) {
    const listeners = {};
    const rooms = new Set();
    return {
        id,
        connected: true,
        data: {},
        rooms,
        emit: jest.fn(),
        join: jest.fn((room) => rooms.add(room)),
        leave: jest.fn((room) => rooms.delete(room)),
        to: jest.fn(() => ({ emit: jest.fn() })),
        on: jest.fn((event, handler) => {
            listeners[event] = handler;
        }),
        off: jest.fn(),
        disconnect: jest.fn(function () { this.connected = false; }),
        _listeners: listeners,
        _trigger(event, payload) {
            if (listeners[event]) return listeners[event](payload);
        },
    };
}

function createMockIO(sockets = {}) {
    return {
        sockets: {
            sockets: new Map(Object.entries(sockets)),
        },
        to: jest.fn(() => ({ emit: jest.fn() })),
    };
}

const mockLog = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const rateLimited = jest.fn(() => false);
const validate = jest.fn((event, payload) => payload);

async function createTestGame(gameId, playerData = {}) {
    const token = playerData.token || generateSessionToken();
    const game = {
        id: gameId,
        gridSize: 3,
        playerCount: 2,
        players: {
            player1: {
                id: playerData.socketId || 'old-socket-id',
                username: playerData.username || 'TestUser',
                avatar: '👦',
                color: '#FF6B6B',
                token,
                disconnectedAt: playerData.disconnectedAt || null,
            },
        },
        gameState: {
            currentPlayer: 'player1',
            players: ['player1', 'player2'],
            scores: { player1: 0, player2: 0 },
            horizontalLines: [[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
            verticalLines: [[0,0,0,0],[0,0,0,0],[0,0,0,0]],
            boxes: [[null,null,null],[null,null,null],[null,null,null]],
            winner: null,
            playerCount: 2,
        },
        createdAt: Date.now(),
        metadata: { reconnectWindowMs: 60000 },
    };
    await gameStore.setGame(gameId, game);
    createdGames.push(gameId);
    return { game, token };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    localTimers.clear();
});

afterEach(async () => {
    for (const gid of createdGames) {
        await gameStore.deleteGame(gid);
    }
    createdGames.length = 0;
    jest.useRealTimers();
});

describe('Session Conflict Detection (#478)', () => {

    test('two sockets join same game with same username+token → first gets session_conflict', async () => {
        const gameId = 'CNFL01';
        const oldSocket = createMockSocket('old-sock-1');
        oldSocket.connected = true;

        const { token } = await createTestGame(gameId, {
            socketId: 'old-sock-1',
            username: 'Alice',
        });

        const io = createMockIO({ 'old-sock-1': oldSocket });
        const newSocket = createMockSocket('new-sock-2');

        register(io, newSocket, mockLog, rateLimited, validate);

        await newSocket._trigger('join_game', {
            gameId,
            username: 'Alice',
            avatar: '👦',
            sessionToken: token,
        });

        // Old socket should have received session_conflict
        expect(oldSocket.emit).toHaveBeenCalledWith('session_conflict', expect.objectContaining({
            reason: expect.any(String),
            gameId,
            playerId: 'player1',
        }));

        // Old socket's data should be cleared
        expect(oldSocket.data.gameId).toBeUndefined();
        expect(oldSocket.data.playerId).toBeUndefined();

        // Old socket should have left the room
        expect(oldSocket.leave).toHaveBeenCalledWith(gameId);

        // After 100ms delay, old socket should be disconnected
        jest.advanceTimersByTime(150);
        expect(oldSocket.disconnect).toHaveBeenCalledWith(true);

        // New socket should have joined successfully
        expect(newSocket.join).toHaveBeenCalledWith(gameId);
        expect(newSocket.emit).toHaveBeenCalledWith('game_started', expect.objectContaining({
            gameId,
            playerId: 'player1',
        }));

        // Game store should have the new socket ID
        const game = await gameStore.getGame(gameId);
        expect(game.players.player1.id).toBe('new-sock-2');
    });

    test('old socket data cleared → disconnect does not trigger forfeit', async () => {
        const gameId = 'CNFL02';
        const oldSocket = createMockSocket('old-sock-3');
        oldSocket.connected = true;

        const { token } = await createTestGame(gameId, {
            socketId: 'old-sock-3',
            username: 'Bob',
        });

        const io = createMockIO({ 'old-sock-3': oldSocket });
        const newSocket = createMockSocket('new-sock-4');

        register(io, newSocket, mockLog, rateLimited, validate);

        await newSocket._trigger('join_game', {
            gameId,
            username: 'Bob',
            avatar: '👦',
            sessionToken: token,
        });

        // Old socket's game data is cleared BEFORE disconnect
        // When disconnect handler fires, socket.data.gameId is undefined → no forfeit
        expect(oldSocket.data.gameId).toBeUndefined();
        expect(oldSocket.data.playerId).toBeUndefined();
    });

    test('genuine reconnect (old socket already dead) → no false session_conflict', async () => {
        const gameId = 'RCNT01';
        const oldSocket = createMockSocket('dead-sock-5');
        oldSocket.connected = false;

        const { token } = await createTestGame(gameId, {
            socketId: 'dead-sock-5',
            username: 'Charlie',
            disconnectedAt: Date.now() - 5000,
        });

        const io = createMockIO({ 'dead-sock-5': oldSocket });
        const newSocket = createMockSocket('new-sock-6');

        register(io, newSocket, mockLog, rateLimited, validate);

        await newSocket._trigger('join_game', {
            gameId,
            username: 'Charlie',
            avatar: '👦',
            sessionToken: token,
        });

        // Old socket should NOT have received session_conflict
        expect(oldSocket.emit).not.toHaveBeenCalledWith('session_conflict', expect.anything());

        // New socket should join successfully
        expect(newSocket.join).toHaveBeenCalledWith(gameId);
        expect(newSocket.emit).toHaveBeenCalledWith('game_started', expect.objectContaining({
            gameId,
            playerId: 'player1',
        }));
    });

    test('genuine reconnect when old socket not in io.sockets map → no false session_conflict', async () => {
        const gameId = 'RCNT02';

        const { token } = await createTestGame(gameId, {
            socketId: 'gone-sock-7',
            username: 'Diana',
            disconnectedAt: Date.now() - 10000,
        });

        // Old socket doesn't exist in io.sockets.sockets at all
        const io = createMockIO({});
        const newSocket = createMockSocket('new-sock-8');

        register(io, newSocket, mockLog, rateLimited, validate);

        await newSocket._trigger('join_game', {
            gameId,
            username: 'Diana',
            avatar: '👦',
            sessionToken: token,
        });

        // Should succeed without any session_conflict
        expect(newSocket.join).toHaveBeenCalledWith(gameId);
        expect(newSocket.emit).toHaveBeenCalledWith('game_started', expect.objectContaining({
            gameId,
            playerId: 'player1',
        }));
    });

    test('invalid token still rejected (security)', async () => {
        const gameId = 'SECU01';

        await createTestGame(gameId, {
            socketId: 'old-sock-9',
            username: 'Eve',
        });

        const io = createMockIO({});
        const newSocket = createMockSocket('attacker-sock');

        register(io, newSocket, mockLog, rateLimited, validate);

        await newSocket._trigger('join_game', {
            gameId,
            username: 'Eve',
            avatar: '👦',
            sessionToken: 'wrong-token-attempt',
        });

        // Should emit error, not game_started
        expect(newSocket.emit).toHaveBeenCalledWith('error', 'Invalid session token for this username');
        expect(newSocket.join).not.toHaveBeenCalled();
    });

    test('different username same game → no conflict', async () => {
        const gameId = 'NCFL01';
        const existingSocket = createMockSocket('existing-sock-10');
        existingSocket.connected = true;

        await createTestGame(gameId, {
            socketId: 'existing-sock-10',
            username: 'Frank',
        });

        const io = createMockIO({ 'existing-sock-10': existingSocket });
        const newSocket = createMockSocket('new-sock-11');

        register(io, newSocket, mockLog, rateLimited, validate);

        // A different user joins the same game as a new player
        await newSocket._trigger('join_game', {
            gameId,
            username: 'Grace',
            avatar: '👧',
        });

        // Frank's socket should NOT have received session_conflict
        expect(existingSocket.emit).not.toHaveBeenCalledWith('session_conflict', expect.anything());

        // Grace should have been assigned player2
        expect(newSocket.join).toHaveBeenCalledWith(gameId);
        expect(newSocket.emit).toHaveBeenCalledWith('game_started', expect.objectContaining({
            gameId,
            playerId: 'player2',
        }));
    });

});
