// services/gameCleanup.js
// Periodic garbage collection for zombie games (#365 Bug #14)
//
// Multi-node safety: This GC is designed to be idempotent — running on multiple
// server nodes simultaneously is safe. Redis `DEL` and local Map `delete` are
// both idempotent operations, so concurrent sweeps won't cause data corruption.
//
// At scale (10+ nodes), consider using a Redis-based distributed lock (e.g.,
// Redlock) to avoid redundant work and reduce Redis chatter. Current
// implementation is acceptable for single-node and small-cluster deployments.

const ABANDONED_GAME_TTL_MS = 5 * 60 * 1000;    // 5 minutes - fully abandoned games
const WAITING_GAME_TTL_MS  = 30 * 60 * 1000;    // 30 minutes - idle waiting games
const MONGO_STALE_TTL_MS   = 60 * 60 * 1000;    // 1 hour - MongoDB zombie threshold
const GC_INTERVAL_MS       = 5 * 60 * 1000;     // Run every 5 minutes

/**
 * Check if a game is fully abandoned (all players disconnected).
 *
 * Time-based fallback: If the game hasn't been updated in over 1 hour AND
 * no sockets are connected (checked via activeGameIds set), treat it as
 * abandoned even if some players have disconnectedAt: undefined (e.g.,
 * browser tab closed before socket disconnect fired).
 *
 * @param {Object} game
 * @param {Object} [options]
 * @param {Set} [options.activeGameIds] - Set of gameIds currently in the in-memory store
 * @returns {{ abandoned: boolean, oldestDisconnect: Date|null }}
 */
function isFullyAbandoned(game, options) {
    if (!game.players || !game.playerCount) return { abandoned: false, oldestDisconnect: null };

    const opts = options || {};
    let allDisconnected = true;
    let oldestDisconnect = null;
    let hasUndefinedDisconnect = false;

    for (let i = 1; i <= game.playerCount; i++) {
        const player = game.players['player' + i];
        if (!player) continue; // empty slot
        if (!player.disconnectedAt) {
            allDisconnected = false;
            hasUndefinedDisconnect = true;
            continue;
        }
        const dt = new Date(player.disconnectedAt);
        if (!oldestDisconnect || dt < oldestDisconnect) {
            oldestDisconnect = dt;
        }
    }

    // Defensive guard: handle games where all player slots are null (empty).
    const hasAnyPlayer = Object.keys(game.players || {}).some(
        function(k) { return k.startsWith('player') && game.players[k]; }
    );
    if (!hasAnyPlayer) {
        return { abandoned: true, oldestDisconnect: game.createdAt ? new Date(game.createdAt) : new Date(0) };
    }

    // Time-based fallback for games with undefined disconnectedAt:
    // If game hasn't been updated in > 1 hour and has players with missing
    // disconnectedAt, check if any sockets are actually connected.
    if (hasUndefinedDisconnect && !allDisconnected) {
        var refTime = game.updatedAt || game.lastActivityAt || game.createdAt;
        var gameAge = refTime ? Date.now() - new Date(refTime).getTime() : 0;

        if (gameAge > MONGO_STALE_TTL_MS) {
            var hasActiveSockets = false;

            if (opts.activeGameIds instanceof Set) {
                hasActiveSockets = opts.activeGameIds.has(game.gameId);
            }

            if (!hasActiveSockets) {
                var fallbackTime = refTime ? new Date(refTime) : new Date(0);
                return { abandoned: true, oldestDisconnect: oldestDisconnect || fallbackTime };
            }
        }
    }

    return { abandoned: allDisconnected, oldestDisconnect: oldestDisconnect };
}

/**
 * Sweep MongoDB for zombie games that only exist in the database
 * (not in Redis/in-memory store) after server restarts.
 *
 * Finds games with status playing or waiting that haven't been
 * updated in over MONGO_STALE_TTL_MS and marks them as abandoned.
 *
 * @param {Object} Game - Mongoose Game model
 * @param {Object} log - Logger instance
 * @returns {Promise<number>} Number of games marked as abandoned
 */
