/**
 * Disconnect/reconnect, leave game, and cleanup handlers.
 * Handles: leave_game, disconnect
 * Also exports recoverDisconnectTimers for PM2 restart recovery (#481).
 */
const {
    gameStore,
    rematchStore,
    disconnectStore,
    matchmaking,
    sanitizeGameId,
    gameStatusFromPlayers,
    findPlayerBySocket,
    countFilledPlayers,
    countCPUPlayers,
    buildGameStateWithPlayers,
    getPlayersList,
    persistGame,
    markGameFinished,
    socketLimiter,
    inviteSenderLimiter,
    chatRateLimiter,
    clearIdleTimers,
    startLobbyTimer,
    cancelPostgameTimer,
    startPostgameTimer,
    localTimers,
    rematchTimers,
    hostStartTimers,
    activeDailyGames,
    rankedGameMap,
    DISCONNECT_TIMEOUT_MS,
    CLEANUP_DELAY_MS,
    promMetrics,
    getNextActivePlayer,
    pickForfeitWinner,
    updateLeaderboard,
    recordGameHistory,
    CPU_DELAYS,
} = require('./shared');

// Forward declarations - set by socketHandlers.js
let scheduleCPUMove = null;
let handleTournamentGameCompletion = null;
let handleRankedDisconnect = null;
let removeFromRankedQueue = null;

function setScheduleCPUMove(fn) { scheduleCPUMove = fn; }
function setHandleTournamentGameCompletion(fn) { handleTournamentGameCompletion = fn; }
function setHandleRankedDisconnect(fn) { handleRankedDisconnect = fn; }
function setRemoveFromRankedQueue(fn) { removeFromRankedQueue = fn; }

