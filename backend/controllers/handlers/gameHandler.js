/**
 * Game creation, joining, lobby state, and game start handlers.
 * Handles: create_game, join_game, lobby_state, replace_with_cpu, start_game_early, start_game
 */
const {
    gameStore,
    rematchStore,
    disconnectStore,
    sanitizeUsername,
    sanitizeAvatar,
    sanitizeGameId,
    validateNumber,
    cancelLobbyTimer,
    cancelPostgameTimer,
    startPostgameTimer,
    generateSessionToken,
    generateUniqueGameId,
    countFilledPlayers,
    countCPUPlayers,
    isSpectatorJoinRequest,
    buildGameStateWithPlayers,
    getPlayersList,
    findPlayerBySocket,
    persistGame,
    loadGameFromDB,
    PLAYER_COLORS,
    DISCONNECT_TIMEOUT_MS,
    HOST_START_TIMEOUT_MS,
    hostStartTimers,
    lobbyHostTimers,
    localTimers,
    activeDailyGames,
    initializeGameState,
    CPU_NAMES,
    CPU_AVATARS,
    CPU_DELAYS,
    sendPushToUser,
    isUserOnlineInGame,
    generateBoardFromSeed,
    getTodayDateStr,
    DailyResult,
    promMetrics,
    getNextActivePlayer,
    pickForfeitWinner,
    updateLeaderboard,
    recordGameHistory,
    advanceTurnIfNeeded,
    handleGameOver,
    scheduleGameCleanup,
    CLEANUP_DELAY_MS,
    markGameFinished,
    rematchTimers,
    rankedGameMap,
} = require('./shared');

// Forward declaration - set by socketHandlers.js after all handlers are loaded
let scheduleCPUMove = null;
let handleTournamentGameCompletion = null;
let handleRankedDisconnect = null;

function setScheduleCPUMove(fn) { scheduleCPUMove = fn; }
function setHandleTournamentGameCompletion(fn) { handleTournamentGameCompletion = fn; }
function setHandleRankedDisconnect(fn) { handleRankedDisconnect = fn; }

