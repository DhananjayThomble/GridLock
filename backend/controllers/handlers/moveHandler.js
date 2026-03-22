/**
 * Move processing, turn logic, scoring, and CPU move scheduling.
 * Handles: make_move
 */
const { calculateNewState } = require('../../utils/gameLogic');
const {
    gameStore,
    rematchStore,
    sanitizeGameId,
    buildGameStateWithPlayers,
    advanceTurnIfNeeded,
    persistGame,
    loadGameFromDB,
    markGameFinished,
    scheduleGameCleanup,
    handleGameOver,
    CLEANUP_DELAY_MS,
    CPU_DELAYS,
    chooseCPUMove,
    sendPushToUser,
    isUserOnlineInGame,
    rematchTimers,
    hostStartTimers,
    rankedGameMap,
    promMetrics,
    cancelPostgameTimer,
    startPostgameTimer,
    updateLeaderboard,
    recordGameHistory,
    submitDailyChallengeResult,
} = require('./shared');

// Forward declaration - set by socketHandlers.js
let handleTournamentGameCompletion = null;
let handleRankedGameEnd = null;

function setHandleTournamentGameCompletion(fn) { handleTournamentGameCompletion = fn; }
function setHandleRankedGameEnd(fn) { handleRankedGameEnd = fn; }

/**
 * Schedule a CPU move if the current player is a CPU.
 */
function scheduleCPUMove(io, log, gameId, delay) {
    setTimeout(async () => {
        try {
            let game = await gameStore.getGame(gameId);
            if (!game) {
                game = await loadGameFromDB(gameId, log);
                if (!game) return;
            }
            if (game.gameState.winner) return;

            const currentPlayerId = game.gameState.currentPlayer;
            const currentPlayer = game.players[currentPlayerId];
            if (!currentPlayer || !currentPlayer.isCPU) return;

            const difficulty = game.cpuDifficulty || 'medium';
            const move = chooseCPUMove(game.gameState, difficulty);
            if (!move) return;

            const newState = calculateNewState(game.gameState, game.gridSize, move.r, move.c, move.type);
            if (newState.error) {
                log.error('CPU move error', { gameId, error: newState.error });
                return;
            }

            const prevMoveCount = game.gameState.moveCount;
            game.gameState = newState;
            if (typeof prevMoveCount === 'number') {
                game.gameState.moveCount = prevMoveCount + 1;
            }

            advanceTurnIfNeeded(game);

            if (!game.moveHistory) game.moveHistory = [];
            game.moveHistory.push({
                player: currentPlayerId,
                row: move.r,
                col: move.c,
                type: move.type === 'horizontal' ? 'h' : 'v',
                timestamp: new Date(),
            });

            await gameStore.setGame(gameId, game);

            const status = newState.winner ? 'finished' : 'playing';
            await persistGame(game, status, newState.winner ? { reason: 'normal' } : null);

            io.to(gameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

            if (newState.winner) {
                io.to(gameId).emit('game_over', { winner: newState.winner, scores: newState.scores, totalMoves: game.gameState.moveCount || 0 });
                for (let pi = 1; pi <= game.playerCount; pi++) {
                    const pid = `player${pi}`;
                    const p = game.players[pid];
                    if (p && !p.isCPU && !p.disconnectedAt) {
                        const playerSocket = io.sockets.sockets.get(p.id);
                        if (playerSocket) startPostgameTimer(playerSocket);
                    }
                }
                if (promMetrics) {
                    promMetrics.gamesCompletedTotal.inc();
                    if (game.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - game.createdAt) / 1000);
                }
                updateLeaderboard(game, newState.winner, log);
                recordGameHistory(game, newState.winner, log);
                submitDailyChallengeResult(game, log).catch(err =>
                    log.error('Daily result auto-submit failed (CPU path)', { gameId, error: err.message })
                );
                if (handleTournamentGameCompletion) {
                    await handleTournamentGameCompletion(io, log, gameId, game, newState.winner);
                }
                if (rematchTimers.has(gameId)) {
                    clearTimeout(rematchTimers.get(gameId));
                    rematchTimers.delete(gameId);
                }
                if (hostStartTimers.has(gameId)) {
                    clearTimeout(hostStartTimers.get(gameId));
                    hostStartTimers.delete(gameId);
                }
                setTimeout(async () => {
                    await gameStore.deleteGame(gameId);
                    await gameStore.deleteSpectatorCount(gameId);
                    await rematchStore.clearVotes(gameId);
                    await markGameFinished(gameId, 'normal');
                }, CLEANUP_DELAY_MS);
            } else {
                const nextPlayerId = newState.currentPlayer;
                const nextPlayer = game.players[nextPlayerId];
                if (nextPlayer && nextPlayer.isCPU) {
                    const nextDelay = CPU_DELAYS[difficulty] || 1200;
                    scheduleCPUMove(io, log, gameId, nextDelay);
                }
            }
        } catch (err) {
            log.error('CPU move scheduling failed', { gameId, error: err.message });
        }
    }, delay);
}