/**
 * Register disconnect/leave socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    // ── leave_game — voluntary leave (no reconnect window) ────────────────
    socket.on('leave_game', async (rawPayload) => {
        try {
            if (rateLimited('leave_game')) return;
            const validated = validate('leave_game', rawPayload);
            if (!validated) return;
            const { gameId } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const game = await gameStore.getGame(cleanGameId);
            if (!game) return;

            const playerId = findPlayerBySocket(game, socket.id);
            if (!playerId) return;

            const player = game.players[playerId];
            if (!player) return;

            log.info('Player voluntarily left game', { gameId: cleanGameId, playerId, username: player.username });

            player.disconnectedAt = new Date();
            player.voluntaryLeave = true;
            player.id = null;

            const timerKey = `${cleanGameId}:${playerId}`;
            if (localTimers.has(timerKey)) {
                clearTimeout(localTimers.get(timerKey).timer);
                localTimers.delete(timerKey);
            }
            await disconnectStore.clearDisconnect(cleanGameId, playerId);

            if (hostStartTimers.has(cleanGameId)) {
                clearTimeout(hostStartTimers.get(cleanGameId));
                hostStartTimers.delete(cleanGameId);
            }

            io.to(cleanGameId).emit('player_left', {
                playerId,
                username: player.username,
                reason: 'voluntary',
            });

            socket.leave(cleanGameId);
            socket.data.gameId = undefined;
            socket.data.playerId = undefined;

            startLobbyTimer(socket);

            if (game.gameState?.winner) {
                await rematchStore.removeVote(cleanGameId, playerId);
                io.to(cleanGameId).emit('rematch_failed', {
                    reason: `${player.username || 'A player'} left the game`,
                });
                await rematchStore.clearVotes(cleanGameId);
                if (rematchTimers.has(cleanGameId)) {
                    clearTimeout(rematchTimers.get(cleanGameId));
                    rematchTimers.delete(cleanGameId);
                }
                await gameStore.setGame(cleanGameId, game);
                return;
            }

            const remaining = [];
            for (let i = 1; i <= game.playerCount; i++) {
                const pid = `player${i}`;
                const p = game.players[pid];
                if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
            }

            if (remaining.length === 1) {
                const winner = remaining[0];
                game.gameState.winner = winner;

                await gameStore.setGame(cleanGameId, game);
                io.to(cleanGameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });
                io.to(cleanGameId).emit('player_forfeited', {
                    playerId,
                    username: player.username,
                    reason: 'voluntary_leave',
                });
                io.to(cleanGameId).emit('game_over', {
                    winner,
                    scores: game.gameState.scores,
                    reason: 'opponent_left',
                });
                for (let pi = 1; pi <= game.playerCount; pi++) {
                    const pid = `player${pi}`;
                    const p = game.players[pid];
                    if (p && !p.isCPU && !p.disconnectedAt && pid !== playerId) {
                        const playerSocket = io.sockets.sockets.get(p.id);
                        if (playerSocket) startPostgameTimer(playerSocket);
                    }
                }
                if (promMetrics) {
                    promMetrics.gamesCompletedTotal.inc();
                    if (game.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - game.createdAt) / 1000);
                }
                updateLeaderboard(game, winner, log);
                recordGameHistory(game, winner, log);
                if (handleTournamentGameCompletion) {
                    await handleTournamentGameCompletion(io, log, cleanGameId, game, winner);
                }

                if (rankedGameMap.has(cleanGameId) && handleRankedDisconnect) {
                    handleRankedDisconnect(io, cleanGameId, playerId, game, log).catch(err =>
                        log.error('Ranked leave handler failed', { gameId: cleanGameId, error: err.message })
                    );
                }

                await persistGame(game, 'finished', { reason: 'voluntary_leave' });
                if (rematchTimers.has(cleanGameId)) {
                    clearTimeout(rematchTimers.get(cleanGameId));
                    rematchTimers.delete(cleanGameId);
                }
                setTimeout(async () => {
                    await gameStore.deleteGame(cleanGameId);
                    await gameStore.deleteSpectatorCount(cleanGameId);
                    await rematchStore.clearVotes(cleanGameId);
                }, CLEANUP_DELAY_MS);
            } else if (remaining.length === 0) {
                game.gameState.winner = 'draw';
                await gameStore.setGame(cleanGameId, game);
                await persistGame(game, 'finished', { reason: 'all_left' });
                setTimeout(async () => {
                    await gameStore.deleteGame(cleanGameId);
                    await gameStore.deleteSpectatorCount(cleanGameId);
                    await rematchStore.clearVotes(cleanGameId);
                }, 10_000);
            } else {
                if (game.gameState.currentPlayer === playerId) {
                    const activePlayers = remaining;
                    const nextPlayer = getNextActivePlayer(playerId, game.gameState.players, activePlayers);
                    if (nextPlayer) {
                        game.gameState.currentPlayer = nextPlayer;
                    }
                }

                await gameStore.setGame(cleanGameId, game);
                io.to(cleanGameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

                const nextPlayerId = game.gameState.currentPlayer;
                const nextPlayer = game.players[nextPlayerId];
                if (nextPlayer && nextPlayer.isCPU) {
                    const difficulty = game.cpuDifficulty || 'medium';
                    const delay = CPU_DELAYS[difficulty] || 1200;
                    scheduleCPUMove(io, log, cleanGameId, delay);
                }
            }
        } catch (error) {
            log.error('Error processing leave_game', { socketId: socket.id, error: error.message });
        }
    });

    // ── disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
        log.info('Client disconnected', { socketId: socket.id });
        socketLimiter.cleanup(socket.id);
        inviteSenderLimiter.cleanup(socket.id);
        chatRateLimiter.cleanup(socket.id);
        clearIdleTimers(socket.id);
        matchmaking.leaveQueue(socket.id);
        if (removeFromRankedQueue) removeFromRankedQueue(socket.id);

        if (socket.data?.username && activeDailyGames.get(socket.data.username)) {
            const dailyGameId = activeDailyGames.get(socket.data.username);
            const dailyGame = await gameStore.getGame(dailyGameId);
            if (dailyGame && !dailyGame.gameState?.winner) {
                activeDailyGames.delete(socket.data.username);
            }
        }

        const processPlayerDisconnect = async (gameId, game, playerId) => {
            const player = game.players[playerId];
            if (!player) return;

            if (player.disconnectedAt) return;

            // ── #489: Creator disconnect in lobby — clean up waiting room ────
            const gameStatus = gameStatusFromPlayers(game);
            if (gameStatus === 'waiting') {
                if (playerId === 'player1') {
                    // Host/creator left the lobby — destroy room, notify everyone
                    log.info('Host disconnected from waiting room, closing room', { gameId, playerId });
                    io.to(gameId).emit('room_closed', {
                        reason: 'Host disconnected',
                        gameId,
                    });
                    // Remove all players from socket room
                    const room = io.sockets.adapter.rooms?.get(gameId);
                    if (room) {
                        for (const sid of room) {
                            const s = io.sockets.sockets.get(sid);
                            if (s) {
                                s.leave(gameId);
                                s.data.gameId = undefined;
                                s.data.playerId = undefined;
                                startLobbyTimer(s);
                            }
                        }
                    }
                    if (hostStartTimers.has(gameId)) {
                        clearTimeout(hostStartTimers.get(gameId));
                        hostStartTimers.delete(gameId);
                    }
                    await gameStore.deleteGame(gameId);
                    await gameStore.deleteSpectatorCount(gameId);
                    await markGameFinished(gameId, 'host_left_lobby');
                } else {
                    // Non-host player left the lobby — just remove them
                    log.info('Player disconnected from waiting room', { gameId, playerId, username: player.username });
                    delete game.players[playerId];
                    await gameStore.setGame(gameId, game);
                    io.to(gameId).emit('player_left', {
                        playerId,
                        username: player.username,
                        reason: 'disconnect_lobby',
                    });
                    io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });
                }
                socket.leave(gameId);
                socket.data.gameId = undefined;
                socket.data.playerId = undefined;
                startLobbyTimer(socket);
                return;
            }

            // BLOCKER #2: Host disconnect while room is full but game not started
            if (playerId === 'player1' && hostStartTimers.has(gameId)) {
                clearTimeout(hostStartTimers.get(gameId));
                hostStartTimers.delete(gameId);

                player.disconnectedAt = new Date();
                io.to(gameId).emit('player_disconnected', {
                    playerId,
                    username: player.username,
                    reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
                });

                await persistGame(game, 'playing');
                io.to(gameId).emit('all_players_joined', { gameId });
                log.info('Game auto-started (host disconnected in room_full)', { gameId });

                await disconnectStore.setDisconnect(gameId, playerId, socket.id, DISCONNECT_TIMEOUT_MS);
                await gameStore.setGame(gameId, game);

                const timerKey = `${gameId}:${playerId}`;
                if (localTimers.has(timerKey)) clearTimeout(localTimers.get(timerKey).timer);
                const hostForfeitTimer = setTimeout(async () => {
                    try {
                        localTimers.delete(timerKey);
                        const stillDisconnected = await disconnectStore.isDisconnected(gameId, playerId);
                        if (!stillDisconnected) return;
                        const currentGame = await gameStore.getGame(gameId);
                        if (!currentGame) return;
                        if (currentGame.gameState?.winner) return;
                        const currentPlayer = currentGame.players[playerId];
                        if (!currentPlayer || !currentPlayer.disconnectedAt) return;
                        currentPlayer.voluntaryLeave = false;
                        const remaining = [];
                        for (let i = 1; i <= currentGame.playerCount; i++) {
                            const pid = `player${i}`;
                            const p = currentGame.players[pid];
                            if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
                        }
                        io.to(gameId).emit('player_left', { playerId, username: currentPlayer.username, reason: 'disconnect_timeout' });
                        await disconnectStore.clearDisconnect(gameId, playerId);
                        io.to(gameId).emit('disconnect_timeout_resolved', { playerId, username: currentPlayer.username, gameId });
                        if (remaining.length === 1) {
                            const winner = remaining[0];
                            currentGame.gameState.winner = winner;
                            await gameStore.setGame(gameId, currentGame);
                            io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
                            io.to(gameId).emit('player_forfeited', { playerId, username: currentPlayer.username, reason: 'disconnect_timeout' });
                            io.to(gameId).emit('game_over', { winner, scores: currentGame.gameState.scores, reason: 'opponent_disconnected' });
                            for (let pi = 1; pi <= currentGame.playerCount; pi++) {
                                const pid2 = `player${pi}`;
                                const p2 = currentGame.players[pid2];
                                if (p2 && !p2.isCPU && !p2.disconnectedAt && pid2 !== playerId) {
                                    const pSock = io.sockets.sockets.get(p2.id);
                                    if (pSock) startPostgameTimer(pSock);
                                }
                            }
                            if (promMetrics) {
                                promMetrics.gamesCompletedTotal.inc();
                                if (currentGame.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - currentGame.createdAt) / 1000);
                            }
                            updateLeaderboard(currentGame, winner, log);
                            recordGameHistory(currentGame, winner, log);
                            if (handleTournamentGameCompletion) {
                                await handleTournamentGameCompletion(io, log, gameId, currentGame, winner);
                            }
                            if (rankedGameMap.has(gameId) && handleRankedDisconnect) {
                                handleRankedDisconnect(io, gameId, playerId, currentGame, log).catch(err =>
                                    log.error('Ranked disconnect handler failed', { gameId, error: err.message })
                                );
                            }
                            await persistGame(currentGame, 'finished', { reason: 'disconnect_forfeit' });
                            setTimeout(async () => {
                                await gameStore.deleteGame(gameId);
                                await gameStore.deleteSpectatorCount(gameId);
                                await rematchStore.clearVotes(gameId);
                            }, CLEANUP_DELAY_MS);
                        } else if (remaining.length === 0) {
                            currentGame.gameState.winner = 'draw';
                            await gameStore.setGame(gameId, currentGame);
                            await persistGame(currentGame, 'finished', { reason: 'all_disconnected' });
                            setTimeout(async () => {
                                await gameStore.deleteGame(gameId);
                                await gameStore.deleteSpectatorCount(gameId);
                                await rematchStore.clearVotes(gameId);
                            }, 10_000);
                        } else {
                            if (currentGame.gameState.currentPlayer === playerId) {
                                const activePlayers = remaining;
                                const nextPlayer = getNextActivePlayer(playerId, currentGame.gameState.players, activePlayers);
                                if (nextPlayer) currentGame.gameState.currentPlayer = nextPlayer;
                            }
                            await gameStore.setGame(gameId, currentGame);
                            io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
                        }
                    } catch (err) {
                        log.error('Host forfeit timer error', { gameId, playerId, error: err.message });
                    }
                }, DISCONNECT_TIMEOUT_MS);
                localTimers.set(timerKey, { timer: hostForfeitTimer, socketId: socket.id });
                return;
            }

            player.disconnectedAt = new Date();

            io.to(gameId).emit('player_disconnected', {
                playerId,
                username: player.username,
                reconnectWindowMs: DISCONNECT_TIMEOUT_MS,
            });

            if (game.gameState?.winner) {
                await rematchStore.removeVote(gameId, playerId);
                io.to(gameId).emit('rematch_failed', {
                    reason: `${player.username || 'A player'} disconnected`,
                });
                await rematchStore.clearVotes(gameId);
                if (rematchTimers.has(gameId)) {
                    clearTimeout(rematchTimers.get(gameId));
                    rematchTimers.delete(gameId);
                }
                await gameStore.setGame(gameId, game);
                persistGame(game, 'finished').catch((err) =>
                    log.error('Persist after disconnect failed', { gameId, error: err.message })
                );
                return;
            }

            await disconnectStore.setDisconnect(gameId, playerId, socket.id, DISCONNECT_TIMEOUT_MS);
            await gameStore.setGame(gameId, game);

            const timerKey = `${gameId}:${playerId}`;
            if (localTimers.has(timerKey)) clearTimeout(localTimers.get(timerKey).timer);

            const timer = setTimeout(async () => {
                try {
                    localTimers.delete(timerKey);

                    const stillDisconnected = await disconnectStore.isDisconnected(gameId, playerId);
                    if (!stillDisconnected) return;

                    const currentGame = await gameStore.getGame(gameId);
                    if (!currentGame) return;

                    if (currentGame.gameState?.winner) return;

                    const currentPlayer = currentGame.players[playerId];
                    if (!currentPlayer || !currentPlayer.disconnectedAt) return;

                    currentPlayer.voluntaryLeave = false;

                    const remaining = [];
                    for (let i = 1; i <= currentGame.playerCount; i++) {
                        const pid = `player${i}`;
                        const p = currentGame.players[pid];
                        if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
                    }

                    // #490: Clear disconnect state and notify UI to dismiss banner
                    await disconnectStore.clearDisconnect(gameId, playerId);
                    io.to(gameId).emit('player_left', {
                        playerId,
                        username: currentPlayer.username,
                        reason: 'disconnect_timeout',
                    });
                    io.to(gameId).emit('disconnect_timeout_resolved', {
                        playerId,
                        username: currentPlayer.username,
                        gameId,
                    });


                    if (remaining.length >= 2) {
                        io.to(gameId).emit('player_forfeited', {
                            playerId,
                            username: currentPlayer.username,
                            reason: 'disconnect_timeout',
                        });

                        if (currentGame.gameState.currentPlayer === playerId) {
                            const nextPlayer = getNextActivePlayer(playerId, currentGame.gameState.players, remaining);
                            if (nextPlayer) {
                                currentGame.gameState.currentPlayer = nextPlayer;
                            }
                        }

                        await gameStore.setGame(gameId, currentGame);
                        io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });

                        const nextPlayerId = currentGame.gameState.currentPlayer;
                        const nextPlayerObj = currentGame.players[nextPlayerId];
                        if (nextPlayerObj && nextPlayerObj.isCPU) {
                            const difficulty = currentGame.cpuDifficulty || 'medium';
                            const delay = CPU_DELAYS[difficulty] || 1200;
                            scheduleCPUMove(io, log, gameId, delay);
                        }

                        if (rankedGameMap.has(gameId) && handleRankedDisconnect) {
                            handleRankedDisconnect(io, gameId, playerId, currentGame, log).catch(err =>
                                log.error('Ranked disconnect handler failed', { gameId, error: err.message })
                            );
                        }
                    } else {
                        const scores = currentGame.gameState?.scores || {};
                        const winner = pickForfeitWinner(remaining, scores);
                        currentGame.gameState.winner = winner;

                        await gameStore.setGame(gameId, currentGame);
                        io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
                        io.to(gameId).emit('player_forfeited', {
                            playerId,
                            username: currentPlayer.username,
                            reason: 'disconnect_timeout',
                        });
                        io.to(gameId).emit('game_over', {
                            winner,
                            scores: currentGame.gameState.scores,
                            reason: 'opponent_disconnected',
                        });
                        for (let pi = 1; pi <= currentGame.playerCount; pi++) {
                            const pid2 = `player${pi}`;
                            const p2 = currentGame.players[pid2];
                            if (p2 && !p2.isCPU && !p2.disconnectedAt && pid2 !== playerId) {
                                const pSock = io.sockets.sockets.get(p2.id);
                                if (pSock) startPostgameTimer(pSock);
                            }
                        }
                        if (promMetrics) {
                            promMetrics.gamesCompletedTotal.inc();
                            if (currentGame.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - currentGame.createdAt) / 1000);
                        }
                        updateLeaderboard(currentGame, winner, log);
                        recordGameHistory(currentGame, winner, log);
                        if (handleTournamentGameCompletion) {
                            await handleTournamentGameCompletion(io, log, gameId, currentGame, winner);
                        }

                        if (rankedGameMap.has(gameId) && handleRankedDisconnect) {
                            handleRankedDisconnect(io, gameId, playerId, currentGame, log).catch(err =>
                                log.error('Ranked disconnect handler failed', { gameId, error: err.message })
                            );
                        }

                        await persistGame(currentGame, 'finished', { reason: 'disconnect_forfeit' });

                        if (rematchTimers.has(gameId)) {
                            clearTimeout(rematchTimers.get(gameId));
                            rematchTimers.delete(gameId);
                        }
                        setTimeout(async () => {
                            await gameStore.deleteGame(gameId);
                            await gameStore.deleteSpectatorCount(gameId);
                            await rematchStore.clearVotes(gameId);
                        }, CLEANUP_DELAY_MS);
                    }
                } catch (err) {
                    log.error('Disconnect timeout handler failed', { gameId, playerId, error: err.message });
                }
            }, DISCONNECT_TIMEOUT_MS);

            localTimers.set(timerKey, { timer, socketId: socket.id });

            persistGame(game).catch((err) =>
                log.error('Persist after disconnect failed', { gameId, error: err.message })
            );
        };

        try {
            const processedGameIds = new Set();

            const hintedGameId = socket.data?.gameId;
            const hintedPlayerId = socket.data?.playerId;
            const hintedIsSpectator = socket.data?.isSpectator === true || hintedPlayerId === 'spectator';
            if (hintedGameId && hintedPlayerId) {
                if (hintedIsSpectator) {
                    try {
                        const newCount = await gameStore.adjustSpectatorCount(hintedGameId, -1);
                        const hintedGame = await gameStore.getGame(hintedGameId);
                        if (hintedGame) {
                            hintedGame.spectatorCount = newCount;
                            await gameStore.setGame(hintedGameId, hintedGame);
                            io.to(hintedGameId).emit('spectator_count', { count: newCount });
                            io.to(hintedGameId).emit('spectator_left', {
                                username: socket.data.spectatorUsername || 'A spectator',
                                count: newCount,
                            });
                        }
                    } catch (err) {
                        log.error('Spectator disconnect cleanup failed', { gameId: hintedGameId, error: err.message });
                    }
                    return;
                }
                const hintedGame = await gameStore.getGame(hintedGameId);
                if (hintedGame?.players?.[hintedPlayerId]?.id === socket.id) {
                    await processPlayerDisconnect(hintedGameId, hintedGame, hintedPlayerId);
                    processedGameIds.add(hintedGameId);
                }
            }

            const allGames = await gameStore.getAllActiveGames();
            for (const [gameId, game] of allGames.entries()) {
                if (processedGameIds.has(gameId)) continue;
                const playerId = findPlayerBySocket(game, socket.id);
                if (!playerId) continue;
                await processPlayerDisconnect(gameId, game, playerId);
            }
        } catch (error) {
            log.error('Error handling disconnect', { socketId: socket.id, error: error.message });
        } finally {
            socket.data.gameId = undefined;
            socket.data.playerId = undefined;
            socket.data.isSpectator = undefined;
            socket.data.tournamentId = undefined;
        }
    });
}

module.exports = {
    register,
    setScheduleCPUMove,
    setHandleTournamentGameCompletion,
    setHandleRankedDisconnect,
    setRemoveFromRankedQueue,
    recoverDisconnectTimers,
    executeForfeit,
};

/**
 * Recover disconnect forfeit timers after PM2 restart (#481).
 * Scans disconnectStore for active disconnects and recreates timers
 * with remaining duration. Called once on server startup after io init.
 *
 * @param {import('socket.io').Server} io
 * @param {object} log - Logger instance
 */
