// backend/middleware/idleTimeout.js
// Two-tier idle socket timeout: lobby (5min) and post-game (30min)
// Disconnects inactive sockets to free resources (#390)

const LOBBY_TIMEOUT_MS = parseInt(process.env.IDLE_LOBBY_TIMEOUT_MS, 10) || 5 * 60 * 1000;
const POSTGAME_TIMEOUT_MS = parseInt(process.env.IDLE_POSTGAME_TIMEOUT_MS, 10) || 30 * 60 * 1000;

// Maps: socketId → timeout handle
const lobbyTimers = new Map();
const postgameTimers = new Map();
const graceTimers = new Map();

// Events that indicate game activity — cancel idle timers on any of these
const ACTIVITY_EVENTS = ['create_game', 'join_game', 'join_tournament', 'queue_join'];

/**
 * Start a lobby idle timer for a newly connected socket.
 * If the socket doesn't join/create a game within LOBBY_TIMEOUT_MS,
 * it gets disconnected with reason 'idle_timeout_lobby'.
 *
 * @param {object} socket - Socket.IO socket instance
 */
function startLobbyTimer(socket) {
    cancelLobbyTimer(socket.id);

    const timer = setTimeout(() => {
        lobbyTimers.delete(socket.id);
        if (socket.connected) {
            socket.emit('idle_timeout', { reason: 'lobby', timeoutMs: LOBBY_TIMEOUT_MS });
            // Give client 1s to receive the event before disconnecting
            const graceTimer = setTimeout(() => {
                graceTimers.delete(socket.id);
                if (socket.connected) {
                    socket.disconnect(true);
                }
            }, 1000);
            if (graceTimer.unref) graceTimer.unref();
            graceTimers.set(socket.id, graceTimer);
        }
    }, LOBBY_TIMEOUT_MS);

    // Don't prevent Node from exiting for idle timers
    if (timer.unref) timer.unref();

    lobbyTimers.set(socket.id, timer);
}

/**
 * Cancel the lobby idle timer for a socket.
 * @param {string} socketId
 */
function cancelLobbyTimer(socketId) {
    const timer = lobbyTimers.get(socketId);
    if (timer) {
        clearTimeout(timer);
        lobbyTimers.delete(socketId);
    }
}

/**
 * Start a post-game idle timer for a socket.
 * If the player doesn't start a new game within POSTGAME_TIMEOUT_MS,
 * they get disconnected with reason 'idle_timeout_postgame'.
 *
 * @param {object} socket - Socket.IO socket instance
 */
function startPostgameTimer(socket) {
    cancelPostgameTimer(socket.id);

    const timer = setTimeout(() => {
        postgameTimers.delete(socket.id);
        if (socket.connected) {
            socket.emit('idle_timeout', { reason: 'postgame', timeoutMs: POSTGAME_TIMEOUT_MS });
            const graceTimer = setTimeout(() => {
                graceTimers.delete(socket.id);
                if (socket.connected) {
                    socket.disconnect(true);
                }
            }, 1000);
            if (graceTimer.unref) graceTimer.unref();
            graceTimers.set(socket.id, graceTimer);
        }
    }, POSTGAME_TIMEOUT_MS);

    if (timer.unref) timer.unref();

    postgameTimers.set(socket.id, timer);
}

/**
 * Cancel the post-game idle timer for a socket.
 * @param {string} socketId
 */
function cancelPostgameTimer(socketId) {
    const timer = postgameTimers.get(socketId);
    if (timer) {
        clearTimeout(timer);
        postgameTimers.delete(socketId);
    }
}

/**
 * Cancel the grace timeout for a socket.
 * @param {string} socketId
 */
function cancelGraceTimer(socketId) {
    const timer = graceTimers.get(socketId);
    if (timer) {
        clearTimeout(timer);
        graceTimers.delete(socketId);
    }
}

/**
 * Clear all idle timers for a socket (lobby + postgame + grace).
 * Call on disconnect to prevent memory leaks.
 * @param {string} socketId
 */
function clearAllTimers(socketId) {
    cancelLobbyTimer(socketId);
    cancelPostgameTimer(socketId);
    cancelGraceTimer(socketId);
}

module.exports = {
    LOBBY_TIMEOUT_MS,
    POSTGAME_TIMEOUT_MS,
    ACTIVITY_EVENTS,
    lobbyTimers,
    postgameTimers,
    graceTimers,
    startLobbyTimer,
    cancelLobbyTimer,
    startPostgameTimer,
    cancelPostgameTimer,
    cancelGraceTimer,
    clearAllTimers,
};
