// backend/__tests__/idleTimeout.test.js
// Tests for idle socket timeout logic (#390)

const {
    startLobbyTimer,
    cancelLobbyTimer,
    startPostgameTimer,
    cancelPostgameTimer,
    clearAllTimers,
    lobbyTimers,
    postgameTimers,
    LOBBY_TIMEOUT_MS,
    POSTGAME_TIMEOUT_MS,
} = require('../middleware/idleTimeout');

// Use fake timers for all tests
beforeEach(() => {
    jest.useFakeTimers();
    lobbyTimers.clear();
    postgameTimers.clear();
});

afterEach(() => {
    // Clear any remaining timers
    lobbyTimers.forEach((timer) => clearTimeout(timer));
    postgameTimers.forEach((timer) => clearTimeout(timer));
    lobbyTimers.clear();
    postgameTimers.clear();
    jest.useRealTimers();
});

/**
 * Create a mock socket for testing.
 */
function createMockSocket(id = 'socket-1') {
    return {
        id,
        connected: true,
        emit: jest.fn(),
        disconnect: jest.fn(() => {
            // Simulate disconnect
        }),
    };
}

describe('Idle Timeout - Lobby Timer', () => {
    test('disconnects socket after LOBBY_TIMEOUT_MS idle in lobby', () => {
        const socket = createMockSocket();
        startLobbyTimer(socket);

        expect(lobbyTimers.has(socket.id)).toBe(true);

        // Advance just before timeout — should not disconnect
        jest.advanceTimersByTime(LOBBY_TIMEOUT_MS - 1);
        expect(socket.emit).not.toHaveBeenCalled();
        expect(socket.disconnect).not.toHaveBeenCalled();

        // Advance past timeout
        jest.advanceTimersByTime(2);
        expect(socket.emit).toHaveBeenCalledWith('idle_timeout', {
            reason: 'lobby',
            timeoutMs: LOBBY_TIMEOUT_MS,
        });

        // After 1s grace period, disconnect
        jest.advanceTimersByTime(1000);
        expect(socket.disconnect).toHaveBeenCalledWith(true);

        // Timer should be cleaned up
        expect(lobbyTimers.has(socket.id)).toBe(false);
    });

    test('timer cancelled when joining a game', () => {
        const socket = createMockSocket();
        startLobbyTimer(socket);
        expect(lobbyTimers.has(socket.id)).toBe(true);

        cancelLobbyTimer(socket.id);
        expect(lobbyTimers.has(socket.id)).toBe(false);

        // Advance past timeout — should NOT disconnect
        jest.advanceTimersByTime(LOBBY_TIMEOUT_MS + 2000);
        expect(socket.emit).not.toHaveBeenCalled();
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('timer cancelled when creating a game', () => {
        const socket = createMockSocket();
        startLobbyTimer(socket);

        cancelLobbyTimer(socket.id);

        jest.advanceTimersByTime(LOBBY_TIMEOUT_MS + 2000);
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('does not disconnect already-disconnected socket', () => {
        const socket = createMockSocket();
        socket.connected = false;
        startLobbyTimer(socket);

        jest.advanceTimersByTime(LOBBY_TIMEOUT_MS + 1);
        expect(socket.emit).not.toHaveBeenCalled();
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('starting a new lobby timer cancels the previous one', () => {
        const socket = createMockSocket();
        startLobbyTimer(socket);
        const firstTimerSize = lobbyTimers.size;

        // Start a new timer (e.g., on reconnect)
        startLobbyTimer(socket);
        expect(lobbyTimers.size).toBe(firstTimerSize); // Still just 1 entry

        // Only the second timer should fire
        jest.advanceTimersByTime(LOBBY_TIMEOUT_MS + 1);
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });
});

describe('Idle Timeout - Postgame Timer', () => {
    test('disconnects socket after POSTGAME_TIMEOUT_MS idle post-game', () => {
        const socket = createMockSocket();
        startPostgameTimer(socket);

        expect(postgameTimers.has(socket.id)).toBe(true);

        jest.advanceTimersByTime(POSTGAME_TIMEOUT_MS - 1);
        expect(socket.emit).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2);
        expect(socket.emit).toHaveBeenCalledWith('idle_timeout', {
            reason: 'postgame',
            timeoutMs: POSTGAME_TIMEOUT_MS,
        });

        jest.advanceTimersByTime(1000);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(postgameTimers.has(socket.id)).toBe(false);
    });

    test('postgame timer cancelled on rematch', () => {
        const socket = createMockSocket();
        startPostgameTimer(socket);

        cancelPostgameTimer(socket.id);
        expect(postgameTimers.has(socket.id)).toBe(false);

        jest.advanceTimersByTime(POSTGAME_TIMEOUT_MS + 2000);
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('postgame timer cancelled when joining a new game', () => {
        const socket = createMockSocket();
        startPostgameTimer(socket);

        cancelPostgameTimer(socket.id);

        jest.advanceTimersByTime(POSTGAME_TIMEOUT_MS + 2000);
        expect(socket.disconnect).not.toHaveBeenCalled();
    });
});

describe('Idle Timeout - clearAllTimers', () => {
    test('clears both lobby and postgame timers on disconnect', () => {
        const socket = createMockSocket();
        startLobbyTimer(socket);
        startPostgameTimer(socket);

        expect(lobbyTimers.has(socket.id)).toBe(true);
        expect(postgameTimers.has(socket.id)).toBe(true);

        clearAllTimers(socket.id);

        expect(lobbyTimers.has(socket.id)).toBe(false);
        expect(postgameTimers.has(socket.id)).toBe(false);

        // Neither should fire
        jest.advanceTimersByTime(POSTGAME_TIMEOUT_MS + 2000);
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('clearAllTimers is safe to call when no timers exist', () => {
        expect(() => clearAllTimers('nonexistent-socket')).not.toThrow();
    });
});

describe('Idle Timeout - Memory leak prevention', () => {
    test('timer map does not leak after disconnect cleanup', () => {
        const sockets = [];
        for (let i = 0; i < 100; i++) {
            const s = createMockSocket(`socket-${i}`);
            sockets.push(s);
            startLobbyTimer(s);
        }
        expect(lobbyTimers.size).toBe(100);

        // Simulate all disconnecting
        for (const s of sockets) {
            clearAllTimers(s.id);
        }
        expect(lobbyTimers.size).toBe(0);
        expect(postgameTimers.size).toBe(0);
    });

    test('timer map stays bounded - old timers replaced on restart', () => {
        const socket = createMockSocket();

        // Start lobby timer 10 times (simulating repeated activity)
        for (let i = 0; i < 10; i++) {
            startLobbyTimer(socket);
        }
        // Should only have 1 entry
        expect(lobbyTimers.size).toBe(1);
    });
});

describe('Idle Timeout - Constants', () => {
    test('LOBBY_TIMEOUT_MS defaults to 5 minutes', () => {
        // In test env, env vars are not set so defaults apply
        expect(LOBBY_TIMEOUT_MS).toBe(5 * 60 * 1000);
    });

    test('POSTGAME_TIMEOUT_MS defaults to 30 minutes', () => {
        expect(POSTGAME_TIMEOUT_MS).toBe(30 * 60 * 1000);
    });
});
