/**
 * In-game chat and emoji reaction handlers.
 * Handles: game_chat
 */
const {
    gameStore,
    sanitizeGameId,
    findPlayerBySocket,
    loadGameFromDB,
    chatRateLimiter,
    ALLOWED_CHAT_CONTENT,
    ALLOWED_EMOJIS,
} = require('./shared');

/**
 * Register chat socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    socket.on('game_chat', async (rawPayload) => {
        try {
            if (rateLimited('game_chat')) return;
            const validated = validate('game_chat', rawPayload);
            if (!validated) return;
            const { gameId, content } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            if (!ALLOWED_CHAT_CONTENT.has(content)) {
                socket.emit('error', 'Invalid chat message');
                return;
            }

            let game = await gameStore.getGame(cleanGameId);
            if (!game) {
                game = await loadGameFromDB(cleanGameId, log);
                if (!game) { socket.emit('error', 'Game not found'); return; }
            }

            if (game.gameState?.winner || game.gameState?.gameOver) {
                socket.emit('error', 'Game has ended');
                return;
            }

            if (socket.data?.isSpectator) {
                socket.emit('error', 'Spectators cannot send chat messages');
                return;
            }

            const playerId = findPlayerBySocket(game, socket.id);
            if (!playerId) {
                socket.emit('error', 'You are not a player in this game');
                return;
            }

            if (!chatRateLimiter.allow(socket.id)) {
                socket.emit('error', 'Chat rate limited. Please slow down.');
                return;
            }

            const player = game.players[playerId];
            const playerIndex = parseInt(playerId.replace('player', ''), 10) - 1;
            const type = ALLOWED_EMOJIS.includes(content) ? 'emoji' : 'quick';

            io.to(cleanGameId).emit('game_chat_received', {
                playerId,
                username: player.username,
                avatar: player.avatar,
                playerIndex,
                type,
                content,
                timestamp: Date.now(),
            });
        } catch (error) {
            log.error('Error processing game_chat', { error: error.message });
            socket.emit('error', 'Failed to send chat message');
        }
    });
}

module.exports = { register };
