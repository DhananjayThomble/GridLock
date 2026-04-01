/**
 * Socket Stability Wave 2 Tests
 * Covers: #479 (transport upgrade — frontend-only, not tested here),
 *         #482 (Cloudflare ping tuning),
 *         #483 (username collision on rejoin),
 *         #480 (stale rejoin banner — validate_rejoin handler)
 */

// ── Mock shared.js BEFORE requiring handler ──────────────────────
const mockGameStore = {
    getGame: jest.fn(),
    setGame: jest.fn().mockResolvedValue(undefined),
    deleteGame: jest.fn().mockResolvedValue(undefined),
    deleteSpectatorCount: jest.fn().mockResolvedValue(undefined),
};

const mockDisconnectStore = {
    getAllDisconnects: jest.fn(),
    isDisconnected: jest.fn(),
    clearDisconnect: jest.fn().mockResolvedValue(undefined),
    setDisconnect: jest.fn().mockResolvedValue(undefined),
    getDisconnectInfo: jest.fn(),
    storeCount: jest.fn(),
};

const mockRematchStore = {
    clearVotes: jest.fn().mockResolvedValue(undefined),
    removeVote: jest.fn().mockResolvedValue(undefined),
};

const mockLocalTimers = new Map();
const mockRematchTimers = new Map();
const mockHostStartTimers = new Map();

jest.mock('../controllers/handlers/shared', () => {
    const actual = jest.requireActual('../controllers/handlers/shared');
    return {
        ...actual,
        gameStore: mockGameStore,
        disconnectStore: mockDisconnectStore,
        rematchStore: mockRematchStore,
        localTimers: mockLocalTimers,
        rematchTimers: mockRematchTimers,
        hostStartTimers: mockHostStartTimers,
        persistGame: jest.fn().mockResolvedValue(undefined),
        updateLeaderboard: jest.fn(),
        recordGameHistory: jest.fn(),
        markGameFinished: jest.fn().mockResolvedValue(undefined),
        startPostgameTimer: jest.fn(),
        startLobbyTimer: jest.fn(),
        cancelLobbyTimer: jest.fn(),
        cancelPostgameTimer: jest.fn(),
        promMetrics: null,
    };
});

jest.mock('../stores/disconnectStore', () => mockDisconnectStore);
jest.mock('../stores/gameStore', () => mockGameStore);
jest.mock('../stores/rematchStore', () => mockRematchStore);

// Mock models to avoid needing real mongoose connection
jest.mock('../models/Game', () => ({}));
jest.mock('../models/DailyResult', () => ({ findOne: jest.fn() }));
jest.mock('../models/DailyChallenge', () => ({ findOne: jest.fn() }));
jest.mock('../models/RankedProfile', () => ({
    findOne: jest.fn(),
    calculateRankedElo: jest.fn(),
    calculateRankedEloExchange: jest.fn(),
    calculateRankedDrawExchange: jest.fn(),
    getTierFromElo: jest.fn(),
    PLACEMENT_GAMES_REQUIRED: 10,
    COOLDOWN_DURATION_MS: 0,
}));
jest.mock('../models/Leaderboard', () => ({}));
jest.mock('../models/GameHistory', () => ({ create: jest.fn() }));
jest.mock('../services/leaderboardUpdateService', () => ({
    updateLeaderboardWithOptimisticElo: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/pushService', () => ({
    sendPushToUser: jest.fn(),
    isUserOnlineInGame: jest.fn().mockReturnValue(false),
}));
jest.mock('../services/cpuPlayer', () => ({
    chooseCPUMove: jest.fn(),
    CPU_NAMES: {},
    CPU_AVATARS: {},
    CPU_DELAYS: { easy: 500, medium: 300, hard: 100 },
}));
jest.mock('../services/matchmaking', () => ({
    removeFromQueue: jest.fn(),
    QUEUE_TIMEOUT_MS: 30000,
}));

const { register } = require('../controllers/handlers/gameHandler');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockSocket() {
    const handlers = {};
    return {
        id: 'test-socket-' + Math.random().toString(36).slice(2, 8),
        data: {},
        on: jest.fn((event, handler) => { handlers[event] = handler; }),
        emit: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        to: jest.fn().mockReturnThis(),
        _handlers: handlers,
    };
}

function makeMockIo() {
    const socketMap = new Map();
    return {
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
        sockets: {
            adapter: { rooms: new Map() },
            sockets: socketMap,
        },
        _socketMap: socketMap,
    };
}

