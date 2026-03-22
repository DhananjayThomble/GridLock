/**
 * Tournament socket event handlers.
 * Handles: create_tournament, join_tournament, get_tournament_state
 */
const crypto = require('crypto');
const {
    tournaments,
    tournamentGames,
    gameStore,
    sanitizeUsername,
    sanitizeAvatar,
    validateNumber,
    cancelLobbyTimer,
    cancelPostgameTimer,
    generateSessionToken,
    generateUniqueGameId,
    PLAYER_COLORS,
    DISCONNECT_TIMEOUT_MS,
    initializeGameState,
    persistGame,
    sendPushToUser,
} = require('./shared');

function sanitizeTournamentId(input) {
    if (!input || typeof input !== 'string') {
        return { valid: false, value: '', error: 'Tournament ID is required' };
    }

    const cleaned = input.trim().toUpperCase();
    if (!/^T[A-Z0-9]{5}$/.test(cleaned)) {
        return { valid: false, value: '', error: 'Invalid tournament ID format' };
    }

    return { valid: true, value: cleaned };
}

function generateTournamentId(existingTournaments = tournaments, maxAttempts = 16) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = `T${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`;
        if (!existingTournaments.has(candidate)) return candidate;
    }
    return null;
}

function buildTournamentSnapshot(t) {
    return {
        tournamentId: t.tournamentId,
        status: t.status,
        tournamentSize: t.tournamentSize,
        gridSize: t.gridSize,
        participants: t.participants.map((p) => ({ username: p.username, avatar: p.avatar })),
        rounds: t.rounds,
        champion: t.champion || null,
    };
}

function initializeBracket(participants) {
    const rounds = [];
    const firstRoundMatches = [];
    for (let i = 0; i < participants.length; i += 2) {
        firstRoundMatches.push({
            player1: participants[i]?.username || null,
            player2: participants[i + 1]?.username || null,
            winner: null,
            gameId: null,
        });
    }
    rounds.push({ matches: firstRoundMatches });

    let remaining = firstRoundMatches.length;
    while (remaining > 1) {
        remaining = Math.floor(remaining / 2);
        rounds.push({
            matches: Array.from({ length: remaining }, () => ({
                player1: null,
                player2: null,
                winner: null,
                gameId: null,
            })),
        });
    }

    return rounds;
}

function getTournamentJoinError(tournament, username, socketId) {
    if (!tournament) return 'Tournament not found';
    if (tournament.status !== 'waiting') return 'Tournament already started';
    if (tournament.participants.length >= tournament.tournamentSize) return 'Tournament is full';
    if (tournament.participants.some((p) => p.username === username)) return 'Username already joined this tournament';
    if (tournament.participants.some((p) => p.socketId === socketId)) return 'You have already joined this tournament';
    return null;
}

async function createTournamentMatchGame({ tournament, roundIndex, matchIndex, p1, p2 }) {
    const gameId = await generateUniqueGameId();
    if (!gameId) throw new Error('Failed to generate unique game ID after retries');
    const p1Token = generateSessionToken();
    const p2Token = generateSessionToken();

    const game = {
        id: gameId,
        gridSize: tournament.gridSize,
        playerCount: 2,
        players: {
            player1: {
                id: p1.socketId,
                username: p1.username,
                avatar: p1.avatar,
                color: PLAYER_COLORS.player1,
                token: p1Token,
                disconnectedAt: null,
            },
            player2: {
                id: p2.socketId,
                username: p2.username,
                avatar: p2.avatar,
                color: PLAYER_COLORS.player2,
                token: p2Token,
                disconnectedAt: null,
            },
        },
        gameState: initializeGameState(tournament.gridSize, 2),
        createdAt: Date.now(),
        metadata: { reconnectWindowMs: DISCONNECT_TIMEOUT_MS, tournamentId: tournament.tournamentId },
    };

    await gameStore.setGame(gameId, game);
    await persistGame(game, 'playing', { tournamentId: tournament.tournamentId, roundIndex, matchIndex });

    tournamentGames.set(gameId, { tournamentId: tournament.tournamentId, roundIndex, matchIndex });
    tournament.rounds[roundIndex].matches[matchIndex].gameId = gameId;

    return {
        gameId,
        assignments: [
            { socketId: p1.socketId, playerId: 'player1', sessionToken: p1Token, username: p1.username },
            { socketId: p2.socketId, playerId: 'player2', sessionToken: p2Token, username: p2.username },
        ],
    };
}