async function recoverDisconnectTimers(io, log) {
    try {
        const allDisconnects = await disconnectStore.getAllDisconnects();
        if (!allDisconnects.length) return;

        log.info('Recovering disconnect timers after restart', { count: allDisconnects.length });
        let recovered = 0;
        let expired = 0;
        let skipped = 0;

        for (const { gameId, playerId, socketId, timestamp } of allDisconnects) {
            const timerKey = `${gameId}:${playerId}`;

            // Skip if timer already exists (shouldn't happen on fresh start, but be safe)
            if (localTimers.has(timerKey)) {
                skipped++;
                continue;
            }

            const game = await gameStore.getGame(gameId);
            if (!game) {
                // Game no longer exists — clean up stale disconnect
                await disconnectStore.clearDisconnect(gameId, playerId);
                skipped++;
                continue;
            }

            // Skip if game already finished
            if (game.gameState?.winner) {
                await disconnectStore.clearDisconnect(gameId, playerId);
                skipped++;
                continue;
            }

            const player = game.players[playerId];
            if (!player || !player.disconnectedAt) {
                // Player already reconnected or doesn't exist
                await disconnectStore.clearDisconnect(gameId, playerId);
                skipped++;
                continue;
            }

            // Check if player already reconnected (has a socket in the room)
            const room = io.sockets.adapter.rooms?.get(gameId);
            if (room && player.id && room.has(player.id)) {
                await disconnectStore.clearDisconnect(gameId, playerId);
                skipped++;
                continue;
            }

            const elapsed = Date.now() - timestamp;
            const remaining = DISCONNECT_TIMEOUT_MS - elapsed;

            if (remaining <= 0) {
                // Timer already expired — execute forfeit immediately
                expired++;
                await executeForfeit(io, log, gameId, playerId);
            } else {
                // Recreate timer with remaining duration
                recovered++;
                const timer = setTimeout(async () => {
                    try {
                        localTimers.delete(timerKey);
                        await executeForfeit(io, log, gameId, playerId);
                    } catch (err) {
                        log.error('Recovered forfeit timer error', { gameId, playerId, error: err.message });
                    }
                }, remaining);
                localTimers.set(timerKey, { timer, socketId });
            }
        }

        log.info('Disconnect timer recovery complete', { recovered, expired, skipped });
    } catch (err) {
        log.error('Failed to recover disconnect timers', { error: err.message });
    }
}