function makeMockLog() {
    return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeValidator() {
    // Pass-through validator that returns the payload as-is
    return jest.fn((event, payload) => payload);
}

function makeRateLimiter() {
    return jest.fn(() => false); // not rate-limited
}

function makeGame(overrides = {}) {
    return {
        playerCount: 2,
        gridSize: 4,
        started: false,
        players: {
            player1: {
                id: 'sock-alice',
                username: 'Alice',
                avatar: '🐱',
                token: 'token-alice-123',
                isCPU: false,
                disconnectedAt: null,
                color: '#FF0000',
            },
        },
        gameState: {
            currentPlayer: 'player1',
            players: ['player1'],
            scores: { player1: 0 },
            winner: null,
        },
        spectatorCount: 0,
        createdAt: Date.now() - 60000,
        ...overrides,
    };
}

// ── #482: Cloudflare Ping Tuning ─────────────────────────────────────────────

describe('#482 — Cloudflare 100s idle timeout: ping tuning', () => {
    test('server.js should have pingInterval ≤ 25s and pingTimeout ≤ 20s', () => {
        // Read the actual server.js and verify the config values
        const fs = require('fs');
        const path = require('path');
        const serverSource = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'),
            'utf-8'
        );

        // Extract pingInterval value
        const intervalMatch = serverSource.match(/pingInterval:\s*(\d+)/);
        expect(intervalMatch).not.toBeNull();
        const pingInterval = parseInt(intervalMatch[1], 10);
        expect(pingInterval).toBeLessThanOrEqual(25000);

        // Extract pingTimeout value
        const timeoutMatch = serverSource.match(/pingTimeout:\s*(\d+)/);
        expect(timeoutMatch).not.toBeNull();
        const pingTimeout = parseInt(timeoutMatch[1], 10);
        expect(pingTimeout).toBeLessThanOrEqual(20000);

        // Combined must be well under 100s Cloudflare limit
        expect(pingInterval + pingTimeout).toBeLessThanOrEqual(50000);
    });

    test('ping round-trip must leave at least 50s margin under Cloudflare 100s limit', () => {
        const fs = require('fs');
        const path = require('path');
        const serverSource = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'),
            'utf-8'
        );
        const interval = parseInt(serverSource.match(/pingInterval:\s*(\d+)/)[1], 10);
        const timeout = parseInt(serverSource.match(/pingTimeout:\s*(\d+)/)[1], 10);
        const margin = 100000 - (interval + timeout);
        expect(margin).toBeGreaterThanOrEqual(50000);
    });
});

// ── #483: Username Collision on Rejoin ───────────────────────────────────────

describe('#483 — Username collision on rejoin', () => {
    let io, socket, log, rateLimited, validate;

    beforeEach(() => {
        io = makeMockIo();
        socket = makeMockSocket();
        log = makeMockLog();
        rateLimited = makeRateLimiter();
        validate = makeValidator();
        mockGameStore.getGame.mockReset();
        mockGameStore.setGame.mockReset();
        register(io, socket, log, rateLimited, validate);
    });

    test('rejects with "taken by disconnected player" when username matches disconnected player with different token', async () => {
        const game = makeGame({
            players: {
                player1: {
                    id: 'sock-alice', username: 'Alice', avatar: '🐱',
                    token: 'token-alice-123', isCPU: false,
                    disconnectedAt: Date.now() - 5000, color: '#FF0000',
                },
            },
        });
        mockGameStore.getGame.mockResolvedValue(game);

        await socket._handlers['join_game']({
            gameId: 'ABCD',
            username: 'Alice',
            avatar: '🐶',
            sessionToken: 'wrong-token-456',
        });

        expect(socket.emit).toHaveBeenCalledWith(
            'error',
            'This username belongs to a disconnected player. Please choose a different name or wait for them to rejoin.'
        );
    });

    test('rejects with "already in use" when username matches active (connected) player with different token', async () => {
        const game = makeGame({
            players: {
                player1: {
                    id: 'sock-alice', username: 'Alice', avatar: '🐱',
                    token: 'token-alice-123', isCPU: false,
                    disconnectedAt: null, color: '#FF0000',
                },
            },
        });
        mockGameStore.getGame.mockResolvedValue(game);

        await socket._handlers['join_game']({
            gameId: 'ABCD',
            username: 'Alice',
            avatar: '🐶',
            sessionToken: 'different-token',
        });

        expect(socket.emit).toHaveBeenCalledWith(
            'error',
            'This username is already in use.'
        );
    });

    test('allows rejoin when both username AND session token match', async () => {
        const game = makeGame({
            started: true,
            players: {
                player1: {
                    id: 'sock-alice', username: 'Alice', avatar: '🐱',
                    token: 'token-alice-123', isCPU: false,
                    disconnectedAt: Date.now() - 5000, color: '#FF0000',
                },
            },
            gameState: {
                currentPlayer: 'player1',
                players: ['player1'],
                scores: { player1: 0 },
                winner: null,
            },
        });
        mockGameStore.getGame.mockResolvedValue(game);
        mockDisconnectStore.clearDisconnect.mockResolvedValue(undefined);

        await socket._handlers['join_game']({
            gameId: 'ABCD',
            username: 'Alice',
            avatar: '🐱',
            sessionToken: 'token-alice-123',
        });

        // Should emit game_started (successful rejoin), not error
        const emitCalls = socket.emit.mock.calls;
        const errorCalls = emitCalls.filter(c => c[0] === 'error');
        expect(errorCalls).toHaveLength(0);

        const startedCalls = emitCalls.filter(c => c[0] === 'game_started');
        expect(startedCalls).toHaveLength(1);
        expect(startedCalls[0][1]).toHaveProperty('playerId', 'player1');
    });
});

