/**
 * backend/__tests__/gameCleanup.test.js
 *
 * Tests for the game cleanup / GC service:
 * - MongoDB sweep finds and marks stale games as abandoned
 * - Games with undefined disconnectedAt but old updatedAt are cleaned up
 * - Existing in-memory sweep logic still works
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    // Skip syncIndexes — the TTL partial filter on finishedAt uses $ne:null
    // which mongodb-memory-server doesn't support. Not needed for these tests.
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
});

const Game = require('../models/Game');
const {
    isFullyAbandoned,
    isZombieGame,
    sweepMongoZombies,
    MONGO_STALE_TTL_MS,
    ZOMBIE_GAME_TTL_MS,
} = require('../services/gameCleanup');

const mockLog = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };

// Helper: insert a game document directly into MongoDB (bypasses Mongoose hooks
// which have a pre-save next() issue with Mongoose 8+)
async function insertGame(overrides) {
    const defaults = {
        gameId: 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        gridSize: 3,
        playerCount: 2,
        players: {
            player1: {
                id: 'sock1',
                username: 'Alice',
                avatar: '👩',
                color: '#ff0000',
                token: 'tok1',
                disconnectedAt: null,
            },
            player2: {
                id: 'sock2',
                username: 'Bob',
                avatar: '👦',
                color: '#0000ff',
                token: 'tok2',
                disconnectedAt: null,
            },
        },
        gameState: { currentPlayer: 'player1' },
        status: 'playing',
        matchType: 'private',
        updatedAt: new Date(),
        createdAt: new Date(),
        lastActivityAt: new Date(),
        finishedAt: null,
        metadata: { reason: null, reconnectWindowMs: 60000 },
        moveHistory: [],
    };

    const data = Object.assign({}, defaults, overrides);
    await Game.collection.insertOne(data);
    return data;
}

// --- sweepMongoZombies tests ---

describe('sweepMongoZombies', () => {
    test('marks stale playing games as abandoned', async () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        await insertGame({ gameId: 'stale-playing-1', status: 'playing', updatedAt: twoHoursAgo });
        await insertGame({ gameId: 'stale-playing-2', status: 'playing', updatedAt: twoHoursAgo });

        const count = await sweepMongoZombies(Game, mockLog);
        expect(count).toBe(2);

        const g1 = await Game.findOne({ gameId: 'stale-playing-1' });
        const g2 = await Game.findOne({ gameId: 'stale-playing-2' });
        expect(g1.status).toBe('abandoned');
        expect(g2.status).toBe('abandoned');
        expect(g1.finishedAt).toBeTruthy();
        expect(g1.metadata.reason).toBe('gc_mongo_sweep');
    });

    test('marks stale waiting games as abandoned', async () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        await insertGame({ gameId: 'stale-waiting-1', status: 'waiting', updatedAt: twoHoursAgo });

        const count = await sweepMongoZombies(Game, mockLog);
        expect(count).toBe(1);

        const g = await Game.findOne({ gameId: 'stale-waiting-1' });
        expect(g.status).toBe('abandoned');
    });

    test('does NOT touch recent active games', async () => {
        await insertGame({ gameId: 'recent-game', status: 'playing', updatedAt: new Date() });

        const count = await sweepMongoZombies(Game, mockLog);
        expect(count).toBe(0);

        const g = await Game.findOne({ gameId: 'recent-game' });
        expect(g.status).toBe('playing');
    });

    test('does NOT touch already finished/abandoned games', async () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        await insertGame({ gameId: 'already-done', status: 'finished', updatedAt: twoHoursAgo });
        await insertGame({ gameId: 'already-abandoned', status: 'abandoned', updatedAt: twoHoursAgo });

        const count = await sweepMongoZombies(Game, mockLog);
        expect(count).toBe(0);
    });

    test('handles mixed: only marks stale ones', async () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        await insertGame({ gameId: 'stale', status: 'playing', updatedAt: twoHoursAgo });
        await insertGame({ gameId: 'fresh', status: 'playing', updatedAt: new Date() });
        await insertGame({ gameId: 'done', status: 'finished', updatedAt: twoHoursAgo });

        const count = await sweepMongoZombies(Game, mockLog);
        expect(count).toBe(1);

        expect((await Game.findOne({ gameId: 'stale' })).status).toBe('abandoned');
        expect((await Game.findOne({ gameId: 'fresh' })).status).toBe('playing');
        expect((await Game.findOne({ gameId: 'done' })).status).toBe('finished');
    });
});

// --- isFullyAbandoned with undefined disconnectedAt fallback ---

describe('isFullyAbandoned - disconnectedAt undefined fallback', () => {
    test('returns abandoned=false for recent game with undefined disconnectedAt', () => {
        const game = {
            gameId: 'recent',
            playerCount: 2,
            players: {
                player1: { disconnectedAt: undefined },
                player2: { disconnectedAt: new Date() },
            },
            updatedAt: new Date(), // just now
        };

        const result = isFullyAbandoned(game, { activeGameIds: new Set() });
        expect(result.abandoned).toBe(false);
    });

    test('returns abandoned=true for stale game with undefined disconnectedAt and no active sockets', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const game = {
            gameId: 'stale-undefined',
            playerCount: 2,
            players: {
                player1: { disconnectedAt: undefined },
                player2: { disconnectedAt: twoHoursAgo },
            },
            updatedAt: twoHoursAgo,
        };

        // Not in active game IDs = no sockets connected
        const result = isFullyAbandoned(game, { activeGameIds: new Set() });
        expect(result.abandoned).toBe(true);
        expect(result.oldestDisconnect).toBeTruthy();
    });

    test('returns abandoned=false for stale game with undefined disconnectedAt BUT active sockets', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const game = {
            gameId: 'stale-but-active',
            playerCount: 2,
            players: {
                player1: { disconnectedAt: undefined },
                player2: { disconnectedAt: twoHoursAgo },
            },
            updatedAt: twoHoursAgo,
        };

        // Game IS in active store = sockets connected
        const result = isFullyAbandoned(game, { activeGameIds: new Set(['stale-but-active']) });
        expect(result.abandoned).toBe(false);
    });

    test('returns abandoned=true when ALL players have undefined disconnectedAt and game is stale', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const game = {
            gameId: 'all-undefined',
            playerCount: 2,
            players: {
                player1: { disconnectedAt: undefined },
                player2: { disconnectedAt: undefined },
            },
            updatedAt: twoHoursAgo,
        };

        const result = isFullyAbandoned(game, { activeGameIds: new Set() });
        expect(result.abandoned).toBe(true);
    });

    test('still works with original behavior: all players properly disconnected', () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

        const game = {
            gameId: 'proper-disconnect',
            playerCount: 2,
            players: {
                player1: { disconnectedAt: fiveMinAgo },
                player2: { disconnectedAt: fiveMinAgo },
            },
            updatedAt: fiveMinAgo,
        };

        const result = isFullyAbandoned(game);
        expect(result.abandoned).toBe(true);
        expect(result.oldestDisconnect).toEqual(fiveMinAgo);
    });

    test('handles no players/playerCount gracefully', () => {
        expect(isFullyAbandoned({}).abandoned).toBe(false);
        expect(isFullyAbandoned({ players: {}, playerCount: 0 }).abandoned).toBe(false);
    });

    test('handles all null player slots', () => {
        const game = {
            playerCount: 2,
            players: { player1: null, player2: null },
            createdAt: new Date(Date.now() - 1000),
        };
        const result = isFullyAbandoned(game);
        expect(result.abandoned).toBe(true);
    });
});

// --- startGameCleanup: io.emit on zombie cleanup ---

describe('startGameCleanup - room_closed emission (#484)', () => {
    test('emits room_closed to zombie game room during cleanup cycle', async () => {
        const { startGameCleanup, ZOMBIE_GAME_TTL_MS } = require('../services/gameCleanup');

        const gameId = 'zombie-emit-test';
        const zombieGame = {
            gameId,
            status: 'waiting',
            started: false,
            createdAt: new Date(Date.now() - ZOMBIE_GAME_TTL_MS - 60000),
            playerCount: 1,
            players: { player1: { id: 'sock1', disconnectedAt: null } },
            gameState: {},
        };

        // Mock gameStore
        const mockGameStore = {
            getAllActiveGames: jest.fn().mockResolvedValue(new Map([[gameId, zombieGame]])),
            deleteGame: jest.fn().mockResolvedValue(true),
            deleteSpectatorCount: jest.fn().mockResolvedValue(true),
        };

        // Mock io with a room containing 1 socket
        const mockEmit = jest.fn();
        const mockIo = {
            sockets: {
                adapter: {
                    rooms: new Map([[gameId, new Set(['sock1'])]]),
                },
            },
            to: jest.fn().mockReturnValue({ emit: mockEmit }),
        };

        // Start cleanup with a very short interval so it fires quickly
        const originalSetInterval = global.setInterval;
        let capturedCallback;
        global.setInterval = (fn, _ms) => {
            capturedCallback = fn;
            return { unref: jest.fn() };
        };

        const testLog = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
        startGameCleanup(mockGameStore, testLog, null, mockIo);

        global.setInterval = originalSetInterval;

        // Invoke the captured GC callback directly
        await capturedCallback();

        expect(mockIo.to).toHaveBeenCalledWith(gameId);
        expect(mockEmit).toHaveBeenCalledWith('room_closed', {
            reason: 'Game expired \u2014 lobby was idle too long',
            gameId,
        });
        expect(mockGameStore.deleteGame).toHaveBeenCalledWith(gameId);

        // Verify the log message for evicting players
        expect(testLog.info).toHaveBeenCalledWith(
            'Zombie cleanup: evicting players from idle lobby',
            { gameId, roomSize: 1 }
        );
    });
});

// --- #484: isZombieGame tests ---

describe('isZombieGame - zombie lobby detection (#484)', () => {
    test('returns true for waiting game older than ZOMBIE_GAME_TTL_MS', () => {
        const now = Date.now();
        const game = {
            status: 'waiting',
            started: false,
            createdAt: new Date(now - ZOMBIE_GAME_TTL_MS - 1000),
            gameState: {},
        };
        expect(isZombieGame(game, now)).toBe(true);
    });

    test('returns false for waiting game younger than ZOMBIE_GAME_TTL_MS', () => {
        const now = Date.now();
        const game = {
            status: 'waiting',
            started: false,
            createdAt: new Date(now - 5 * 60 * 1000), // 5 min old
            gameState: {},
        };
        expect(isZombieGame(game, now)).toBe(false);
    });

    test('returns false for started/playing game even if old', () => {
        const now = Date.now();
        const game = {
            status: 'playing',
            started: true,
            createdAt: new Date(now - ZOMBIE_GAME_TTL_MS - 60000),
            gameState: { currentPlayer: 'player1' },
        };
        expect(isZombieGame(game, now)).toBe(false);
    });

    test('returns false for finished game', () => {
        const now = Date.now();
        const game = {
            status: 'finished',
            createdAt: new Date(now - ZOMBIE_GAME_TTL_MS - 60000),
            gameState: { winner: 'player1' },
        };
        expect(isZombieGame(game, now)).toBe(false);
    });

    test('returns true for game with started===false and no gameState activity', () => {
        const now = Date.now();
        const game = {
            started: false,
            createdAt: new Date(now - ZOMBIE_GAME_TTL_MS - 1000),
            gameState: {},
        };
        expect(isZombieGame(game, now)).toBe(true);
    });

    test('returns false when createdAt is missing', () => {
        const now = Date.now();
        const game = {
            status: 'waiting',
            started: false,
            gameState: {},
        };
        expect(isZombieGame(game, now)).toBe(false);
    });

    test('returns true at exact boundary (createdAt === now - ZOMBIE_GAME_TTL_MS - 1)', () => {
        const now = Date.now();
        const game = {
            status: 'waiting',
            createdAt: new Date(now - ZOMBIE_GAME_TTL_MS - 1),
            gameState: {},
        };
        expect(isZombieGame(game, now)).toBe(true);
    });

    test('returns false at exact boundary (createdAt === now - ZOMBIE_GAME_TTL_MS)', () => {
        const now = Date.now();
        const game = {
            status: 'waiting',
            createdAt: new Date(now - ZOMBIE_GAME_TTL_MS),
            gameState: {},
        };
        expect(isZombieGame(game, now)).toBe(false);
    });
});