/**
 * Register game socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    // ── create_game ────────────────────────────────────────────────────────
    socket.on('create_game', async (rawPayload, callback) => {
        try {
            if (rateLimited('create_game')) return;
            cancelLobbyTimer(socket.id);
            cancelPostgameTimer(socket.id);
            const validated = validate('create_game', rawPayload);
            if (!validated) return;
            const { gridSize, username, avatar, playerCount = 2, cpuPlayers = 0, cpuDifficulty = 'medium', dailyChallenge = false, dailySeed = null } = validated;

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) { socket.emit('error', uResult.error); return; }
            const cleanUsername = uResult.value;
            const cleanAvatar = sanitizeAvatar(avatar);

            const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
            if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

            const pcResult = validateNumber(playerCount, 2, 4, 'Player count');
            if (!pcResult.valid) { socket.emit('error', pcResult.error); return; }

            const cpuCount = Math.max(0, Math.min(Math.floor(Number(cpuPlayers) || 0), pcResult.value - 1));
            const validDifficulties = ['easy', 'medium', 'hard'];
            const cleanDifficulty = validDifficulties.includes(cpuDifficulty) ? cpuDifficulty : 'medium';

            // ── Daily challenge replay protection ────────────────────────
            const isDailyChallenge = dailyChallenge === true && dailySeed;
            if (isDailyChallenge) {
                const todayStr = getTodayDateStr();
                if (dailySeed !== todayStr) {
                    socket.emit('error', 'Invalid daily challenge seed');
                    return;
                }

                const existingResult = await DailyResult.findOne({ date: todayStr, username: cleanUsername });
                if (existingResult) {
                    socket.emit('error', 'Already completed today\'s challenge');
                    return;
                }

                if (activeDailyGames.has(cleanUsername)) {
                    socket.emit('error', 'You already have an active daily challenge game');
                    return;
                }
            }

            const gameId = await generateUniqueGameId();
            if (!gameId) { socket.emit('error', 'Failed to generate game ID. Please try again.'); return; }
            const initialState = initializeGameState(gridResult.value, pcResult.value);

            initialState.moveCount = 0;

            if (isDailyChallenge) {
                const board = generateBoardFromSeed(dailySeed, gridResult.value);
                for (let r = 0; r < board.predrawnH.length; r++) {
                    for (let c = 0; c < board.predrawnH[r].length; c++) {
                        if (board.predrawnH[r][c] === 1) {
                            initialState.horizontalLines[r][c] = 'predrawn';
                        }
                    }
                }
                for (let r = 0; r < board.predrawnV.length; r++) {
                    for (let c = 0; c < board.predrawnV[r].length; c++) {
                        if (board.predrawnV[r][c] === 1) {
                            initialState.verticalLines[r][c] = 'predrawn';
                        }
                    }
                }
            }

            const sessionToken = generateSessionToken();

            const game = {
                id: gameId,
                gridSize: gridResult.value,
                playerCount: pcResult.value,
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
                    ...(isDailyChallenge ? { dailyChallenge: true, dailySeed } : {}),
                },
                cpuDifficulty: cpuCount > 0 ? cleanDifficulty : null,
            };

            for (let i = 0; i < cpuCount; i++) {
                const cpuSlot = `player${i + 2}`;
                game.players[cpuSlot] = {
                    id: `cpu-${gameId}-${i}`,
                    username: CPU_NAMES[i] || `Bot-${i + 1}`,
                    avatar: CPU_AVATARS[i] || '🤖',
                    color: PLAYER_COLORS[cpuSlot],
                    token: `cpu-token-${gameId}-${i}`,
                    disconnectedAt: null,
                    isCPU: true,
                };
            }

            await gameStore.setGame(gameId, game);
            socket.join(gameId);
            socket.data.gameId = gameId;
            socket.data.playerId = 'player1';
            socket.data.username = cleanUsername;

            if (isDailyChallenge) {
                activeDailyGames.set(cleanUsername, gameId);
            }

            const filled = countFilledPlayers(game);
            const isFull = filled === game.playerCount;
            await persistGame(game, isFull ? 'playing' : 'waiting');
            log.info('Game created', { gameId, playerCount: game.playerCount, username: cleanUsername, cpuPlayers: cpuCount });

            const gameStateWithPlayers = buildGameStateWithPlayers(game);
            if (!callback) {
                socket.emit('game_created', { gameId, playerId: 'player1', sessionToken });
            }
            socket.emit('game_started', {
                gameId, playerId: 'player1', sessionToken,
                gridSize: game.gridSize, playerCount: game.playerCount,
                players: getPlayersList(game), gameState: gameStateWithPlayers,
                cpuDifficulty: game.cpuDifficulty,
            });

            if (isFull) {
                io.to(gameId).emit('all_players_joined', { gameId });
                const firstPlayer = game.players[game.gameState.currentPlayer];
                if (firstPlayer && firstPlayer.isCPU) {
                    const delay = CPU_DELAYS[cleanDifficulty] || 1200;
                    scheduleCPUMove(io, log, gameId, delay);
                }
            }

            if (callback) callback({ gameId, playerId: 'player1', sessionToken });
        } catch (error) {
            log.error('Error creating game', { error: error.message, stack: error.stack });
            socket.emit('error', 'Failed to create game');
        }
    });

    // ── join_game ──────────────────────────────────────────────────────────
    socket.on('join_game', async (rawPayload) => {
        try {
            if (rateLimited('join_game')) return;
            cancelLobbyTimer(socket.id);
            cancelPostgameTimer(socket.id);
            const validated = validate('join_game', rawPayload);
            if (!validated) return;
            const { gameId, username, avatar, sessionToken, joinMode } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) { socket.emit('error', uResult.error); return; }
            const cleanUsername = uResult.value;
            const cleanAvatar = sanitizeAvatar(avatar);

            let game = await gameStore.getGame(cleanGameId);
            if (!game) {
                game = await loadGameFromDB(cleanGameId, log);
                if (!game) { socket.emit('error', 'Game not found'); return; }
            }

            // Spectator path
            if (isSpectatorJoinRequest(joinMode)) {
                const MAX_SPECTATORS = 20;
                const currentSpectators = await gameStore.getSpectatorCount(cleanGameId);
                if (currentSpectators >= MAX_SPECTATORS) {
                    socket.emit('error', 'Spectator limit reached for this game');
                    return;
                }

                socket.join(cleanGameId);
                socket.data.gameId = cleanGameId;
                socket.data.playerId = 'spectator';
                socket.data.isSpectator = true;
                socket.data.spectatorUsername = cleanUsername;
                socket.data.username = cleanUsername;

                const spectatorCount = await gameStore.adjustSpectatorCount(cleanGameId, +1);
                game.spectatorCount = spectatorCount;
                await gameStore.setGame(cleanGameId, game);

                socket.emit('game_started', {
                    gameId: cleanGameId,
                    playerId: 'spectator',
                    role: 'spectator',
                    gridSize: game.gridSize,
                    playerCount: game.playerCount,
                    players: getPlayersList(game),
                    gameState: buildGameStateWithPlayers(game),
                    spectatorCount: game.spectatorCount,
                });
                io.to(cleanGameId).emit('spectator_count', { count: game.spectatorCount });
                socket.to(cleanGameId).emit('spectator_joined', { username: cleanUsername, count: game.spectatorCount });
                return;
            }

            // Reconnect path
            for (let i = 1; i <= game.playerCount; i++) {
                const playerId = `player${i}`;
                const player = game.players[playerId];
                if (player && player.username === cleanUsername) {
                    // (#483) Only allow rejoin when BOTH username AND session token match.
                    // If tokens don't match, give a clear error explaining why.
                    if (!sessionToken || sessionToken !== player.token) {
                        const isDisconnected = !!player.disconnectedAt;
                        if (isDisconnected) {
                            log.warn('Username collision with disconnected player', { gameId: cleanGameId, playerId, username: cleanUsername });
                            socket.emit('error', 'This username belongs to a disconnected player. Please choose a different name or wait for them to rejoin.');
                        } else {
                            log.warn('Username collision with active player', { gameId: cleanGameId, playerId, username: cleanUsername });
                            socket.emit('error', 'This username is already in use.');
                        }
                        return;
                    }

                    // Check if existing socket is still alive (duplicate tab, not a reconnect)
                    const existingSocketId = player.id;
                    const existingSocket = existingSocketId ? io.sockets.sockets.get(existingSocketId) : null;

                    if (existingSocket && existingSocket.connected && existingSocketId !== socket.id) {
                        // Notify old tab
                        existingSocket.emit('session_conflict', {
                            reason: 'Another tab or window connected with your session',
                            gameId: cleanGameId,
                            playerId,
                        });
                        existingSocket.leave(cleanGameId);
                        existingSocket.data.gameId = undefined;
                        existingSocket.data.playerId = undefined;

                        // Force disconnect after short delay to ensure event is delivered
                        setTimeout(() => {
                            if (existingSocket.connected) existingSocket.disconnect(true);
                        }, 100);

                        log.info('Session conflict: old tab superseded', {
                            gameId: cleanGameId, playerId, oldSocketId: existingSocketId, newSocketId: socket.id
                        });
                    }

                    // A host who returns within the grace period keeps the waiting room open
                    if (playerId === 'player1' && lobbyHostTimers.has(cleanGameId)) {
                        clearTimeout(lobbyHostTimers.get(cleanGameId));
                        lobbyHostTimers.delete(cleanGameId);
                    }

                    // Reassign IMMEDIATELY (synchronous, before any await)
                    player.id = socket.id;
                    player.avatar = cleanAvatar || player.avatar;
                    player.disconnectedAt = null;

                    // Then async operations
                    const timerKey = `${cleanGameId}:${playerId}`;
                    if (localTimers.has(timerKey)) {
                        clearTimeout(localTimers.get(timerKey).timer);
                        localTimers.delete(timerKey);
                    }
                    await disconnectStore.clearDisconnect(cleanGameId, playerId);
                    await gameStore.setGame(cleanGameId, game);
                    socket.join(cleanGameId);
                    socket.data.gameId = cleanGameId;
                    socket.data.playerId = playerId;
                    socket.data.isSpectator = false;
                    socket.data.username = cleanUsername;
                    await persistGame(game);

                    socket.emit('game_started', {
                        gameId: cleanGameId, playerId,
                        sessionToken: player.token,
                        gridSize: game.gridSize, playerCount: game.playerCount,
                        players: getPlayersList(game),
                        gameState: buildGameStateWithPlayers(game),
                    });
                    socket.to(cleanGameId).emit('player_reconnected', { playerId, username: cleanUsername });
                    return;
                }
            }

            // Guard: prevent spectator from escalating to player
            if (socket.data.isSpectator) {
                socket.emit('error', 'Spectators cannot join as players. Leave and rejoin to play.');
                return;
            }

            // New join path
            let assignedSlot = null;
            for (let i = 1; i <= game.playerCount; i++) {
                const pid = `player${i}`;
                if (!game.players[pid]) { assignedSlot = pid; break; }
            }
            if (!assignedSlot) { socket.emit('error', 'Game is full'); return; }

            const newSessionToken = generateSessionToken();
            game.players[assignedSlot] = {
                id: socket.id,
                username: cleanUsername,
                avatar: cleanAvatar,
                color: PLAYER_COLORS[assignedSlot],
                token: newSessionToken,
                disconnectedAt: null,
            };

            socket.join(cleanGameId);
            socket.data.gameId = cleanGameId;
            socket.data.playerId = assignedSlot;
            socket.data.isSpectator = false;
            socket.data.username = cleanUsername;
            const filled = countFilledPlayers(game);
            const cpuCount = countCPUPlayers(game);
            const status = (filled === game.playerCount && cpuCount > 0) ? 'playing' : 'waiting';
            await gameStore.setGame(cleanGameId, game);
            await persistGame(game, status);

            const gameStateWithPlayers = buildGameStateWithPlayers(game);

            io.to(cleanGameId).emit('player_joined', {
                gameId: cleanGameId, slot: assignedSlot,
                username: cleanUsername, avatar: cleanAvatar,
                filled, playerCount: game.playerCount,
            });

            socket.emit('game_started', {
                gameId: cleanGameId, playerId: assignedSlot, sessionToken: newSessionToken,
                gridSize: game.gridSize, playerCount: game.playerCount,
                players: getPlayersList(game), gameState: gameStateWithPlayers,
            });
            socket.to(cleanGameId).emit('game_started', {
                gameId: cleanGameId,
                gridSize: game.gridSize, playerCount: game.playerCount,
                players: getPlayersList(game), gameState: gameStateWithPlayers,
            });

            // Push notification to game creator
            try {
                const creator = game.players.player1;
                if (creator && !creator.isCPU && creator.username !== cleanUsername) {
                    if (!isUserOnlineInGame(io, creator.username, cleanGameId, game)) {
                        sendPushToUser(creator.username, {
                            title: '🎮 Player Joined!',
                            body: `${cleanUsername} joined your game`,
                            url: `/join/${cleanGameId}`,
                            tag: `join-${cleanGameId}`,
                        }).catch(() => {});
                    }
                }
            } catch (_) { /* push is best-effort */ }

            if (filled === game.playerCount) {
                const cpuCount = countCPUPlayers(game);
                if (cpuCount > 0) {
                    io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });
                } else {
                    const deadline = Date.now() + HOST_START_TIMEOUT_MS;
                    io.to(cleanGameId).emit('room_full', { gameId: cleanGameId, autoStartAt: deadline });

                    if (hostStartTimers.has(cleanGameId)) clearTimeout(hostStartTimers.get(cleanGameId));
                    hostStartTimers.set(cleanGameId, setTimeout(async () => {
                        hostStartTimers.delete(cleanGameId);
                        try {
                            const g = await gameStore.getGame(cleanGameId);
                            if (!g || g.gameState?.winner) return;
                            if (g.started) return;
                            const f = countFilledPlayers(g);
                            if (f < g.playerCount) return;
                            g.started = true;
                            await gameStore.setGame(cleanGameId, g);
                            await persistGame(g, 'playing');
                            const gsWithPlayers = buildGameStateWithPlayers(g);
                            for (let i = 1; i <= g.playerCount; i++) {
                                const pid = `player${i}`;
                                const player = g.players[pid];
                                if (player && !player.isCPU) {
                                    const playerSocket = io.sockets.sockets.get(player.id);
                                    if (playerSocket) {
                                        playerSocket.emit('game_started', {
                                            gameId: cleanGameId,
                                            playerId: pid,
                                            sessionToken: player.token,
                                            gridSize: g.gridSize,
                                            playerCount: g.playerCount,
                                            players: getPlayersList(g),
                                            gameState: gsWithPlayers,
                                        });
                                    }
                                }
                            }
                            io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });
                            log.info('Game auto-started (AFK host timeout)', { gameId: cleanGameId });
                        } catch (err) {
                            log.error('AFK host auto-start failed', { gameId: cleanGameId, error: err.message });
                        }
                    }, HOST_START_TIMEOUT_MS));
                }
            }
        } catch (error) {
            log.error('Error joining game', { error: error.message, stack: error.stack });
            socket.emit('error', 'Failed to join game');
        }
    });

    // ── lobby_state ────────────────────────────────────────────────────────
    socket.on('lobby_state', async (rawPayload) => {
        try {
            if (rateLimited('lobby_state')) return;
            const validated = validate('lobby_state', rawPayload);
            if (!validated) return;
            const { gameId } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            if (!socket.rooms.has(cleanGameId)) {
                socket.emit('error', 'Not in this game');
                return;
            }

            const game = await gameStore.getGame(cleanGameId);
            if (!game) { socket.emit('error', 'Game not found'); return; }

            const slots = [];
            for (let i = 1; i <= game.playerCount; i++) {
                const playerId = `player${i}`;
                const player = game.players[playerId];
                if (player) {
                    slots.push({
                        slot: playerId,
                        username: player.username,
                        avatar: player.avatar,
                        isCPU: !!player.isCPU,
                        isHost: playerId === 'player1',
                        connected: !player.disconnectedAt,
                        disconnectedAt: player.disconnectedAt || null,
                    });
                } else {
                    slots.push({
                        slot: playerId, username: null, avatar: null,
                        isCPU: false, isHost: false, connected: false, disconnectedAt: null,
                    });
                }
            }

            socket.emit('lobby_state', {
                gameId: cleanGameId, gridSize: game.gridSize,
                playerCount: game.playerCount, cpuDifficulty: game.cpuDifficulty || null,
                slots, filled: countFilledPlayers(game),
            });
        } catch (error) {
            log.error('Error fetching lobby state', { error: error.message });
            socket.emit('error', 'Failed to fetch lobby state');
        }
    });

    // ── replace_with_cpu ────────────────────────────────────────────────────
    socket.on('replace_with_cpu', async (rawPayload) => {
        try {
            if (rateLimited('replace_with_cpu')) return;
            const validated = validate('replace_with_cpu', rawPayload);
            if (!validated) return;
            const { gameId, sessionToken, slot, difficulty } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const game = await gameStore.getGame(cleanGameId);
            if (!game) { socket.emit('error', 'Game not found'); return; }

            const host = game.players.player1;
            if (!host || host.token !== sessionToken) {
                socket.emit('error', 'Only the game host can replace slots');
                return;
            }

            const existing = game.players[slot];
            if (existing?.isCPU) {
                socket.emit('error', 'This slot is already a CPU player');
                return;
            }
            if (existing && !existing.disconnectedAt) {
                socket.emit('error', 'Cannot replace a connected player');
                return;
            }

            const slotIndex = parseInt(slot.replace('player', ''), 10) - 1;
            game.players[slot] = {
                id: `cpu-${cleanGameId}-${slotIndex}`,
                username: CPU_NAMES[slotIndex] || `Bot-${slotIndex + 1}`,
                avatar: CPU_AVATARS[slotIndex] || '🤖',
                color: PLAYER_COLORS[slot],
                token: `cpu-token-${cleanGameId}-${slotIndex}`,
                disconnectedAt: null,
                isCPU: true,
            };
            game.cpuDifficulty = difficulty;

            const filled = countFilledPlayers(game);
            await gameStore.setGame(cleanGameId, game);
            await persistGame(game, filled === game.playerCount ? 'playing' : 'waiting');

            const lobbySlots = [];
            for (let i = 1; i <= game.playerCount; i++) {
                const pid = `player${i}`;
                const p = game.players[pid];
                lobbySlots.push(p ? {
                    slot: pid, username: p.username, avatar: p.avatar,
                    isCPU: !!p.isCPU, isHost: pid === 'player1',
                    connected: !p.disconnectedAt, disconnectedAt: p.disconnectedAt || null,
                } : {
                    slot: pid, username: null, avatar: null,
                    isCPU: false, isHost: false, connected: false, disconnectedAt: null,
                });
            }

            io.to(cleanGameId).emit('lobby_state', {
                gameId: cleanGameId, gridSize: game.gridSize,
                playerCount: game.playerCount, cpuDifficulty: game.cpuDifficulty,
                slots: lobbySlots, filled,
            });

            log.info('Slot replaced with CPU', { gameId: cleanGameId, slot, difficulty });
        } catch (error) {
            log.error('Error replacing slot with CPU', { error: error.message });
            socket.emit('error', 'Failed to replace slot');
        }
    });

    // ── start_game_early ────────────────────────────────────────────────────
    socket.on('start_game_early', async (rawPayload) => {
        try {
            if (rateLimited('start_game_early')) return;
            cancelPostgameTimer(socket.id);
            const validated = validate('start_game_early', rawPayload);
            if (!validated) return;
            const { gameId, sessionToken, cpuDifficulty } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const game = await gameStore.getGame(cleanGameId);
            if (!game) { socket.emit('error', 'Game not found'); return; }

            const host = game.players.player1;
            if (!host || host.token !== sessionToken) {
                socket.emit('error', 'Only the game host can start the game');
                return;
            }

            const filledBefore = countFilledPlayers(game);
            if (filledBefore < 2) {
                socket.emit('error', 'Need at least 2 players to start the game');
                return;
            }

            const validDifficulties = ['easy', 'medium', 'hard'];
            const cleanDifficulty = validDifficulties.includes(cpuDifficulty) ? cpuDifficulty : 'medium';

            const slotsToFill = [];
            for (let i = 1; i <= game.playerCount; i++) {
                const pid = `player${i}`;
                if (!game.players[pid]) {
                    slotsToFill.push(pid);
                }
            }

            const freshGame = await gameStore.getGame(cleanGameId);
            if (!freshGame) { socket.emit('error', 'Game not found'); return; }

            for (const pid of slotsToFill) {
                if (freshGame.players[pid] && !freshGame.players[pid].isCPU && freshGame.players[pid].username) {
                    continue;
                }
                const cpuIdx = parseInt(pid.replace('player', ''), 10) - 1;
                freshGame.players[pid] = {
                    id: `cpu-${cleanGameId}-${cpuIdx}`,
                    username: CPU_NAMES[cpuIdx] || `Bot-${cpuIdx + 1}`,
                    avatar: CPU_AVATARS[cpuIdx] || '🤖',
                    color: PLAYER_COLORS[pid],
                    token: `cpu-token-${cleanGameId}-${cpuIdx}`,
                    disconnectedAt: null,
                    isCPU: true,
                };
            }
            freshGame.cpuDifficulty = cleanDifficulty;

            freshGame.started = true;
            await gameStore.setGame(cleanGameId, freshGame);
            await persistGame(freshGame, 'playing');

            for (let i = 1; i <= freshGame.playerCount; i++) {
                const pid = `player${i}`;
                const player = freshGame.players[pid];
                if (player && !player.isCPU) {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        playerSocket.emit('game_started', {
                            gameId: cleanGameId,
                            playerId: pid,
                            sessionToken: player.token,
                            gridSize: freshGame.gridSize,
                            playerCount: freshGame.playerCount,
                            players: getPlayersList(freshGame),
                            gameState: buildGameStateWithPlayers(freshGame),
                            cpuDifficulty: cleanDifficulty,
                        });
                    }
                }
            }
            io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });

            const firstPlayer = freshGame.players[freshGame.gameState.currentPlayer];
            if (firstPlayer && firstPlayer.isCPU) {
                const delay = CPU_DELAYS[cleanDifficulty] || 1200;
                scheduleCPUMove(io, log, cleanGameId, delay);
            }

            log.info('Game started early by host', { gameId: cleanGameId, filledBefore, total: freshGame.playerCount });
        } catch (error) {
            log.error('Error starting game early', { error: error.message });
            socket.emit('error', 'Failed to start game');
        }
    });

    // ── start_game ────────────────────────────────────────────────────────
    socket.on('start_game', async (rawPayload) => {
        try {
            if (rateLimited('start_game')) return;
            cancelPostgameTimer(socket.id);
            const validated = validate('start_game', rawPayload);
            if (!validated) return;
            const { gameId, sessionToken } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const game = await gameStore.getGame(cleanGameId);
            if (!game) { socket.emit('error', 'Game not found'); return; }

            const host = game.players.player1;
            if (!host || host.token !== sessionToken) {
                socket.emit('error', 'Only the game host can start the game');
                return;
            }

            if (game.started) return;

            const filled = countFilledPlayers(game);
            if (filled < game.playerCount) {
                socket.emit('error', 'Room is not full yet');
                return;
            }

            if (!hostStartTimers.has(cleanGameId)) return;

            clearTimeout(hostStartTimers.get(cleanGameId));
            hostStartTimers.delete(cleanGameId);

            game.started = true;
            await gameStore.setGame(cleanGameId, game);
            await persistGame(game, 'playing');

            const gameStateWithPlayers = buildGameStateWithPlayers(game);
            for (let i = 1; i <= game.playerCount; i++) {
                const pid = `player${i}`;
                const player = game.players[pid];
                if (player && !player.isCPU) {
                    const playerSocket = io.sockets.sockets.get(player.id);
                    if (playerSocket) {
                        playerSocket.emit('game_started', {
                            gameId: cleanGameId,
                            playerId: pid,
                            sessionToken: player.token,
                            gridSize: game.gridSize,
                            playerCount: game.playerCount,
                            players: getPlayersList(game),
                            gameState: gameStateWithPlayers,
                        });
                    }
                }
            }
            io.to(cleanGameId).emit('all_players_joined', { gameId: cleanGameId });

            log.info('Game started by host', { gameId: cleanGameId, playerCount: game.playerCount });
        } catch (error) {
            log.error('Error starting game', { error: error.message });
            socket.emit('error', 'Failed to start game');
        }
    });

    // ── validate_rejoin (#480) ────────────────────────────────────────────────
    // Client sends { gameId, sessionToken } to check if a previously active game
    // is still valid before showing the "rejoin" banner in the lobby.
    socket.on('validate_rejoin', async (rawPayload, callback) => {
        try {
            if (typeof callback !== 'function') return;
            if (!rawPayload || typeof rawPayload !== 'object') {
                return callback({ valid: false, reason: 'invalid_request' });
            }
            const { gameId, sessionToken, username } = rawPayload;
            if (!gameId || !sessionToken) {
                return callback({ valid: false, reason: 'invalid_request' });
            }

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) return callback({ valid: false, reason: 'session_expired' });
            const cleanGameId = gidResult.value;

            const game = await gameStore.getGame(cleanGameId);
            if (!game) return callback({ valid: false, reason: 'session_expired' });

            // Game must be in a rejoinable state (no winner yet)
            const hasWinner = game.gameState && game.gameState.winner;
            if (hasWinner) {
                return callback({ valid: false, reason: 'session_expired' });
            }

            // Check if session token matches any player slot
            for (let i = 1; i <= game.playerCount; i++) {
                const player = game.players[`player${i}`];
                if (player && player.token === sessionToken) {
                    // If username provided, verify it matches too
                    if (username && player.username !== username) continue;
                    return callback({ valid: true });
                }
            }

            return callback({ valid: false, reason: 'session_expired' });
        } catch (error) {
            log.error('Error validating rejoin', { error: error.message });
            if (typeof callback === 'function') callback({ valid: false });
        }
    });
}

module.exports = {
    register,
    setScheduleCPUMove,
    setHandleTournamentGameCompletion,
    setHandleRankedDisconnect,
};
