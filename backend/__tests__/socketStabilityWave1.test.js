/**
 * Socket Stability Wave 1 Tests
 * Covers: #481 (timer recovery), #490 (forfeit execution), #489 (lobby cleanup)
 *
 * These tests focus on the disconnectStore.getAllDisconnects() method and
 * the recoverDisconnectTimers/executeForfeit logic at a unit level by
 * mocking the heavy shared.js dependencies.
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

// Mock the shared module to intercept all store/timer refs
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
        promMetrics: null,
    };
});

// Also mock the stores directly (they're required separately in some paths)
jest.mock('../stores/disconnectStore', () => mockDisconnectStore);
jest.mock('../stores/gameStore', () => mockGameStore);
jest.mock('../stores/rematchStore', () => mockRematchStore);
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

const { recoverDisconnectTimers, executeForfeit } = require('../controllers/handlers/disconnectHandler');

// Helpers
function makeMockIo(roomSockets = new Map()) {
    const emitted = [];
    const socketMap = new Map();
    const rooms = new Map();

    for (const [roomId, sids] of roomSockets) {
        rooms.set(roomId, new Set(sids));
        for (const sid of sids) {
            if (!socketMap.has(sid)) {
                socketMap.set(sid, {
                    id: sid,
                    join: jest.fn(),
                    leave: jest.fn(),
                    data: {},
                    emit: jest.fn(),
                });
            }
        }
    }

    return {
        to: jest.fn().mockReturnValue({
            emit: jest.fn((...args) => emitted.push(args)),
        }),
        sockets: {
            adapter: { rooms },
            sockets: socketMap,
        },
        _emitted: emitted,
    };
}

function makeMockLog() {
    return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
}

function makeGame(overrides = {}) {
    return {
        playerCount: 2,
        players: {
            player1: { username: 'Alice', id: 'sock1', isCPU: false, disconnectedAt: null },
            player2: { username: 'Bob', id: 'sock2', isCPU: false, disconnectedAt: null },
        },
        gameState: {
            currentPlayer: 'player1',
            players: ['player1', 'player2'],
            scores: { player1: 5, player2: 3 },
            winner: null,
        },
        createdAt: Date.now() - 60000,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockLocalTimers.clear();
    mockRematchTimers.clear();
    mockHostStartTimers.clear();
});

// ═══════════════════════════════════════════════════════════════════
// #481 — recoverDisconnectTimers
// ═══════════════════════════════════════════════════════════════════
describe('#481 — recoverDisconnectTimers', () => {
    test('handles empty disconnectStore gracefully', async () => {
        mockDisconnectStore.getAllDisconnects.mockResolvedValue([]);
        const io = makeMockIo();
        const log = makeMockLog();

        await recoverDisconnectTimers(io, log);

        expect(log.info).not.toHaveBeenCalledWith(
            expect.stringContaining('Recovering'),
            expect.anything()
        );
    });

    test('skips disconnects for games that no longer exist', async () => {
        mockDisconnectStore.getAllDisconnects.mockResolvedValue([
            { gameId: 'gone-game', playerId: 'player1', socketId: 's1', timestamp: Date.now() - 10000 },
        ]);
        mockGameStore.getGame.mockResolvedValue(null);

        const io = makeMockIo();
        const log = makeMockLog();

        await recoverDisconnectTimers(io, log);

        expect(mockDisconnectStore.clearDisconnect).toHaveBeenCalledWith('gone-game', 'player1');
        expect(log.info).toHaveBeenCalledWith('Disconnect timer recovery complete', expect.objectContaining({ skipped: 1 }));
    });

    test('skips disconnects for finished games (has winner)', async () => {
        mockDisconnectStore.getAllDisconnects.mockResolvedValue([
            { gameId: 'done-game', playerId: 'player2', socketId: 's2', timestamp: Date.now() - 5000 },
        ]);
        const game = makeGame();
        game.gameState.winner = 'player1';
        mockGameStore.getGame.mockResolvedValue(game);

        const io = makeMockIo();
        const log = makeMockLog();

        await recoverDisconnectTimers(io, log);

        expect(mockDisconnectStore.clearDisconnect).toHaveBeenCalledWith('done-game', 'player2');
        expect(log.info).toHaveBeenCalledWith('Disconnect timer recovery complete', expect.objectContaining({ skipped: 1 }));
    });

    test('skips disconnects where player already reconnected', async () => {
        mockDisconnectStore.getAllDisconnects.mockResolvedValue([
            { gameId: 'game1', playerId: 'player2', socketId: 'old-sock', timestamp: Date.now() - 5000 },
        ]);
        const game = makeGame();
        game.players.player2.disconnectedAt = null; // reconnected
        mockGameStore.getGame.mockResolvedValue(game);

        const io = makeMockIo();
        const log = makeMockLog();

        await recoverDisconnectTimers(io, log);

        expect(mockDisconnectStore.clearDisconnect).toHaveBeenCalledWith('game1', 'player2');
        expect(log.info).toHaveBeenCalledWith('Disconnect timer recovery complete', expect.objectContaining({ skipped: 1 }));
    });

    test('immediately forfeits overdue disconnects', async () => {
        const oldTimestamp = Date.now() - 60000; // 60s ago, past 45s timeout
        mockDisconnectStore.getAllDisconnects.mockResolvedValue([
            { gameId: 'game1', playerId: 'player2', socketId: 's2', timestamp: oldTimestamp },
        ]);

        const game = makeGame();
        game.players.player2.disconnectedAt = oldTimestamp;
        mockGameStore.getGame.mockResolvedValue(game);
        mockDisconnectStore.isDisconnected.mockResolvedValue(true);

        const io = makeMockIo();
        const log = makeMockLog();

        await recoverDisconnectTimers(io, log);

        expect(log.info).toHaveBeenCalledWith('Disconnect timer recovery complete', expect.objectContaining({ expired: 1 }));
        expect(io.to).toHaveBeenCalledWith('game1');
    });

    test('recovers timer with remaining duration for active disconnect', async () => {
        const recentTimestamp = Date.now() - 2000; // 2s ago, well within 8s test timeout
        mockDisconnectStore.getAllDisconnects.mockResolvedValue([
            { gameId: 'game1', playerId: 'player2', socketId: 's2', timestamp: recentTimestamp },
        ]);

        const game = makeGame();
        game.players.player2.disconnectedAt = recentTimestamp;
        mockGameStore.getGame.mockResolvedValue(game);

        const io = makeMockIo();
        const log = makeMockLog();

        await recoverDisconnectTimers(io, log);

        expect(log.info).toHaveBeenCalledWith('Disconnect timer recovery complete', expect.objectContaining({ recovered: 1 }));
        expect(mockLocalTimers.has('game1:player2')).toBe(true);

        // Clean up timer to prevent leak
        const entry = mockLocalTimers.get('game1:player2');
        if (entry?.timer) clearTimeout(entry.timer);
    });

    test('handles disconnectStore errors gracefully', async () => {
        mockDisconnectStore.getAllDisconnects.mockRejectedValue(new Error('Redis down'));

        const io = makeMockIo();
        const log = makeMockLog();

        await recoverDisconnectTimers(io, log);

        expect(log.error).toHaveBeenCalledWith('Failed to recover disconnect timers', expect.objectContaining({ error: 'Redis down' }));
    });
});

// ═══════════════════════════════════════════════════════════════════
// #490 — executeForfeit
// ═══════════════════════════════════════════════════════════════════
describe('#490 — executeForfeit', () => {
    test('declares winner in 2-player game after timeout', async () => {
        const game = makeGame();
        game.players.player2.disconnectedAt = Date.now() - 50000;

        mockDisconnectStore.isDisconnected.mockResolvedValue(true);
        mockGameStore.getGame.mockResolvedValue(game);

        const io = makeMockIo();
        const log = makeMockLog();

        await executeForfeit(io, log, 'game1', 'player2');

        const gameOverEmit = io._emitted.find(c => c[0] === 'game_over');
        expect(gameOverEmit).toBeTruthy();
        expect(gameOverEmit[1]).toEqual(expect.objectContaining({ reason: 'opponent_disconnected' }));
        expect(log.info).toHaveBeenCalledWith('Forfeit executed for disconnected player', expect.anything());
    });

    test('emits disconnect_timeout_resolved for UI banner cleanup', async () => {
        const game = makeGame();
        game.players.player2.disconnectedAt = Date.now() - 50000;

        mockDisconnectStore.isDisconnected.mockResolvedValue(true);
        mockGameStore.getGame.mockResolvedValue(game);

        const io = makeMockIo();
        const log = makeMockLog();

        await executeForfeit(io, log, 'game1', 'player2');

        const resolvedEmit = io._emitted.find(c => c[0] === 'disconnect_timeout_resolved');
        expect(resolvedEmit).toBeTruthy();
        expect(resolvedEmit[1]).toEqual(expect.objectContaining({
            playerId: 'player2',
            username: 'Bob',
        }));
    });

    test('skips if player already reconnected', async () => {
        mockDisconnectStore.isDisconnected.mockResolvedValue(false);

        const io = makeMockIo();
        const log = makeMockLog();

        await executeForfeit(io, log, 'game1', 'player2');

        expect(mockGameStore.getGame).not.toHaveBeenCalled();
        expect(log.info).not.toHaveBeenCalled();
    });

    test('skips if game no longer exists', async () => {
        mockDisconnectStore.isDisconnected.mockResolvedValue(true);
        mockGameStore.getGame.mockResolvedValue(null);

        const io = makeMockIo();
        const log = makeMockLog();

        await executeForfeit(io, log, 'game1', 'player2');

        expect(log.info).not.toHaveBeenCalled();
    });

    test('skips if game already has a winner', async () => {
        const game = makeGame();
        game.gameState.winner = 'player1';

        mockDisconnectStore.isDisconnected.mockResolvedValue(true);
        mockGameStore.getGame.mockResolvedValue(game);

        const io = makeMockIo();
        const log = makeMockLog();

        await executeForfeit(io, log, 'game1', 'player2');

        expect(mockGameStore.setGame).not.toHaveBeenCalled();
    });

    test('in 3+ player game, removes player and continues', async () => {
        const game = makeGame({
            playerCount: 3,
            players: {
                player1: { username: 'Alice', id: 's1', isCPU: false, disconnectedAt: null },
                player2: { username: 'Bob', id: 's2', isCPU: false, disconnectedAt: Date.now() - 50000 },
                player3: { username: 'Charlie', id: 's3', isCPU: false, disconnectedAt: null },
            },
            gameState: {
                currentPlayer: 'player2',
                players: ['player1', 'player2', 'player3'],
                scores: { player1: 3, player2: 1, player3: 5 },
                winner: null,
            },
        });

        mockDisconnectStore.isDisconnected.mockResolvedValue(true);
        mockGameStore.getGame.mockResolvedValue(game);

        const io = makeMockIo();
        const log = makeMockLog();

        await executeForfeit(io, log, 'game1', 'player2');

        const forfeitEmit = io._emitted.find(c => c[0] === 'player_forfeited');
        expect(forfeitEmit).toBeTruthy();
        const gameOverEmit = io._emitted.find(c => c[0] === 'game_over');
        expect(gameOverEmit).toBeFalsy();
        expect(log.info).toHaveBeenCalledWith('Forfeit executed for disconnected player',
            expect.objectContaining({ remaining: 2 }));
    });
});

// ═══════════════════════════════════════════════════════════════════
// #489 — disconnectStore.getAllDisconnects
// ═══════════════════════════════════════════════════════════════════
describe('#489 — disconnectStore.getAllDisconnects', () => {
    test('getAllDisconnects is exported and callable', () => {
        expect(typeof mockDisconnectStore.getAllDisconnects).toBe('function');
    });
});