/**
 * Register move socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    socket.on('make_move', async (rawPayload) => {
        try {
            if (rateLimited('make_move')) return;
            const validated = validate('make_move', rawPayload);
            if (!validated) return;
            const { gameId, playerId, sessionToken, type, r, c } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            let game = await gameStore.getGame(cleanGameId);
            if (!game) {
                game = await loadGameFromDB(cleanGameId, log);
                if (!game) { socket.emit('error', 'Game not found'); return; }
            }

            const player = game.players[playerId];
            if (!player || player.id !== socket.id || player.token !== sessionToken) {
                socket.emit('error', 'Unauthorized move');
                return;
            }
            if (game.gameState.currentPlayer !== playerId) {
                socket.emit('error', 'Not your turn');
                return;
            }

            const newState = calculateNewState(game.gameState, game.gridSize, r, c, type);
            if (newState.error) { socket.emit('error', newState.error); return; }

            const prevMoveCount = game.gameState.moveCount;
            game.gameState = newState;
            if (typeof prevMoveCount === 'number') {
                game.gameState.moveCount = prevMoveCount + 1;
            }

            advanceTurnIfNeeded(game);

            if (!game.moveHistory) game.moveHistory = [];
            game.moveHistory.push({
                player: playerId,
                row: r,
                col: c,
                type: type === 'horizontal' ? 'h' : 'v',
                timestamp: new Date(),
            });

            await gameStore.setGame(cleanGameId, game);

            const status = newState.winner ? 'finished' : 'playing';
            await persistGame(game, status, newState.winner ? { reason: 'normal' } : null);

            io.to(cleanGameId).emit('game_update', { gameState: buildGameStateWithPlayers(game) });

            if (newState.winner) {
                io.to(cleanGameId).emit('game_over', { winner: newState.winner, scores: newState.scores, totalMoves: game.gameState.moveCount || 0 });
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    const p = game.players[pid];
                    if (p && !p.isCPU && !p.disconnectedAt) {
                        const playerSocket = io.sockets.sockets.get(p.id);
                        if (playerSocket) startPostgameTimer(playerSocket);
                    }
                }
                if (promMetrics) {
                    promMetrics.gamesCompletedTotal.inc();
                    if (game.createdAt) promMetrics.gameDurationSeconds.observe((Date.now() - game.createdAt) / 1000);
                }
                updateLeaderboard(game, newState.winner, log);
                recordGameHistory(game, newState.winner, log);
                submitDailyChallengeResult(game, log).catch(err =>
                    log.error('Daily result auto-submit failed', { gameId: cleanGameId, error: err.message })
                );
                if (handleTournamentGameCompletion) {
                    await handleTournamentGameCompletion(io, log, cleanGameId, game, newState.winner);
                }
                if (rankedGameMap.has(cleanGameId) && handleRankedGameEnd) {
                    handleRankedGameEnd(io, cleanGameId, newState.winner, game, log).catch(err =>
                        log.error('Ranked game end handler failed', { gameId: cleanGameId, error: err.message })
                    );
                }
                if (rematchTimers.has(cleanGameId)) {
                    clearTimeout(rematchTimers.get(cleanGameId));
                    rematchTimers.delete(cleanGameId);
                }
                if (hostStartTimers.has(cleanGameId)) {
                    clearTimeout(hostStartTimers.get(cleanGameId));
                    hostStartTimers.delete(cleanGameId);
                }
                setTimeout(async () => {
                    await gameStore.deleteGame(cleanGameId);
                    await gameStore.deleteSpectatorCount(cleanGameId);
                    await rematchStore.clearVotes(cleanGameId);
                    await markGameFinished(cleanGameId, 'normal');
                    log.info('Game cleaned up', { gameId: cleanGameId });
                }, CLEANUP_DELAY_MS);
            } else {
                const nextPlayerId = newState.currentPlayer;
                const nextPlayer = game.players[nextPlayerId];
                if (nextPlayer && nextPlayer.isCPU) {
                    const difficulty = game.cpuDifficulty || 'medium';
                    const delay = CPU_DELAYS[difficulty] || 1200;
                    scheduleCPUMove(io, log, cleanGameId, delay);
                } else if (nextPlayer && !nextPlayer.isCPU) {
                    try {
                        if (!isUserOnlineInGame(io, nextPlayer.username, cleanGameId, game)) {
                            sendPushToUser(nextPlayer.username, {
                                title: '⚡ Your Turn!',
                                body: "It's your move in GridLock",
                                url: `/join/${cleanGameId}`,
                                tag: `turn-${cleanGameId}`,
                            }).catch(() => {});
                        }
                    } catch (_) { /* push is best-effort */ }
                }
            }
        } catch (error) {
            log.error('Error processing move', { error: error.message, stack: error.stack });
            socket.emit('error', 'Invalid move');
        }
    });

    // ── request_rematch ────────────────────────────────────────────────────
    socket.on('request_rematch', async (rawPayload) => {
        try {
            if (rateLimited('request_rematch')) return;
            cancelPostgameTimer(socket.id);
            const validated = validate('request_rematch', rawPayload);
            if (!validated) return;
            const { gameId, sessionToken } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const game = await gameStore.getGame(cleanGameId);
            if (!game) { socket.emit('error', 'Game not found'); return; }

            const requestingPlayerId = require('./shared').findPlayerBySocket(game, socket.id);
            if (!requestingPlayerId) { socket.emit('error', 'Player not found in game'); return; }
            if (socket.data?.isSpectator) { socket.emit('error', 'Spectators cannot request rematch'); return; }

            const player = game.players[requestingPlayerId];
            if (!player || player.token !== sessionToken) {
                socket.emit('error', 'Unauthorized rematch request');
                return;
            }

            if (require('./shared').isTournamentGame(game)) {
                socket.emit('error', 'Rematch is not available in tournament games');
                return;
            }

            const gameFinished = game.gameState?.winner != null;
            if (!gameFinished) {
                socket.emit('error', 'Rematch can only be requested after the game has finished');
                return;
            }

            const { rematchStore: rs, countCPUPlayers: countCPU, generateUniqueGameId: genId, generateSessionToken: genToken, buildRotatedPlayers, startRematchTimeout: startRematch, initializeGameState: initState, getPlayersList: getPL, DISCONNECT_TIMEOUT_MS: dcTimeout, markGameFinished: markFinished, CPU_DELAYS: cpuDelays, sendPushToUser: pushToUser, isUserOnlineInGame: isOnline } = require('./shared');

            const alreadyVoted = await rs.hasVoted(cleanGameId, requestingPlayerId);
            if (alreadyVoted) { return; }

            for (let i = 1; i <= game.playerCount; i++) {
                const pid = `player${i}`;
                const p = game.players[pid];
                if (p && !p.isCPU && p.disconnectedAt) {
                    io.to(cleanGameId).emit('rematch_failed', {
                        reason: `${p.username || 'A player'} has disconnected`,
                    });
                    await rs.clearVotes(cleanGameId);
                    return;
                }
            }

            const { count: humanCount } = await rs.addVote(cleanGameId, requestingPlayerId);

            const cpuVotes = countCPU(game);
            const totalVotes = humanCount + cpuVotes;
            io.to(cleanGameId).emit('rematch_count', { count: totalVotes, total: game.playerCount });

            if (humanCount === 1 && !rematchTimers.has(cleanGameId)) {
                startRematch(io, log, cleanGameId, game);
            }

            try {
                const requestingUsername = player.username;
                for (let i = 1; i <= game.playerCount; i++) {
                    const pid = `player${i}`;
                    const p = game.players[pid];
                    if (p && !p.isCPU && p.username !== requestingUsername) {
                        if (!isOnline(io, p.username, cleanGameId, game)) {
                            pushToUser(p.username, {
                                title: '🔄 Rematch?',
                                body: `${requestingUsername} wants a rematch!`,
                                url: `/join/${cleanGameId}`,
                                tag: `rematch-${cleanGameId}`,
                            }).catch(() => {});
                        }
                    }
                }
            } catch (_) { /* push is best-effort */ }

            if (totalVotes >= game.playerCount) {
                if (rematchTimers.has(cleanGameId)) {
                    clearTimeout(rematchTimers.get(cleanGameId));
                    rematchTimers.delete(cleanGameId);
                }

                const newGameId = await genId();
                if (!newGameId) { socket.emit('error', 'Failed to generate rematch game ID'); return; }
                const initialState = initState(game.gridSize, game.playerCount);
                const newGame = {
                    id: newGameId,
                    gridSize: game.gridSize,
                    playerCount: game.playerCount,
                    players: buildRotatedPlayers(game, newGameId),
                    gameState: initialState,
                    createdAt: Date.now(),
                    metadata: { reconnectWindowMs: dcTimeout },
                    cpuDifficulty: game.cpuDifficulty || null,
                };

                await gameStore.setGame(newGameId, newGame);
                await rs.clearVotes(cleanGameId);
                await persistGame(newGame, 'playing');
                await markFinished(cleanGameId, 'rematch_started');
                io.to(cleanGameId).emit('rematch_ready', { newGameId });

                const firstPlayer = newGame.players[newGame.gameState.currentPlayer];
                if (firstPlayer && firstPlayer.isCPU && newGame.cpuDifficulty) {
                    const delay = cpuDelays[newGame.cpuDifficulty] || 1200;
                    scheduleCPUMove(io, log, newGameId, delay);
                }
            }
        } catch (error) {
            log.error('Error processing rematch request', { error: error.message, stack: error.stack });
            socket.emit('error', 'Failed to process rematch request');
        }
    });

    // ── rematch_cancel ─────────────────────────────────────────────────────
    socket.on('rematch_cancel', async (rawPayload) => {
        try {
            if (rateLimited('rematch_cancel')) return;
            const validated = validate('rematch_cancel', rawPayload);
            if (!validated) return;
            const { gameId, sessionToken } = validated;

            const gidResult = sanitizeGameId(gameId);
            if (!gidResult.valid) { socket.emit('error', gidResult.error); return; }
            const cleanGameId = gidResult.value;

            const game = await gameStore.getGame(cleanGameId);
            if (!game) { socket.emit('error', 'Game not found'); return; }

            const requestingPlayerId = require('./shared').findPlayerBySocket(game, socket.id);
            if (!requestingPlayerId) { socket.emit('error', 'Player not found in game'); return; }

            const player = game.players[requestingPlayerId];
            if (!player || player.token !== sessionToken) {
                socket.emit('error', 'Unauthorized rematch cancel');
                return;
            }

            if (!game.gameState?.winner) {
                socket.emit('error', 'Rematch cancel only valid after game has finished');
                return;
            }

            const { count: humanCount, wasRemoved } = await require('./shared').rematchStore.removeVote(cleanGameId, requestingPlayerId);
            if (!wasRemoved) return;

            const cpuVotes = require('./shared').countCPUPlayers(game);
            const totalVotes = humanCount + cpuVotes;
            io.to(cleanGameId).emit('rematch_count', { count: totalVotes, total: game.playerCount });

            if (humanCount === 0 && rematchTimers.has(cleanGameId)) {
                clearTimeout(rematchTimers.get(cleanGameId));
                rematchTimers.delete(cleanGameId);
            }
        } catch (error) {
            log.error('Error processing rematch cancel', { error: error.message, stack: error.stack });
            socket.emit('error', 'Failed to cancel rematch request');
        }
    });
}

module.exports = {
    register,
    scheduleCPUMove,
    setHandleTournamentGameCompletion,
    setHandleRankedGameEnd,
};