async function maybeStartTournamentRound(io, tournament, roundIndex) {
    const round = tournament.rounds[roundIndex];
    if (!round) return;

    for (let i = 0; i < round.matches.length; i++) {
        const match = round.matches[i];
        if (match.gameId || !match.player1 || !match.player2) continue;

        const p1 = tournament.participants.find((p) => p.username === match.player1);
        const p2 = tournament.participants.find((p) => p.username === match.player2);
        if (!p1 || !p2) continue;

        const { gameId, assignments } = await createTournamentMatchGame({
            tournament,
            roundIndex,
            matchIndex: i,
            p1,
            p2,
        });

        for (const assignment of assignments) {
            io.to(assignment.socketId).emit('tournament_game_assigned', {
                tournamentId: tournament.tournamentId,
                gameId,
                playerId: assignment.playerId,
                sessionToken: assignment.sessionToken,
                gridSize: tournament.gridSize,
                playerCount: 2,
            });
        }
    }
}

function applyTournamentMatchResult(tournament, roundIndex, matchIndex, winnerUsername) {
    const round = tournament.rounds?.[roundIndex];
    const match = round?.matches?.[matchIndex];
    if (!match || match.winner || !winnerUsername) {
        return { advancedRoundIndex: null, tournamentCompleted: false };
    }

    match.winner = winnerUsername;
    const isFinalRound = roundIndex === tournament.rounds.length - 1;

    if (isFinalRound) {
        tournament.status = 'finished';
        tournament.champion = winnerUsername;
        return { advancedRoundIndex: null, tournamentCompleted: true };
    }

    const nextRoundIndex = roundIndex + 1;
    const nextRound = tournament.rounds[nextRoundIndex];
    const nextMatchIndex = Math.floor(matchIndex / 2);
    const nextMatch = nextRound?.matches?.[nextMatchIndex];

    if (!nextMatch) {
        return { advancedRoundIndex: null, tournamentCompleted: false };
    }

    if (matchIndex % 2 === 0) nextMatch.player1 = winnerUsername;
    else nextMatch.player2 = winnerUsername;

    return { advancedRoundIndex: nextRoundIndex, tournamentCompleted: false };
}

async function handleTournamentGameCompletion(io, log, gameId, game, winnerPlayerId) {
    const index = tournamentGames.get(gameId);
    if (!index) return;

    const tournament = tournaments.get(index.tournamentId);
    if (!tournament) return;

    const winnerUsername = winnerPlayerId === 'draw'
        ? game.players.player1?.username
        : game.players[winnerPlayerId]?.username;

    const progression = applyTournamentMatchResult(
        tournament,
        index.roundIndex,
        index.matchIndex,
        winnerUsername
    );
    if (!winnerUsername || (!progression.tournamentCompleted && progression.advancedRoundIndex === null)) return;

    if (progression.tournamentCompleted) {
        io.to(`tournament:${tournament.tournamentId}`).emit('tournament_completed', {
            tournamentId: tournament.tournamentId,
            champion: winnerUsername,
        });
    } else if (progression.advancedRoundIndex !== null) {
        await maybeStartTournamentRound(io, tournament, progression.advancedRoundIndex);
    }

    io.to(`tournament:${tournament.tournamentId}`).emit('tournament_update', {
        tournament: buildTournamentSnapshot(tournament),
    });

    if (tournament.status === 'finished') {
        log.info('Tournament completed', { tournamentId: tournament.tournamentId, champion: tournament.champion });
    }
}

/**
 * Register tournament socket events.
 */
