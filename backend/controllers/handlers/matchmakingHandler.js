/**
 * Quick Play matchmaking and game invite handlers.
 * Handles: queue_join, queue_leave, send_game_invite
 */
const {
    gameStore,
    matchmaking,
    sanitizeUsername,
    sanitizeAvatar,
    sanitizeGameId,
    validateNumber,
    cancelLobbyTimer,
    cancelPostgameTimer,
    generateSessionToken,
    generateUniqueGameId,
    countFilledPlayers,
    buildGameStateWithPlayers,
    getPlayersList,
    findPlayerBySocket,
    persistGame,
    loadGameFromDB,
    inviteSenderLimiter,
    PLAYER_COLORS,
    DISCONNECT_TIMEOUT_MS,
    initializeGameState,
    CPU_NAMES,
    CPU_AVATARS,
    CPU_DELAYS,
    QUEUE_TIMEOUT_MS,
    sendPushToUser,
} = require('./shared');

// Forward declaration - set after all handlers are loaded
let scheduleCPUMove = null;
function setScheduleCPUMove(fn) { scheduleCPUMove = fn; }

/**
 * Register matchmaking socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    // ── queue_join (Quick Play matchmaking) ──────────────────────────────
    socket.on('queue_join', async (rawPayload) => {
        try {
            if (rateLimited('queue_join')) return;
            cancelLobbyTimer(socket.id);
            cancelPostgameTimer(socket.id);
            const validated = validate('queue_join', rawPayload);
            if (!validated) return;
            const { username, avatar, gridSize, playerCount } = validated;

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) { socket.emit('error', uResult.error); return; }
            const cleanUsername = uResult.value;
            const cleanAvatar = sanitizeAvatar(avatar);

            const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
            if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

            const pcResult = validateNumber(playerCount, 2, 4, 'Player count');
            if (!pcResult.valid) { socket.emit('error', pcResult.error); return; }

            const result = matchmaking.joinQueue(socket.id, cleanUsername, cleanAvatar, gridResult.value, pcResult.value);

            if (result.rejected) {
                socket.emit('error', result.reason);
                return;
            }

            if (result.matched) {
                const players = result.players;
                const connected = [];
                const disconnected = [];
                for (const p of players) {
                    const s = io.sockets.sockets.get(p.socketId);
                    if (s && s.connected) {
                        connected.push(p);
                    } else {
                        disconnected.push(p);
                    }
                }

                if (disconnected.length > 0) {
                    for (const p of connected) {
                        const requeue = matchmaking.joinQueue(p.socketId, p.username, p.avatar, p.gridSize, p.playerCount);
                        const ps = io.sockets.sockets.get(p.socketId);
                        if (ps && requeue.queued) {
                            ps.data.queueKey = requeue.queueKey;
                            ps.emit('queue_status', { position: requeue.position, queueSize: requeue.queueSize, queueKey: requeue.queueKey, queueCounts: matchmaking.getAllQueueCounts() });
                            const timer = setTimeout(() => {
                                if (matchmaking.isInQueue(p.socketId)) {
                                    ps.emit('queue_timeout', { suggestion: 'cpu' });
                                }
                            }, QUEUE_TIMEOUT_MS);
                            matchmaking.setTimeoutTimer(p.socketId, timer);
                        }
                    }
                    log.info('Matched player disconnected before game creation, re-queued remaining', {
                        disconnected: disconnected.map(p => p.username),
                        requeued: connected.map(p => p.username),
                    });
                    return;
                }

                const host = players[0];
                const gameId = await generateUniqueGameId();
                if (!gameId) { socket.emit('error', 'Failed to generate game ID'); return; }
                const initialState = initializeGameState(host.gridSize, host.playerCount);

                const game = {
                    id: gameId,
                    gridSize: host.gridSize,
                    playerCount: host.playerCount,
                    players: {},
                    gameState: initialState,
                    createdAt: Date.now(),
                    matchType: 'public',
                    metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
                };

                for (let i = 0; i < players.length; i++) {
                    const slot = `player${i + 1}`;
                    const p = players[i];
                    const token = generateSessionToken();
                    game.players[slot] = {
                        id: p.socketId,
                        username: p.username,
                        avatar: p.avatar,
                        color: PLAYER_COLORS[slot],
                        token,
                        disconnectedAt: null,
                    };
                }

                const slotIds = Object.values(game.players).map((p) => p.id);
                if (new Set(slotIds).size !== slotIds.length) {
                    log.error('Self-match guard triggered in Quick Play - re-queuing affected players', { gameId, slotIds });
                    for (const p of players) {
                        const ps = io.sockets.sockets.get(p.socketId);
                        if (ps && ps.connected) {
                            const requeue = matchmaking.joinQueue(p.socketId, p.username, p.avatar, p.gridSize, p.playerCount);
                            if (requeue.queued) {
                                ps.data.queueKey = requeue.queueKey;
                                ps.emit('queue_status', { position: requeue.position, queueSize: requeue.queueSize, queueKey: requeue.queueKey, queueCounts: matchmaking.getAllQueueCounts() });
                                const timer = setTimeout(() => {
                                    if (matchmaking.isInQueue(p.socketId)) {
                                        ps.emit('queue_timeout', { suggestion: 'cpu' });
                                    }
                                }, QUEUE_TIMEOUT_MS);
                                matchmaking.setTimeoutTimer(p.socketId, timer);
                            }
                        }
                    }
                    return;
                }

                await gameStore.setGame(gameId, game);
                await persistGame(game, game.playerCount === players.length ? 'playing' : 'waiting');

                for (let i = 0; i < players.length; i++) {
                    const slot = `player${i + 1}`;
                    const p = players[i];
                    const playerSocket = io.sockets.sockets.get(p.socketId);
                    if (playerSocket) {
                        playerSocket.join(gameId);
                        playerSocket.data.gameId = gameId;
                        playerSocket.data.playerId = slot;
                        playerSocket.data.queueKey = undefined;
                        playerSocket.data.username = p.username;

                        const gameStateWithPlayers = buildGameStateWithPlayers(game);
                        playerSocket.emit('queue_matched', {
                            gameId,
                            playerId: slot,
                            sessionToken: game.players[slot].token,
                            gridSize: game.gridSize,
                            playerCount: game.playerCount,
                            players: getPlayersList(game),
                            gameState: gameStateWithPlayers,
                        });
                    }
                }

                if (players.length === game.playerCount) {
                    io.to(gameId).emit('all_players_joined', { gameId });
                }

                for (const p of players) {
                    try {
                        sendPushToUser(p.username, {
                            title: '⚡ Match Found!',
                            body: 'Your Quick Play match is ready!',
                            url: `/join/${gameId}`,
                            tag: `quickplay-${gameId}`,
                        }).catch(() => {});
                    } catch (_) { /* push is best-effort */ }
                }

                log.info('Quick Play match created', { gameId, playerCount: game.playerCount, players: players.map((p) => p.username) });
            } else {
                socket.data.queueKey = result.queueKey;
                socket.data.username = cleanUsername;

                const waiters = matchmaking.getWaiters(result.queueKey);
                for (const waiterId of waiters) {
                    const waiterSocket = io.sockets.sockets.get(waiterId);
                    if (waiterSocket) {
                        const status = matchmaking.getQueueStatus(waiterId);
                        if (status) {
                            waiterSocket.emit('queue_status', {
                                position: status.position,
                                queueSize: status.queueSize,
                                queueKey: status.queueKey,
                                queueCounts: matchmaking.getAllQueueCounts(),
                            });
                        }
                    }
                }

                const timeoutTimer = setTimeout(async () => {
                    try {
                        if (!matchmaking.isInQueue(socket.id)) return;

                        const qStatus = matchmaking.getQueueStatus(socket.id);
                        if (!qStatus) return;
                        const qKey = qStatus.queueKey;
                        const queueArr = matchmaking.queues.get(qKey);
                        const entry = queueArr?.find((e) => e.socketId === socket.id);
                        if (!entry) return;

                        const pGridSize = entry.gridSize;
                        const pPlayerCount = entry.playerCount;
                        const pUsername = entry.username;
                        const pAvatar = entry.avatar;

                        matchmaking.leaveQueue(socket.id);

                        const cpuGameId = await generateUniqueGameId();
                        if (!cpuGameId) { socket.emit('error', 'Failed to generate game ID'); return; }
                        const cpuInitialState = initializeGameState(pGridSize, pPlayerCount);
                        const cpuSessionToken = generateSessionToken();
                        const cpuDifficulty = 'medium';

                        const cpuGame = {
                            id: cpuGameId,
                            gridSize: pGridSize,
                            playerCount: pPlayerCount,
                            players: {
                                player1: {
                                    id: socket.id,
                                    username: pUsername,
                                    avatar: pAvatar,
                                    color: PLAYER_COLORS.player1,
                                    token: cpuSessionToken,
                                    disconnectedAt: null,
                                },
                            },
                            gameState: cpuInitialState,
                            createdAt: Date.now(),
                            metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS },
                            cpuDifficulty,
                        };

                        for (let ci = 1; ci < pPlayerCount; ci++) {
                            const cpuSlot = `player${ci + 1}`;
                            cpuGame.players[cpuSlot] = {
                                id: `cpu-${cpuGameId}-${ci - 1}`,
                                username: CPU_NAMES[ci - 1] || `Bot-${ci}`,
                                avatar: CPU_AVATARS[ci - 1] || '🤖',
                                color: PLAYER_COLORS[cpuSlot],
                                token: `cpu-token-${cpuGameId}-${ci - 1}`,
                                disconnectedAt: null,
                                isCPU: true,
                            };
                        }

                        await gameStore.setGame(cpuGameId, cpuGame);
                        socket.join(cpuGameId);
                        socket.data.gameId = cpuGameId;
                        socket.data.playerId = 'player1';
                        socket.data.queueKey = undefined;
                        socket.data.username = cleanUsername;

                        await persistGame(cpuGame, 'playing');

                        const cpuGameState = buildGameStateWithPlayers(cpuGame);
                        socket.emit('queue_matched', {
                            gameId: cpuGameId,
                            playerId: 'player1',
                            sessionToken: cpuSessionToken,
                            gridSize: cpuGame.gridSize,
                            playerCount: cpuGame.playerCount,
                            players: getPlayersList(cpuGame),
                            gameState: cpuGameState,
                            cpuDifficulty: cpuGame.cpuDifficulty,
                        });

                        io.to(cpuGameId).emit('all_players_joined', { gameId: cpuGameId });

                        const firstCpuPlayer = cpuGame.players[cpuGame.gameState.currentPlayer];
                        if (firstCpuPlayer && firstCpuPlayer.isCPU) {
                            const cpuDelay = CPU_DELAYS[cpuDifficulty] || 1200;
                            scheduleCPUMove(io, log, cpuGameId, cpuDelay);
                        }

                        log.info('Quick Play timeout - CPU game created', { gameId: cpuGameId, username: pUsername, cpuSlots: pPlayerCount - 1 });
                    } catch (err) {
                        log.error('Quick Play timeout CPU fallback failed', { error: err.message, stack: err.stack });
                        socket.emit('queue_timeout', { suggestion: 'cpu' });
                    }
                }, QUEUE_TIMEOUT_MS);
                matchmaking.setTimeoutTimer(socket.id, timeoutTimer);
            }
        } catch (error) {
            log.error('Error handling queue_join', { error: error.message, stack: error.stack });
            socket.emit('error', 'Failed to join matchmaking queue');
        }
    });

    // ── send_game_invite ──────────────────────────────────────────────────
    socket.on('send_game_invite', async (rawPayload) => {
        try {
            if (rateLimited('send_game_invite')) return;
            const validated = validate('send_game_invite', rawPayload);
            if (!validated) return;
            const { gameId, targetUsername } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const toResult = sanitizeUsername(targetUsername);
            if (!toResult.valid) { socket.emit('error', toResult.error); return; }

            let game = await gameStore.getGame(cleanGameId);
            if (!game) {
                game = await loadGameFromDB(cleanGameId, log);
                if (!game) { socket.emit('error', 'Game not found'); return; }
            }

            const filled = countFilledPlayers(game);
            if (filled >= game.playerCount) {
                socket.emit('error', 'Game is already full');
                return;
            }

            const senderPlayerId = findPlayerBySocket(game, socket.id);
            if (!senderPlayerId) {
                socket.emit('error', 'You are not a player in this game');
                return;
            }
            const senderUsername = game.players[senderPlayerId].username;

            if (!inviteSenderLimiter.allow(socket.id)) {
                socket.emit('error', 'Too many invites sent. Please slow down.');
                return;
            }

            if (toResult.value === senderUsername) {
                socket.emit('error', 'Cannot invite yourself');
                return;
            }

            sendPushToUser(toResult.value, {
                title: '🎮 Game Invite!',
                body: `${senderUsername} invited you to play!`,
                url: `/join/${cleanGameId}`,
                tag: `invite-${cleanGameId}`,
            }).catch(() => {});

            socket.emit('invite_sent', { targetUsername: toResult.value });
        } catch (error) {
            log.error('Error sending game invite push', { error: error.message });
            socket.emit('error', 'Failed to send invite');
        }
    });

    // ── queue_leave ────────────────────────────────────────────────────────
    socket.on('queue_leave', () => {
        if (rateLimited('queue_leave')) return;

        const info = matchmaking.playerIndex.get(socket.id);
        const queueKey = info?.queueKey;
        matchmaking.leaveQueue(socket.id);
        socket.data.queueKey = undefined;
        socket.emit('queue_left', {});

        if (queueKey) {
            const waiters = matchmaking.getWaiters(queueKey);
            for (const waiterId of waiters) {
                const waiterSocket = io.sockets.sockets.get(waiterId);
                if (waiterSocket) {
                    const status = matchmaking.getQueueStatus(waiterId);
                    if (status) {
                        waiterSocket.emit('queue_status', {
                            position: status.position,
                            queueSize: status.queueSize,
                            queueKey: status.queueKey,
                            queueCounts: matchmaking.getAllQueueCounts(),
                        });
                    }
                }
            }
        }
    });
}

module.exports = {
    register,
    setScheduleCPUMove,
};
