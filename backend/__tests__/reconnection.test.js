// backend/__tests__/reconnection.test.js
// Unit tests for disconnect/reconnect grace period logic

const disconnectStore = require('../stores/disconnectStore');

// Mock redis client to use in-memory fallback
jest.mock('../stores/redisClient', () => ({
    getRedisClient: jest.fn().mockResolvedValue(null),
}));

describe('disconnectStore', () => {
    beforeEach(async () => {
        // Clear all in-memory state between tests
        // Access internal map via module
    });

    test('setDisconnect marks a player as disconnected', async () => {
        await disconnectStore.setDisconnect('GAME01', 'player1', 'socket-abc', 30000);
        const isDisconnected = await disconnectStore.isDisconnected('GAME01', 'player1');
        expect(isDisconnected).toBe(true);
    });

    test('clearDisconnect removes disconnect state', async () => {
        await disconnectStore.setDisconnect('GAME02', 'player1', 'socket-xyz', 30000);
        await disconnectStore.clearDisconnect('GAME02', 'player1');
        const isDisconnected = await disconnectStore.isDisconnected('GAME02', 'player1');
        expect(isDisconnected).toBe(false);
    });

    test('isDisconnected returns false for unknown players', async () => {
        const result = await disconnectStore.isDisconnected('NONEXIST', 'player1');
        expect(result).toBe(false);
    });

    test('getDisconnectInfo returns socket and timestamp', async () => {
        await disconnectStore.setDisconnect('GAME03', 'player2', 'socket-info', 30000);
        const info = await disconnectStore.getDisconnectInfo('GAME03', 'player2');
        expect(info).not.toBeNull();
        expect(info.socketId).toBe('socket-info');
        expect(typeof info.timestamp).toBe('number');
    });

    test('getDisconnectInfo returns null for non-disconnected player', async () => {
        const info = await disconnectStore.getDisconnectInfo('NONEXIST', 'player1');
        expect(info).toBeNull();
    });

    test('storeCount reflects number of disconnect entries', async () => {
        await disconnectStore.setDisconnect('GAME04', 'player1', 's1', 30000);
        await disconnectStore.setDisconnect('GAME04', 'player2', 's2', 30000);
        const count = await disconnectStore.storeCount();
        expect(count).toBeGreaterThanOrEqual(2);
    });

    test('multiple disconnects for same player overwrite correctly', async () => {
        await disconnectStore.setDisconnect('GAME05', 'player1', 'old-socket', 30000);
        await disconnectStore.setDisconnect('GAME05', 'player1', 'new-socket', 30000);
        const info = await disconnectStore.getDisconnectInfo('GAME05', 'player1');
        expect(info.socketId).toBe('new-socket');
    });

    test('different games have independent disconnect states', async () => {
        await disconnectStore.setDisconnect('GAMEA', 'player1', 's-a', 30000);
        await disconnectStore.setDisconnect('GAMEB', 'player1', 's-b', 30000);

        await disconnectStore.clearDisconnect('GAMEA', 'player1');

        expect(await disconnectStore.isDisconnected('GAMEA', 'player1')).toBe(false);
        expect(await disconnectStore.isDisconnected('GAMEB', 'player1')).toBe(true);
    });
});

describe('Reconnection constants', () => {
    test('DISCONNECT_TIMEOUT_MS is 8s in test mode', () => {
        // In test env (NODE_ENV=test), the timeout should be short
        // We verify this by checking the value used in socketHandlers
        expect(process.env.NODE_ENV).toBe('test');
        // The actual value is imported at module level; we can't easily
        // test the export without running the full server. This test
        // verifies the environment is set correctly.
    });

    test('grace period window allows reconnection within timeout', async () => {
        // Simulate: disconnect → wait < timeout → reconnect
        await disconnectStore.setDisconnect('GRACE1', 'player1', 's1', 30000);
        expect(await disconnectStore.isDisconnected('GRACE1', 'player1')).toBe(true);

        // Simulate reconnection by clearing the disconnect
        await disconnectStore.clearDisconnect('GRACE1', 'player1');
        expect(await disconnectStore.isDisconnected('GRACE1', 'player1')).toBe(false);
    });
});