// ── #480: Stale Rejoin Banner — validate_rejoin ──────────────────────────────

describe('#480 — validate_rejoin handler', () => {
    let io, socket, log, rateLimited, validate;

    beforeEach(() => {
        io = makeMockIo();
        socket = makeMockSocket();
        log = makeMockLog();
        rateLimited = makeRateLimiter();
        validate = makeValidator();
        mockGameStore.getGame.mockReset();
        register(io, socket, log, rateLimited, validate);
    });

    test('returns { valid: true } when game exists and token matches a player', async () => {
        const game = makeGame({ state: 'waiting' });
        mockGameStore.getGame.mockResolvedValue(game);

        const callback = jest.fn();
        await socket._handlers['validate_rejoin'](
            { gameId: 'ABCD', sessionToken: 'token-alice-123' },
            callback
        );

        expect(callback).toHaveBeenCalledWith({ valid: true });
    });

    test('returns { valid: false } when game does not exist', async () => {
        mockGameStore.getGame.mockResolvedValue(null);

        const callback = jest.fn();
        await socket._handlers['validate_rejoin'](
            { gameId: 'GONE', sessionToken: 'token-alice-123' },
            callback
        );

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ valid: false }));
    });

    test('returns { valid: false } when token does not match any player', async () => {
        const game = makeGame({ state: 'playing' });
        mockGameStore.getGame.mockResolvedValue(game);

        const callback = jest.fn();
        await socket._handlers['validate_rejoin'](
            { gameId: 'ABCD', sessionToken: 'wrong-token' },
            callback
        );

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ valid: false }));
    });

    test('returns { valid: false } for missing gameId', async () => {
        const callback = jest.fn();
        await socket._handlers['validate_rejoin'](
            { sessionToken: 'token-alice-123' },
            callback
        );

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ valid: false }));
    });

    test('returns { valid: false } for missing sessionToken', async () => {
        const callback = jest.fn();
        await socket._handlers['validate_rejoin'](
            { gameId: 'ABCD' },
            callback
        );

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ valid: false }));
    });

    test('does nothing when callback is not a function', async () => {
        // Should not throw
        await socket._handlers['validate_rejoin'](
            { gameId: 'ABCD', sessionToken: 'token-alice-123' }
        );
        // No error emitted
        expect(socket.emit).not.toHaveBeenCalled();
    });

    test('returns { valid: false } for null payload', async () => {
        const callback = jest.fn();
        await socket._handlers['validate_rejoin'](null, callback);
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ valid: false }));
    });

    test('returns { valid: false } when game state is not rejoinable (finished)', async () => {
        const game = makeGame({ state: 'finished' });
        mockGameStore.getGame.mockResolvedValue(game);

        const callback = jest.fn();
        await socket._handlers['validate_rejoin'](
            { gameId: 'ABCD', sessionToken: 'token-alice-123' },
            callback
        );

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ valid: false }));
    });
});

// ── #479: Transport Order (source verification) ──────────────────────────────

describe('#479 — WebSocket transport upgrade', () => {
    test('frontend socket.js should use polling-first transport order', () => {
        const fs = require('fs');
        const path = require('path');
        const socketSource = fs.readFileSync(
            path.join(__dirname, '..', '..', 'frontend', 'src', 'socket.js'),
            'utf-8'
        );

        // Should have polling before websocket in transports array
        expect(socketSource).toMatch(/transports:\s*\[\s*['"]polling['"]\s*,\s*['"]websocket['"]\s*\]/);

        // Should explicitly set upgrade: true
        expect(socketSource).toMatch(/upgrade:\s*true/);

        // Should set rememberUpgrade: true (#479)
        expect(socketSource).toMatch(/rememberUpgrade:\s*true/);
    });
});