/**
 * Execute forfeit for a disconnected player (#481, #490).
 * Shared by timer callbacks and recovery logic.
 *
 * @param {import('socket.io').Server} io
 * @param {object} log
 * @param {string} gameId
 * @param {string} playerId
 */
async function executeForfeit(io, log, gameId, playerId) {
    const stillDisconnected = await disconnectStore.isDisconnected(gameId, playerId);
    if (!stillDisconnected) return;

    const currentGame = await gameStore.getGame(gameId);
    if (!currentGame) return;
    if (currentGame.gameState?.winner) return;

    const currentPlayer = currentGame.players[playerId];
    if (!currentPlayer || !currentPlayer.disconnectedAt) return;

    currentPlayer.voluntaryLeave = false;

    const remaining = [];
    for (let i = 1; i <= currentGame.playerCount; i++) {
        const pid = `player${i}`;
        const p = currentGame.players[pid];
        if (p && pid !== playerId && !p.disconnectedAt) remaining.push(pid);
    }

    // Clear disconnect state and notify UI
    await disconnectStore.clearDisconnect(gameId, playerId);
    io.to(gameId).emit('player_left', {
        playerId,
        username: currentPlayer.username,
        reason: 'disconnect_timeout',
    });
    io.to(gameId).emit('disconnect_timeout_resolved', {
        playerId,
        username: currentPlayer.username,
        gameId,
    });

    if (remaining.length >= 2) {
        // 3+ player game: remove player, continue game
        io.to(gameId).emit('player_forfeited', {
            playerId,
            username: currentPlayer.username,
            reason: 'disconnect_timeout',
        });

        if (currentGame.gameState.currentPlayer === playerId) {
            const nextPlayer = getNextActivePlayer(playerId, currentGame.gameState.players, remaining);
            if (nextPlayer) currentGame.gameState.currentPlayer = nextPlayer;
        }

        await gameStore.setGame(gameId, currentGame);
        io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
    } else {
        // 2-player game or last opponent: declare winner
        const scores = currentGame.gameState?.scores || {};
        const winner = pickForfeitWinner(remaining, scores);
        currentGame.gameState.winner = winner;

        await gameStore.setGame(gameId, currentGame);
        io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(currentGame) });
        io.to(gameId).emit('player_forfeited', {
            playerId,
            username: currentPlayer.username,
            reason: 'disconnect_timeout',
        });
        io.to(gameId).emit('game_over', {
            winner,
            scores: currentGame.gameState.scores,
            reason: 'opponent_disconnected',
        });

        for (let pi = 1; pi <= currentGame.playerCount; pi++) {
            const pid2 = `player${pi}`;
            const p2 = currentGame.players[pid2];
            if (p2 && !p2.isCPU && !p2.disconnectedAt && pid2 !== playerId) {
                const pSock = io.sockets.sockets.get(p2.id);
                if (pSock) startPostgameTimer(pSock);
            }
        }
        if (promMetrics) {
            promMetrics.gamesCompletedTotal.inc();
            if (currentGame.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - currentGame.createdAt) / 1000);
        }
        updateLeaderboard(currentGame, winner, log);
        recordGameHistory(currentGame, winner, log);

        await persistGame(currentGame, 'finished', { reason: 'disconnect_forfeit' });

        if (rematchTimers.has(gameId)) {
            clearTimeout(rematchTimers.get(gameId));
            rematchTimers.delete(gameId);
        }
        setTimeout(async () => {
            await gameStore.deleteGame(gameId);
            await gameStore.deleteSpectatorCount(gameId);
            await rematchStore.clearVotes(gameId);
        }, CLEANUP_DELAY_MS);
    }

    log.info('Forfeit executed for disconnected player', { gameId, playerId, remaining: remaining.length });
}
