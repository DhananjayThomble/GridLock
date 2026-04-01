/**
 * Real disconnectStore.getAllDisconnects tests (#489, #6).
 * These test the actual implementation by mocking only the Redis client dependency.
 */

let mockRedisClient;

jest.mock('../stores/redisClient', () => ({
    getRedisClient: jest.fn(async () => mockRedisClient),
}));

const disconnectStore = require('../stores/disconnectStore');

beforeEach(() => {
    mockRedisClient = null;
    jest.clearAllMocks();
});

describe('disconnectStore.getAllDisconnects — real implementation', () => {
    test('returns empty array when no disconnects exist (Redis)', async () => {
        mockRedisClient = {
            scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
        };

        const results = await disconnectStore.getAllDisconnects();
        expect(results).toEqual([]);
        expect(mockRedisClient.scan).toHaveBeenCalled();
    });

    test('returns parsed entries from Redis SCAN', async () => {
        const entry1 = JSON.stringify({ gameId: 'g1', playerId: 'player1', socketId: 's1', timestamp: 1000 });
        const entry2 = JSON.stringify({ gameId: 'g2', playerId: 'player2', socketId: 's2', timestamp: 2000 });

        mockRedisClient = {
            scan: jest.fn()
                .mockResolvedValueOnce({
                    cursor: 5,
                    keys: ['gridlock:disconnect:g1:player1'],
                })
                .mockResolvedValueOnce({
                    cursor: 0,
                    keys: ['gridlock:disconnect:g2:player2'],
                }),
            get: jest.fn()
                .mockResolvedValueOnce(entry1)
                .mockResolvedValueOnce(entry2),
        };

        const results = await disconnectStore.getAllDisconnects();
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({ gameId: 'g1', playerId: 'player1', socketId: 's1', timestamp: 1000 });
        expect(results[1]).toEqual({ gameId: 'g2', playerId: 'player2', socketId: 's2', timestamp: 2000 });
    });

    test('falls back to in-memory when Redis fails', async () => {
        // First: set a disconnect with failing Redis so it goes to in-memory
        mockRedisClient = {
            set: jest.fn().mockRejectedValue(new Error('Redis down')),
        };
        await disconnectStore.setDisconnect('game-x', 'player1', 'sock-1', 30000);

        // Now getAllDisconnects with failing Redis — should use in-memory
        mockRedisClient = {
            scan: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
        };
        const results = await disconnectStore.getAllDisconnects();
        expect(results.length).toBeGreaterThanOrEqual(1);
        const entry = results.find(r => r.gameId === 'game-x');
        expect(entry).toBeTruthy();
        expect(entry.playerId).toBe('player1');
        expect(entry.socketId).toBe('sock-1');

        // Clean up in-memory state
        mockRedisClient = {
            del: jest.fn().mockRejectedValue(new Error('Redis down')),
        };
        await disconnectStore.clearDisconnect('game-x', 'player1');
    });

    test('handles malformed entries gracefully', async () => {
        mockRedisClient = {
            scan: jest.fn().mockResolvedValue({
                cursor: 0,
                keys: ['gridlock:disconnect:g1:p1', 'gridlock:disconnect:g2:p2', 'gridlock:disconnect:g3:p3'],
            }),
            get: jest.fn()
                .mockResolvedValueOnce(JSON.stringify({ gameId: 'g1', playerId: 'p1', socketId: 's1', timestamp: 100 }))
                .mockResolvedValueOnce('not-valid-json{{')
                .mockResolvedValueOnce(null),
        };

        const results = await disconnectStore.getAllDisconnects();
        // Only the valid first entry should be returned; malformed & null are skipped
        expect(results).toHaveLength(1);
        expect(results[0].gameId).toBe('g1');
    });

    test('handles numeric cursor from Redis SCAN (cursor type mismatch fix)', async () => {
        mockRedisClient = {
            scan: jest.fn()
                .mockResolvedValueOnce({
                    cursor: 42, // numeric cursor, not string
                    keys: ['gridlock:disconnect:g1:p1'],
                })
                .mockResolvedValueOnce({
                    cursor: 0, // numeric zero
                    keys: [],
                }),
            get: jest.fn().mockResolvedValue(
                JSON.stringify({ gameId: 'g1', playerId: 'p1', socketId: 's1', timestamp: 500 })
            ),
        };

        const results = await disconnectStore.getAllDisconnects();
        expect(results).toHaveLength(1);
        // Verify scan was called twice (once with initial cursor, once with cursor 42)
        expect(mockRedisClient.scan).toHaveBeenCalledTimes(2);
    });
});
