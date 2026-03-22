/**
 * Ranked matchmaking queue handlers.
 * Handles: ranked_queue_join, ranked_queue_leave, get_ranked_profile
 * Also exports: handleRankedDisconnect, handleRankedGameEnd, removeFromRankedQueue
 */
const {
    gameStore,
    sanitizeUsername,
    sanitizeAvatar,
    validateNumber,
    cancelLobbyTimer,
    cancelPostgameTimer,
    generateSessionToken,
    generateUniqueGameId,
    buildGameStateWithPlayers,
    getPlayersList,
    persistGame,
    PLAYER_COLORS,
    DISCONNECT_TIMEOUT_MS,
    initializeGameState,
    rankedQueue,
    rankedQueueIndex,
    rankedGameMap,
    RANKED_ELO_RANGE,
    RANKED_ELO_EXPAND_AFTER_MS,
    RankedProfile,
    calculateRankedEloExchange,
    calculateRankedDrawExchange,
    getTierFromElo,
    PLACEMENT_GAMES_REQUIRED,
    COOLDOWN_DURATION_MS,
} = require('./shared');

/**
 * Remove a socket from the ranked queue.
 */
function removeFromRankedQueue(socketId) {
    const idx = rankedQueue.findIndex(e => e.socketId === socketId);
    if (idx !== -1) rankedQueue.splice(idx, 1);
    rankedQueueIndex.delete(socketId);
}

/**
 * Try to find a ranked match for a player in the queue.
 */
async function tryRankedMatch(io, log, triggerSocket) {
    if (rankedQueue.length < 2) return;

    const now = Date.now();

    for (let i = 0; i < rankedQueue.length; i++) {
        for (let j = i + 1; j < rankedQueue.length; j++) {
            const a = rankedQueue[i];
            const b = rankedQueue[j];

            if (a.gridSize !== b.gridSize) continue;

            const eloDiff = Math.abs(a.elo - b.elo);
            const aWaitMs = now - a.joinedAt;
            const bWaitMs = now - b.joinedAt;
            const maxWait = Math.max(aWaitMs, bWaitMs);

            const effectiveRange = maxWait >= RANKED_ELO_EXPAND_AFTER_MS
                ? RANKED_ELO_RANGE * 2
                : RANKED_ELO_RANGE;

            if (eloDiff > effectiveRange) continue;

            removeFromRankedQueue(b.socketId);
            removeFromRankedQueue(a.socketId);

            await createRankedGame(io, log, a, b);
            return;
        }
    }
}

/**
 * Create a ranked 2P game for two matched players.
 */
async function createRankedGame(io, log, playerA, playerB) {
    const gameId = await generateUniqueGameId();
    if (!gameId) {
        log.error('Failed to generate ranked game ID');
        return;
    }

    const initialState = initializeGameState(playerA.gridSize, 2);
    const tokenA = generateSessionToken();
    const tokenB = generateSessionToken();

    const game = {
        id: gameId,
        gridSize: playerA.gridSize,
        playerCount: 2,
        players: {
            player1: {
                id: playerA.socketId,
                username: playerA.username,
                avatar: playerA.avatar,
                color: PLAYER_COLORS.player1,
                token: tokenA,
                disconnectedAt: null,
            },
            player2: {
                id: playerB.socketId,
                username: playerB.username,
                avatar: playerB.avatar,
                color: PLAYER_COLORS.player2,
                token: tokenB,
                disconnectedAt: null,
            },
        },
        gameState: initialState,
        createdAt: Date.now(),
        matchType: 'ranked',
        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS, ranked: true },
    };

    rankedGameMap.set(gameId, {
        player1Username: playerA.username,
        player2Username: playerB.username,
    });

    await gameStore.setGame(gameId, game);
    await persistGame(game, 'playing', { ranked: true });

    const assignments = [
        { socketId: playerA.socketId, playerId: 'player1', sessionToken: tokenA, username: playerA.username, elo: playerA.elo },
        { socketId: playerB.socketId, playerId: 'player2', sessionToken: tokenB, username: playerB.username, elo: playerB.elo },
    ];

    for (const assignment of assignments) {
        const playerSocket = io.sockets.sockets.get(assignment.socketId);
        if (playerSocket) {
            playerSocket.join(gameId);
            playerSocket.data.gameId = gameId;
            playerSocket.data.playerId = assignment.playerId;
            playerSocket.data.rankedQueue = false;
            playerSocket.data.username = assignment.username;

            const gameStateWithPlayers = buildGameStateWithPlayers(game);
            playerSocket.emit('ranked_queue_matched', {
                gameId,
                playerId: assignment.playerId,
                sessionToken: assignment.sessionToken,
                gridSize: game.gridSize,
                playerCount: 2,
                players: getPlayersList(game),
                gameState: gameStateWithPlayers,
                ranked: true,
            });
        }
    }

    io.to(gameId).emit('all_players_joined', { gameId });

    log.info('Ranked match created', {
        gameId,
        player1: playerA.username,
        player2: playerB.username,
        eloDiff: Math.abs(playerA.elo - playerB.elo),
    });
}

