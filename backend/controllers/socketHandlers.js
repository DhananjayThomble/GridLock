/**
 * Socket.IO event handler orchestrator.
 * Wires individual handler modules to socket events via a thin connection wrapper.
 *
 * Handler modules:
 *   - handlers/gameHandler.js       — game creation, joining, lobby state, game start
 *   - handlers/moveHandler.js       — move processing, turn logic, CPU moves, rematch
 *   - handlers/tournamentHandler.js — tournament bracket, matchmaking, lifecycle
 *   - handlers/chatHandler.js       — in-game chat, emoji reactions
 *   - handlers/disconnectHandler.js — disconnect/reconnect, leave game, cleanup
 *   - handlers/spectatorHandler.js  — spectator join/leave (within gameHandler), future events
 *   - handlers/matchmakingHandler.js — quick play, queue management
 *   - handlers/rankedHandler.js     — ranked queue, ELO, ranked game lifecycle
 */
const shared = require('./handlers/shared');
const gameHandler = require('./handlers/gameHandler');
const moveHandler = require('./handlers/moveHandler');
const tournamentHandler = require('./handlers/tournamentHandler');
const chatHandler = require('./handlers/chatHandler');
const disconnectHandler = require('./handlers/disconnectHandler');
const spectatorHandler = require('./handlers/spectatorHandler');
const matchmakingHandler = require('./handlers/matchmakingHandler');
const rankedHandler = require('./handlers/rankedHandler');
const challengeHandler = require('./handlers/challengeHandler');

// ── Cross-handler dependency wiring ──────────────────────────────────────────
// Some handlers need functions from other handlers (circular deps).
// We resolve this by setting function refs after all modules are loaded.
gameHandler.setScheduleCPUMove(moveHandler.scheduleCPUMove);
gameHandler.setHandleTournamentGameCompletion(tournamentHandler.handleTournamentGameCompletion);
gameHandler.setHandleRankedDisconnect(rankedHandler.handleRankedDisconnect);

moveHandler.setHandleTournamentGameCompletion(tournamentHandler.handleTournamentGameCompletion);
moveHandler.setHandleRankedGameEnd(rankedHandler.handleRankedGameEnd);

matchmakingHandler.setScheduleCPUMove(moveHandler.scheduleCPUMove);

disconnectHandler.setScheduleCPUMove(moveHandler.scheduleCPUMove);
disconnectHandler.setHandleTournamentGameCompletion(tournamentHandler.handleTournamentGameCompletion);
disconnectHandler.setHandleRankedDisconnect(rankedHandler.handleRankedDisconnect);
disconnectHandler.setRemoveFromRankedQueue(rankedHandler.removeFromRankedQueue);

function attachSocketHandlers(io, log) {
    shared.restoreActiveGames(log);

    io.on('connection', (socket) => {
        log.info('New client connected:', socket.id);

        // Use the raw transport address - NOT x-forwarded-for, which clients can spoof.
        // Socket.IO doesn't inherit Express's trust-proxy settings, so XFF is unvalidated.
        // If deployed behind a known reverse proxy, configure TRUSTED_PROXY_IPS env var
        // and only then fall back to XFF for the real client IP.
        const rawAddr = socket.conn?.remoteAddress || socket.handshake?.address || 'unknown';
        const trustedProxies = process.env.TRUSTED_PROXY_IPS ? process.env.TRUSTED_PROXY_IPS.split(',').map(s => s.trim()).filter(Boolean) : [];
        const socketIP = shared.normalizeIp(
            (trustedProxies.length > 0 && trustedProxies.includes(rawAddr))
                ? (socket.handshake?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || rawAddr)
                : rawAddr
        );

        const rateLimited = (eventName) => {
            if (!shared.socketLimiter.allow(socket.id, eventName)) {
                log.warn('Rate limited socket event', { socketId: socket.id, eventName });
                socket.emit('error', 'Too many requests. Please slow down.');
                return true;
            }
            // IP-based rate limiting for abuse-prone events
            if (!shared.ipLimiter.allow(socketIP, eventName)) {
                log.warn('IP rate limited socket event', { ip: socketIP, eventName });
                socket.emit('error', 'Too many requests from your network. Please slow down.');
                return true;
            }
            return false;
        };

        /**
         * Validate and sanitize a socket event payload.
         * Returns the validated payload or null (with error emitted).
         * Detailed validation errors are logged server-side only; clients get generic messages.
         */
        const validate = (eventName, payload) => {
            const result = shared.validatePayload(eventName, payload);
            if (!result.valid) {
                log.warn('Payload validation failed', { socketId: socket.id, eventName, error: result.detailedError || result.error });
                socket.emit('error', result.error);
                return null;
            }
            return result.value;
        };

        // Register all handler modules
        tournamentHandler.register(io, socket, log, rateLimited, validate);
        gameHandler.register(io, socket, log, rateLimited, validate);
        moveHandler.register(io, socket, log, rateLimited, validate);
        matchmakingHandler.register(io, socket, log, rateLimited, validate);
        rankedHandler.register(io, socket, log, rateLimited, validate);
        chatHandler.register(io, socket, log, rateLimited, validate);
        spectatorHandler.register(io, socket, log, rateLimited, validate);
        challengeHandler.register(io, socket, log, rateLimited, validate);
        disconnectHandler.register(io, socket, log, rateLimited, validate);
    });

    return { gameStore: shared.gameStore, rematchStore: shared.rematchStore, disconnectStore: shared.disconnectStore, localTimers: shared.localTimers };
}

module.exports = attachSocketHandlers;

// Preserve _internal exports for tests
module.exports._internal = {
    isSpectatorJoinRequest: shared.isSpectatorJoinRequest,
    initializeBracket: tournamentHandler.initializeBracket,
    buildTournamentSnapshot: tournamentHandler.buildTournamentSnapshot,
    sanitizeTournamentId: tournamentHandler.sanitizeTournamentId,
    generateTournamentId: tournamentHandler.generateTournamentId,
    getTournamentJoinError: tournamentHandler.getTournamentJoinError,
    applyTournamentMatchResult: tournamentHandler.applyTournamentMatchResult,
    scheduleCPUMove: moveHandler.scheduleCPUMove,
    rankedQueue: shared.rankedQueue,
    rankedQueueIndex: shared.rankedQueueIndex,
    rankedGameMap: shared.rankedGameMap,
    removeFromRankedQueue: rankedHandler.removeFromRankedQueue,
    activeDailyGames: shared.activeDailyGames,
    chatRateLimiter: shared.chatRateLimiter,
    recordGameHistory: shared.recordGameHistory,
};
