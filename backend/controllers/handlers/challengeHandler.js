/**
 * Challenge link handler — create and join challenge rooms via shareable links.
 * Handles: create_challenge, join_challenge
 *
 * Flow:
 * 1. Player A emits create_challenge → gets a challengeId, room is created waiting for P2
 * 2. Player B visits /play/:username → emits join_challenge → joins the room
 * 3. Game starts when both connected
 */
const {
    gameStore,
    sanitizeUsername,
    sanitizeAvatar,
    generateSessionToken,
    generateUniqueGameId,
    countFilledPlayers,
    buildGameStateWithPlayers,
    getPlayersList,
    persistGame,
    initializeGameState,
    PLAYER_COLORS,
    DISCONNECT_TIMEOUT_MS,
    promMetrics,
} = require('./shared');

// In-memory challenge store: challengerUsername → { gameId, challengerUsername, socketId, createdAt }
// Challenges expire after 10 minutes
const challengeStore = new Map();
const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Clean up expired challenges periodically */
const _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, challenge] of challengeStore) {
        if (now - challenge.createdAt > CHALLENGE_TTL_MS) {
            challengeStore.delete(key);
        }
    }
}, 60_000); // Check every minute
_cleanupTimer.unref(); // Don't keep process alive for cleanup

/**
 * Register challenge socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    // ── create_challenge ──────────────────────────────────────────────────
    socket.on('create_challenge', async (rawPayload, callback) => {
        try {
            if (rateLimited('create_game')) return; // Reuse create_game rate limit
            if (!callback || typeof callback !== 'function') return;

            const { username, avatar } = rawPayload || {};

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) {
                callback({ error: uResult.error });
                return;
            }
            const cleanUsername = uResult.value;
            const cleanAvatar = sanitizeAvatar(avatar);

            // Generate a game room for this challenge (2P, 3×3)
            const gameId = await generateUniqueGameId();
            if (!gameId) {
                callback({ error: 'Failed to create challenge. Please try again.' });
                return;
            }

            const gridSize = 3;
            const playerCount = 2;
            const initialState = initializeGameState(gridSize, playerCount);
            initialState.moveCount = 0;

            const sessionToken = generateSessionToken();

            const game = {
                id: gameId,
                gridSize,
                playerCount,
                players: {
                    player1: {
                        id: socket.id,
                        username: cleanUsername,
                        avatar: cleanAvatar,
                        color: PLAYER_COLORS.player1,
                        token: sessionToken,
                        disconnectedAt: null,
                    },
                },
                gameState: initialState,
                createdAt: Date.now(),
                metadata: {
                    reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                    challenge: true,
                    challengerUsername: cleanUsername,
                },
                cpuDifficulty: null,
            };

            await gameStore.setGame(gameId, game);
            socket.join(gameId);
            socket.data.gameId = gameId;
            socket.data.playerId = 'player1';
            socket.data.username = cleanUsername;

            // Store challenge mapping
            challengeStore.set(cleanUsername.toLowerCase(), {
                gameId,
                challengerUsername: cleanUsername,
                socketId: socket.id,
                createdAt: Date.now(),
            });

            await persistGame(game, 'waiting');
            log.info('Challenge created', { gameId, username: cleanUsername });

            // Emit game_started so the challenger's client knows about the room
            socket.emit('game_started', {
                gameId,
                playerId: 'player1',
                sessionToken,
                gridSize,
                playerCount,
                players: getPlayersList(game),
                gameState: buildGameStateWithPlayers(game),
                cpuDifficulty: null,
            });

            callback({
                gameId,
                challengeId: gameId,
                challengerUsername: cleanUsername,
                sessionToken,
            });

            if (promMetrics?.gamesCreated) promMetrics.gamesCreated.inc({ mode: 'challenge' });
        } catch (error) {
            log.error('Error creating challenge', { error: error.message, stack: error.stack });
            if (callback) callback({ error: 'Failed to create challenge' });
        }
    });

    // ── join_challenge ────────────────────────────────────────────────────
    socket.on('join_challenge', async (rawPayload, callback) => {
        try {
            if (rateLimited('join_game')) return; // Reuse join_game rate limit
            if (!callback || typeof callback !== 'function') return;

            const { challengerUsername, username, avatar } = rawPayload || {};

            if (!challengerUsername) {
                callback({ error: 'Challenger username is required' });
                return;
            }

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) {
                callback({ error: uResult.error });
                return;
            }
            const cleanUsername = uResult.value;
            const cleanAvatar = sanitizeAvatar(avatar);

            // Look up the challenge
            const challenge = challengeStore.get(challengerUsername.toLowerCase());
            if (!challenge) {
                callback({ error: 'Challenge not found or expired. Ask your friend to create a new one.' });
                return;
            }

            // Check TTL
            if (Date.now() - challenge.createdAt > CHALLENGE_TTL_MS) {
                challengeStore.delete(challengerUsername.toLowerCase());
                callback({ error: 'This challenge has expired. Ask your friend to create a new one.' });
                return;
            }

            const gameId = challenge.gameId;
            const game = await gameStore.getGame(gameId);
            if (!game) {
                challengeStore.delete(challengerUsername.toLowerCase());
                callback({ error: 'Challenge room no longer exists. Ask your friend to create a new one.' });
                return;
            }

            // Check if game is already full
            const filled = countFilledPlayers(game);
            if (filled >= game.playerCount) {
                callback({ error: 'This challenge is already full.' });
                return;
            }

            // Find the next open slot
            let assignedSlot = null;
            for (let i = 1; i <= game.playerCount; i++) {
                const slotKey = `player${i}`;
                if (!game.players[slotKey]) {
                    assignedSlot = slotKey;
                    break;
                }
            }

            if (!assignedSlot) {
                callback({ error: 'No open slots available.' });
                return;
            }

            const sessionToken = generateSessionToken();
            game.players[assignedSlot] = {
                id: socket.id,
                username: cleanUsername,
                avatar: cleanAvatar,
                color: PLAYER_COLORS[assignedSlot],
                token: sessionToken,
                disconnectedAt: null,
            };

            await gameStore.setGame(gameId, game);
            socket.join(gameId);
            socket.data.gameId = gameId;
            socket.data.playerId = assignedSlot;
            socket.data.username = cleanUsername;

            const newFilled = countFilledPlayers(game);
            const isFull = newFilled === game.playerCount;
            await persistGame(game, isFull ? 'playing' : 'waiting');

            log.info('Challenge joined', { gameId, username: cleanUsername, slot: assignedSlot });

            const gameStateWithPlayers = buildGameStateWithPlayers(game);

            // Notify joiner
            socket.emit('game_started', {
                gameId,
                playerId: assignedSlot,
                sessionToken,
                gridSize: game.gridSize,
                playerCount: game.playerCount,
                players: getPlayersList(game),
                gameState: gameStateWithPlayers,
                cpuDifficulty: game.cpuDifficulty,
            });

            // Notify all players in room (including challenger)
            io.to(gameId).emit('lobby_state', {
                gameId,
                slots: getPlayersList(game),
                filled: newFilled,
                playerCount: game.playerCount,
            });

            if (isFull) {
                io.to(gameId).emit('all_players_joined', { gameId });
                // Clean up challenge from store
                challengeStore.delete(challengerUsername.toLowerCase());
            }

            callback({
                success: true,
                gameId,
                playerId: assignedSlot,
                sessionToken,
                challengerUsername: challenge.challengerUsername,
                gridSize: game.gridSize,
                playerCount: game.playerCount,
            });
        } catch (error) {
            log.error('Error joining challenge', { error: error.message, stack: error.stack });
            if (callback) callback({ error: 'Failed to join challenge' });
        }
    });
}

module.exports = { register, challengeStore };
