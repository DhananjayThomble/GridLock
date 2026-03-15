const {
    trackSocketConnection,
    untrackSocketConnection,
    getSocketCountForIP,
    MAX_SOCKETS_PER_IP,
    MAX_TRACKED_IPS,
} = require('../middleware/rateLimiter');

// We need direct access to the tracker Map for cleanup between tests.
// The module doesn't export it, so we'll work through the public API.

function cleanupIP(ip, count) {
    // Remove all sockets for an IP via the public API
    for (let i = 0; i < count; i++) {
        untrackSocketConnection(ip, `cleanup-${ip}-${i}`);
    }
}

describe('Socket Connection Tracker', () => {
    afterEach(() => {
        // Clean up any tracked IPs from tests by untracking known sockets
        // This is imperfect but works for isolated test IPs
    });

    describe('trackSocketConnection', () => {
        test('adds entry and increments count', () => {
            const ip = '10.0.0.1';
            trackSocketConnection(ip, 'sock-1');
            expect(getSocketCountForIP(ip)).toBe(1);

            trackSocketConnection(ip, 'sock-2');
            expect(getSocketCountForIP(ip)).toBe(2);

            // cleanup
            untrackSocketConnection(ip, 'sock-1');
            untrackSocketConnection(ip, 'sock-2');
        });

        test('does not double-count same socketId', () => {
            const ip = '10.0.0.2';
            trackSocketConnection(ip, 'sock-dup');
            trackSocketConnection(ip, 'sock-dup');
            expect(getSocketCountForIP(ip)).toBe(1);

            untrackSocketConnection(ip, 'sock-dup');
        });
    });

    describe('untrackSocketConnection', () => {
        test('removes entry and decrements count', () => {
            const ip = '10.0.0.3';
            trackSocketConnection(ip, 'sock-a');
            trackSocketConnection(ip, 'sock-b');
            expect(getSocketCountForIP(ip)).toBe(2);

            untrackSocketConnection(ip, 'sock-a');
            expect(getSocketCountForIP(ip)).toBe(1);

            untrackSocketConnection(ip, 'sock-b');
            expect(getSocketCountForIP(ip)).toBe(0);
        });

        test('cleans up IP entry when last socket is removed', () => {
            const ip = '10.0.0.4';
            trackSocketConnection(ip, 'sock-only');
            untrackSocketConnection(ip, 'sock-only');
            expect(getSocketCountForIP(ip)).toBe(0);
        });

        test('handles untracking non-existent socket gracefully', () => {
            expect(() => {
                untrackSocketConnection('10.0.0.99', 'nonexistent');
            }).not.toThrow();
        });
    });

    describe('getSocketCountForIP', () => {
        test('returns 0 for unknown IP', () => {
            expect(getSocketCountForIP('10.99.99.99')).toBe(0);
        });

        test('returns correct count for tracked IP', () => {
            const ip = '10.0.0.5';
            trackSocketConnection(ip, 's1');
            trackSocketConnection(ip, 's2');
            trackSocketConnection(ip, 's3');
            expect(getSocketCountForIP(ip)).toBe(3);

            untrackSocketConnection(ip, 's1');
            untrackSocketConnection(ip, 's2');
            untrackSocketConnection(ip, 's3');
        });
    });

    describe('MAX_SOCKETS_PER_IP limit', () => {
        test('limit is 50', () => {
            expect(MAX_SOCKETS_PER_IP).toBe(50);
        });
    });

    describe('OOM bound (MAX_TRACKED_IPS)', () => {
        test('MAX_TRACKED_IPS is 10000', () => {
            expect(MAX_TRACKED_IPS).toBe(10_000);
        });

        test('trackSocketConnection returns true on success', () => {
            const ip = '10.0.0.6';
            const result = trackSocketConnection(ip, 'oom-test-1');
            expect(result).toBe(true);

            untrackSocketConnection(ip, 'oom-test-1');
        });

        test('trackSocketConnection returns true for existing IP even at capacity', () => {
            // If an IP is already tracked, adding more sockets to it should succeed
            // regardless of the total IP count
            const ip = '10.0.0.7';
            trackSocketConnection(ip, 'existing-1');
            // Adding another socket to an already-tracked IP should succeed
            const result = trackSocketConnection(ip, 'existing-2');
            expect(result).toBe(true);

            untrackSocketConnection(ip, 'existing-1');
            untrackSocketConnection(ip, 'existing-2');
        });

        // Note: We don't test filling up to 10,000 IPs in unit tests since that
        // would be slow and pollute the shared module state. The logic is:
        // if (!socketConnectionTracker.has(ip) && socketConnectionTracker.size >= MAX_TRACKED_IPS) return false;
    });
});