function register(io, socket, log, rateLimited, validate) {
    // ── create_tournament ─────────────────────────────────────────────────
    socket.on('create_tournament', async (rawPayload) => {
        try {
            if (rateLimited('create_tournament')) return;
            cancelLobbyTimer(socket.id);
            cancelPostgameTimer(socket.id);
            const validated = validate('create_tournament', rawPayload);
            if (!validated) return;
            const { username, avatar, tournamentSize = 4, gridSize = 3 } = validated;

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) { socket.emit('error', uResult.error); return; }

            const size = Number(tournamentSize);
            if (![4, 8].includes(size)) { socket.emit('error', 'Tournament size must be 4 or 8'); return; }

            const gridResult = validateNumber(gridSize, 2, 6, 'Grid size');
            if (!gridResult.valid) { socket.emit('error', gridResult.error); return; }

            const tournamentId = generateTournamentId();
            if (!tournamentId) {
                socket.emit('error', 'Failed to generate tournament ID. Please try again.');
                return;
            }

            const tournament = {
                tournamentId,
                status: 'waiting',
                tournamentSize: size,
                gridSize: gridResult.value,
                participants: [{ username: uResult.value, avatar: sanitizeAvatar(avatar), socketId: socket.id }],
                rounds: [],
                champion: null,
            };

            tournaments.set(tournamentId, tournament);
            socket.join(`tournament:${tournamentId}`);
            socket.data.tournamentId = tournamentId;
            socket.emit('tournament_created', { tournament: buildTournamentSnapshot(tournament) });
        } catch (error) {
            log.error('Error creating tournament', { error: error.message });
            socket.emit('error', 'Failed to create tournament');
        }
    });

    // ── join_tournament ───────────────────────────────────────────────────
    socket.on('join_tournament', async (rawPayload) => {
        try {
            if (rateLimited('join_tournament')) return;
            cancelLobbyTimer(socket.id);
            cancelPostgameTimer(socket.id);
            const validated = validate('join_tournament', rawPayload);
            if (!validated) return;
            const { tournamentId, username, avatar } = validated;

            const tidResult = sanitizeTournamentId(tournamentId);
            if (!tidResult.valid) { socket.emit('error', tidResult.error); return; }
            const cleanTournamentId = tidResult.value;

            const uResult = sanitizeUsername(username);
            if (!uResult.valid) { socket.emit('error', uResult.error); return; }
            const cleanUsername = uResult.value;

            const tournament = tournaments.get(cleanTournamentId);
            const joinError = getTournamentJoinError(tournament, cleanUsername, socket.id);
            if (joinError) { socket.emit('error', joinError); return; }

            tournament.participants.push({
                username: cleanUsername,
                avatar: sanitizeAvatar(avatar),
                socketId: socket.id,
            });
            socket.join(`tournament:${cleanTournamentId}`);
            socket.data.tournamentId = cleanTournamentId;

            io.to(`tournament:${cleanTournamentId}`).emit('tournament_update', {
                tournament: buildTournamentSnapshot(tournament),
            });
            socket.emit('tournament_joined', { tournament: buildTournamentSnapshot(tournament) });

            if (tournament.participants.length === tournament.tournamentSize) {
                tournament.status = 'in_progress';
                tournament.rounds = initializeBracket(tournament.participants);

                for (const p of tournament.participants) {
                    try {
                        sendPushToUser(p.username, {
                            title: '🏆 Tournament Starting!',
                            body: 'Tournament starting in 2 min! Get ready!',
                            url: `/tournament/${cleanTournamentId}`,
                            tag: `tournament-start-${cleanTournamentId}`,
                        }).catch(() => {});
                    } catch (_) { /* push is best-effort */ }
                }

                await maybeStartTournamentRound(io, tournament, 0);
                io.to(`tournament:${cleanTournamentId}`).emit('tournament_update', {
                    tournament: buildTournamentSnapshot(tournament),
                });
            }
        } catch (error) {
            log.error('Error joining tournament', { error: error.message });
            socket.emit('error', 'Failed to join tournament');
        }
    });

    // ── get_tournament_state ──────────────────────────────────────────────
    socket.on('get_tournament_state', async (rawPayload) => {
        try {
            if (rateLimited('get_tournament_state')) return;
            const validated = validate('get_tournament_state', rawPayload);
            if (!validated) return;
            const { tournamentId: rawTid } = validated;

            const tidResult = sanitizeTournamentId(rawTid);
            if (!tidResult.valid) { socket.emit('error', tidResult.error); return; }
            const cleanTournamentId = tidResult.value;

            const tournament = tournaments.get(cleanTournamentId);
            if (!tournament) { socket.emit('error', 'Tournament not found'); return; }

            const participant = tournament.participants.find((p) => p.socketId === socket.id);
            if (!participant) {
                socket.emit('tournament_update', { tournament: buildTournamentSnapshot(tournament) });
                return;
            }

            if (tournament.status === 'waiting') {
                socket.emit('tournament_update', { tournament: buildTournamentSnapshot(tournament) });
                return;
            }

            const playerUsername = participant.username;

            for (const round of tournament.rounds) {
                for (const match of round.matches) {
                    if (!match.gameId) continue;
                    if (match.winner) continue;
                    if (match.player1 !== playerUsername && match.player2 !== playerUsername) continue;

                    const game = await gameStore.getGame(match.gameId);
                    if (!game) continue;

                    for (let i = 1; i <= game.playerCount; i++) {
                        const pid = `player${i}`;
                        const player = game.players[pid];
                        if (player && player.username === playerUsername) {
                            socket.emit('tournament_game_assigned', {
                                tournamentId: cleanTournamentId,
                                gameId: match.gameId,
                                playerId: pid,
                                sessionToken: player.token,
                                gridSize: tournament.gridSize,
                                playerCount: 2,
                            });
                            return;
                        }
                    }
                }
            }

            socket.emit('tournament_update', { tournament: buildTournamentSnapshot(tournament) });
        } catch (error) {
            log.error('Error handling get_tournament_state', { error: error.message });
            socket.emit('error', 'Failed to get tournament state');
        }
    });
}

module.exports = {
    register,
    handleTournamentGameCompletion,
    // Exported for testing via _internal
    sanitizeTournamentId,
    generateTournamentId,
    buildTournamentSnapshot,
    initializeBracket,
    getTournamentJoinError,
    applyTournamentMatchResult,
    isSpectatorJoinRequest: require('./shared').isSpectatorJoinRequest,
};