/**
 * Handle ranked game disconnect: apply auto-loss + cooldown.
 */
async function handleRankedDisconnect(io, gameId, disconnectedPlayerId, game, log) {
    const rankedInfo = rankedGameMap.get(gameId);
    if (!rankedInfo) return;
    rankedGameMap.delete(gameId);

    const disconnectedPlayer = game.players[disconnectedPlayerId];
    if (!disconnectedPlayer) return;

    const disconnectedUsername = disconnectedPlayer.username;
    const opponentPlayerId = disconnectedPlayerId === 'player1' ? 'player2' : 'player1';
    const opponentPlayer = game.players[opponentPlayerId];
    if (!opponentPlayer) return;

    const opponentUsername = opponentPlayer.username;

    const [disconnectedProfile, opponentProfile] = await Promise.all([
        RankedProfile.findOne({ username: disconnectedUsername }),
        RankedProfile.findOne({ username: opponentUsername }),
    ]);

    if (!disconnectedProfile || !opponentProfile) return;

    const preDisconnectedElo = disconnectedProfile.elo;
    const preOpponentElo = opponentProfile.elo;

    const isPlacementDisc = disconnectedProfile.isInPlacement();
    const isPlacementOpp = opponentProfile.isInPlacement();

    const eloChange = calculateRankedEloExchange(preOpponentElo, preDisconnectedElo, isPlacementOpp, isPlacementDisc);

    disconnectedProfile.elo = Math.max(0, preDisconnectedElo - eloChange);
    disconnectedProfile.losses += 1;
    disconnectedProfile.cooldownUntil = new Date(Date.now() + COOLDOWN_DURATION_MS);
    disconnectedProfile.lastPlayedAt = new Date();
    if (isPlacementDisc) {
        disconnectedProfile.placementGames.push({
            result: 'loss',
            opponentElo: preOpponentElo,
            eloAfter: disconnectedProfile.elo,
        });
    }
    await disconnectedProfile.save();

    opponentProfile.elo = preOpponentElo + eloChange;
    opponentProfile.wins += 1;
    opponentProfile.lastPlayedAt = new Date();
    if (isPlacementOpp) {
        opponentProfile.placementGames.push({
            result: 'win',
            opponentElo: preDisconnectedElo,
            eloAfter: opponentProfile.elo,
        });
    }
    await opponentProfile.save();

    const opponentTier = getTierFromElo(opponentProfile.elo);
    const discTier = getTierFromElo(disconnectedProfile.elo);

    const opponentSocket = io.sockets?.sockets?.get(opponentPlayer.id);
    if (opponentSocket) {
        opponentSocket.emit('ranked_game_result', {
            result: 'win',
            eloChange: eloChange,
            newElo: opponentProfile.elo,
            tier: opponentTier.name,
            tierIcon: opponentTier.icon,
            isPlacement: isPlacementOpp,
            placementProgress: isPlacementOpp ? `${opponentProfile.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    const discSocket = io.sockets?.sockets?.get(disconnectedPlayer.id);
    if (discSocket) {
        discSocket.emit('ranked_game_result', {
            result: 'loss',
            eloChange: -eloChange,
            newElo: disconnectedProfile.elo,
            tier: discTier.name,
            tierIcon: discTier.icon,
            isPlacement: isPlacementDisc,
            placementProgress: isPlacementDisc ? `${disconnectedProfile.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    log.info('Ranked disconnect penalty applied', {
        gameId,
        disconnected: disconnectedUsername,
        eloChange,
        newElo: disconnectedProfile.elo,
        cooldownMinutes: COOLDOWN_DURATION_MS / 60000,
    });
}

/**
 * Handle end of a ranked game (normal completion or draw).
 */
async function handleRankedGameEnd(io, gameId, winnerPlayerId, game, log) {
    const rankedInfo = rankedGameMap.get(gameId);
    if (!rankedInfo) return;
    rankedGameMap.delete(gameId);

    const isDraw = winnerPlayerId === 'draw';
    const player1 = game.players.player1;
    const player2 = game.players.player2;

    if (!player1 || !player2) return;

    const [profile1, profile2] = await Promise.all([
        RankedProfile.findOne({ username: player1.username }),
        RankedProfile.findOne({ username: player2.username }),
    ]);

    if (!profile1 || !profile2) return;

    const preElo1 = profile1.elo;
    const preElo2 = profile2.elo;

    const isPlacement1 = profile1.isInPlacement();
    const isPlacement2 = profile2.isInPlacement();

    let result1, result2, eloChange1, eloChange2;

    if (isDraw) {
        const drawChange1 = calculateRankedDrawExchange(preElo1, preElo2, isPlacement1, isPlacement2);
        eloChange1 = drawChange1;
        eloChange2 = -drawChange1;
        result1 = 'draw';
        result2 = 'draw';
    } else {
        const winnerIsPlayer1 = winnerPlayerId === 'player1';
        const winnerElo = winnerIsPlayer1 ? preElo1 : preElo2;
        const loserElo = winnerIsPlayer1 ? preElo2 : preElo1;
        const winnerIsPlacement = winnerIsPlayer1 ? isPlacement1 : isPlacement2;
        const loserIsPlacement = winnerIsPlayer1 ? isPlacement2 : isPlacement1;

        const exchange = calculateRankedEloExchange(winnerElo, loserElo, winnerIsPlacement, loserIsPlacement);

        eloChange1 = winnerIsPlayer1 ? exchange : -exchange;
        eloChange2 = winnerIsPlayer1 ? -exchange : exchange;
        result1 = winnerIsPlayer1 ? 'win' : 'loss';
        result2 = winnerIsPlayer1 ? 'loss' : 'win';
    }

    profile1.elo = Math.max(0, preElo1 + eloChange1);
    profile2.elo = Math.max(0, preElo2 + eloChange2);

    if (result1 === 'win') profile1.wins += 1;
    else if (result1 === 'loss') profile1.losses += 1;
    else if (result1 === 'draw') profile1.draws += 1;

    if (result2 === 'win') profile2.wins += 1;
    else if (result2 === 'loss') profile2.losses += 1;
    else if (result2 === 'draw') profile2.draws += 1;

    profile1.lastPlayedAt = new Date();
    profile2.lastPlayedAt = new Date();

    if (isPlacement1) {
        profile1.placementGames.push({
            result: result1,
            opponentElo: preElo2,
            eloAfter: profile1.elo,
        });
    }
    if (isPlacement2) {
        profile2.placementGames.push({
            result: result2,
            opponentElo: preElo1,
            eloAfter: profile2.elo,
        });
    }

    await Promise.all([profile1.save(), profile2.save()]);

    const tier1 = getTierFromElo(profile1.elo);
    const tier2 = getTierFromElo(profile2.elo);

    const socket1 = io.sockets?.sockets?.get(player1.id);
    if (socket1) {
        socket1.emit('ranked_game_result', {
            result: result1,
            eloChange: eloChange1,
            newElo: profile1.elo,
            tier: tier1.name,
            tierIcon: tier1.icon,
            isPlacement: isPlacement1,
            placementProgress: isPlacement1 ? `${profile1.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    const socket2 = io.sockets?.sockets?.get(player2.id);
    if (socket2) {
        socket2.emit('ranked_game_result', {
            result: result2,
            eloChange: eloChange2,
            newElo: profile2.elo,
            tier: tier2.name,
            tierIcon: tier2.icon,
            isPlacement: isPlacement2,
            placementProgress: isPlacement2 ? `${profile2.placementGames.length}/${PLACEMENT_GAMES_REQUIRED}` : null,
        });
    }

    log.info('Ranked game ended', {
        gameId,
        result: isDraw ? 'draw' : `winner=${winnerPlayerId}`,
        player1Elo: `${preElo1} → ${profile1.elo}`,
        player2Elo: `${preElo2} → ${profile2.elo}`,
    });
}

/**
 * Register ranked socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    // ── ranked_queue_join ────────────────────────────────────────────────
    socket.on('ranked_queue_join', async (rawPayload) => {
        try {
            if (rateLimited('ranked_queue_join')) return;
            cancelLobbyTimer(socket.id);
            cancelPostgameTimer(socket.id);
            const validated = validate('ranked_queue_join', rawPayload);
            if (!validated) return;
            const { username, avatar, gridSize } = validated;

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) { socket.emit('error', uResult.error); return; }
            const cleanUsername = uResult.value;
            const cleanAvatar = sanitizeAvatar(avatar);

            const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
            if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

            let profile = await RankedProfile.findOne({ username: cleanUsername });
            if (!profile) {
                profile = new RankedProfile({ username: cleanUsername });
                await profile.save();
            }

            if (profile.isOnCooldown()) {
                const remaining = Math.ceil((new Date(profile.cooldownUntil) - new Date()) / 1000);
                socket.emit('ranked_cooldown', {
                    cooldownUntil: profile.cooldownUntil,
                    remainingSeconds: remaining,
                });
                socket.emit('error', `You are on cooldown for ${remaining} more seconds`);
                return;
            }

            if (rankedQueueIndex.has(socket.id)) {
                removeFromRankedQueue(socket.id);
            }

            const entry = {
                socketId: socket.id,
                username: cleanUsername,
                avatar: cleanAvatar,
                elo: profile.elo,
                gridSize: gridResult.value,
                joinedAt: Date.now(),
            };

            rankedQueue.push(entry);
            rankedQueueIndex.set(socket.id, cleanUsername);
            socket.data.rankedQueue = true;
            socket.data.rankedUsername = cleanUsername;

            const queuePosition = rankedQueue.findIndex(e => e.socketId === socket.id) + 1;
            socket.emit('ranked_queue_status', {
                position: queuePosition,
                queueSize: rankedQueue.length,
                elo: profile.elo,
                tier: getTierFromElo(profile.elo).name,
                tierIcon: getTierFromElo(profile.elo).icon,
            });

            await tryRankedMatch(io, log, socket);
        } catch (error) {
            log.error('Error handling ranked_queue_join', { error: error.message });
            socket.emit('error', 'Failed to join ranked queue');
        }
    });

    // ── ranked_queue_leave ───────────────────────────────────────────────
    socket.on('ranked_queue_leave', () => {
        if (rateLimited('ranked_queue_leave')) return;
        removeFromRankedQueue(socket.id);
        socket.data.rankedQueue = false;
        socket.emit('ranked_queue_left', {});
    });

    // ── get_ranked_profile ──────────────────────────────────────────────
    socket.on('get_ranked_profile', async (rawPayload) => {
        try {
            if (rateLimited('get_ranked_profile')) return;
            const validated = validate('get_ranked_profile', rawPayload);
            if (!validated) return;
            const { username } = validated;

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) { socket.emit('error', uResult.error); return; }
            const cleanUsername = uResult.value;

            const profile = await RankedProfile.findOne({ username: cleanUsername }).lean();
            if (profile) {
                const tier = getTierFromElo(profile.elo);
                socket.emit('ranked_profile', {
                    username: profile.username,
                    elo: profile.elo,
                    tier: tier.name,
                    tierIcon: tier.icon,
                    wins: profile.wins || 0,
                    losses: profile.losses || 0,
                    draws: profile.draws || 0,
                    isPlacement: (profile.placementGames || []).length < PLACEMENT_GAMES_REQUIRED,
                    placementProgress: `${(profile.placementGames || []).length}/${PLACEMENT_GAMES_REQUIRED}`,
                    lastPlayedAt: profile.lastPlayedAt || null,
                });
            } else {
                const defaultTier = getTierFromElo(1200);
                socket.emit('ranked_profile', {
                    username: cleanUsername,
                    elo: 1200,
                    tier: defaultTier.name,
                    tierIcon: defaultTier.icon,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    isPlacement: true,
                    placementProgress: `0/${PLACEMENT_GAMES_REQUIRED}`,
                    lastPlayedAt: null,
                });
            }
        } catch (error) {
            log.error('Error fetching ranked profile', { error: error.message });
            socket.emit('error', 'Failed to fetch ranked profile');
        }
    });
}

module.exports = {
    register,
    removeFromRankedQueue,
    handleRankedDisconnect,
    handleRankedGameEnd,
};