async function sweepMongoZombies(Game, log) {
    var cutoff = new Date(Date.now() - MONGO_STALE_TTL_MS);

    var result = await Game.updateMany(
        {
            status: { $in: ['playing', 'waiting'] },
            updatedAt: { $lt: cutoff },
        },
        {
            $set: {
                status: 'abandoned',
                finishedAt: new Date(),
                'metadata.reason': 'gc_mongo_sweep',
            },
        }
    );

    return result.modifiedCount || 0;
}

/**
 * Start the periodic game cleanup interval.
 * @param {Object} gameStore - The game store module
 * @param {Object} log - Logger instance
 * @param {Object} [Game] - Mongoose Game model (optional, for MongoDB sweep)
 * @returns {NodeJS.Timeout} The interval handle (call .unref() if needed)
 */
function startGameCleanup(gameStore, log, Game) {
    var interval = setInterval(async function() {
        try {
            // --- Pass 1: In-memory/Redis sweep (existing logic) ---
            var allGames = await gameStore.getAllActiveGames();
            var now = Date.now();
            var zombieCount = 0;
            var waitingCount = 0;

            // Build a set of active game IDs for the fallback check
            var activeGameIds = new Set();
            for (var entry of allGames.entries()) {
                activeGameIds.add(entry[0]);
            }

            for (var gameEntry of allGames.entries()) {
                var gameId = gameEntry[0];
                var game = gameEntry[1];

                // Check for fully abandoned games
                var abandonResult = isFullyAbandoned(game, { activeGameIds: activeGameIds });
                if (abandonResult.abandoned && abandonResult.oldestDisconnect) {
                    var abandonedMs = now - new Date(abandonResult.oldestDisconnect).getTime();
                    if (abandonedMs > ABANDONED_GAME_TTL_MS) {
                        await gameStore.deleteGame(gameId);
                        await gameStore.deleteSpectatorCount(gameId);
                        zombieCount++;
                        continue;
                    }
                }

                // Check for stale waiting games
                if (game.status === 'waiting' || (!game.gameState?.currentPlayer && !game.gameState?.winner)) {
                    var createdAt = game.createdAt ? new Date(game.createdAt).getTime() : 0;
                    if (createdAt > 0 && (now - createdAt) > WAITING_GAME_TTL_MS) {
                        await gameStore.deleteGame(gameId);
                        await gameStore.deleteSpectatorCount(gameId);
                        waitingCount++;
                        continue;
                    }
                }

                // Check for finished games lingering > 5 minutes
                if (game.gameState?.winner) {
                    var finishedAt = game.finishedAt ? new Date(game.finishedAt).getTime() : 0;
                    var gameCreatedAt = game.createdAt ? new Date(game.createdAt).getTime() : 0;
                    var refTime = finishedAt || gameCreatedAt;
                    if (refTime > 0 && (now - refTime) > ABANDONED_GAME_TTL_MS) {
                        await gameStore.deleteGame(gameId);
                        await gameStore.deleteSpectatorCount(gameId);
                        zombieCount++;
                        continue;
                    }
                }
            }

            var inMemoryTotal = zombieCount + waitingCount;
            if (inMemoryTotal > 0) {
                log.info('Game GC: cleaned up ' + inMemoryTotal + ' in-memory games', { zombie: zombieCount, staleWaiting: waitingCount });
            }

            // --- Pass 2: MongoDB sweep for zombie games ---
            if (Game) {
                var mongoCleanedCount = await sweepMongoZombies(Game, log);
                if (mongoCleanedCount > 0) {
                    log.info('Game GC: marked ' + mongoCleanedCount + ' MongoDB zombie games as abandoned');
                }
            }
        } catch (err) {
            log.error('Game GC sweep failed', { error: err.message });
        }
    }, GC_INTERVAL_MS);

    // Don't prevent graceful shutdown
    interval.unref();

    log.info('Game cleanup service started', { intervalMs: GC_INTERVAL_MS });
    return interval;
}

module.exports = {
    startGameCleanup: startGameCleanup,
    isFullyAbandoned: isFullyAbandoned,
    sweepMongoZombies: sweepMongoZombies,
    ABANDONED_GAME_TTL_MS: ABANDONED_GAME_TTL_MS,
    WAITING_GAME_TTL_MS: WAITING_GAME_TTL_MS,
    MONGO_STALE_TTL_MS: MONGO_STALE_TTL_MS,
    GC_INTERVAL_MS: GC_INTERVAL_MS,
};
