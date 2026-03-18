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
const GC_INTERVAL_MS       = 5 * 60 * 1000;     // Run every 5 minutes

/**
 * Check if a game is fully abandoned (all players disconnected).
 * @param {Object} game
 * @returns {{ abandoned: boolean, oldestDisconnect: Date|null }}
 */
function isFullyAbandoned(game) {
    if (!game.players || !game.playerCount) return { abandoned: false, oldestDisconnect: null };

    let allDisconnected = true;
    let oldestDisconnect = null;

    for (let i = 1; i <= game.playerCount; i++) {
        const player = game.players[`player${i}`];
        if (!player) continue; // empty slot
        if (!player.disconnectedAt) {
            allDisconnected = false;
            break;
        }
        const dt = new Date(player.disconnectedAt);
        if (!oldestDisconnect || dt < oldestDisconnect) {
            oldestDisconnect = dt;
        }
    }

    // Defensive guard: handle games where all player slots are null (empty).
    // The loop above would leave allDisconnected=true but oldestDisconnect=null,
    // so we need this check to provide a valid fallback timestamp.
    const hasAnyPlayer = Object.keys(game.players || {}).some(
        k => k.startsWith('player') && game.players[k]
    );
    if (!hasAnyPlayer) {
        return { abandoned: true, oldestDisconnect: game.createdAt ? new Date(game.createdAt) : new Date(0) };
    }

    return { abandoned: allDisconnected, oldestDisconnect };
}

/**
 * Start the periodic game cleanup interval.
 * @param {Object} gameStore - The game store module
 * @param {Object} log - Logger instance
 * @returns {NodeJS.Timeout} The interval handle (call .unref() if needed)
 */
function startGameCleanup(gameStore, log) {
    const interval = setInterval(async () => {
        try {
            const allGames = await gameStore.getAllActiveGames();
            const now = Date.now();
            let zombieCount = 0;
            let waitingCount = 0;

            for (const [gameId, game] of allGames.entries()) {
                // Check for fully abandoned games (all players disconnected for > ABANDONED_GAME_TTL_MS)
                const { abandoned, oldestDisconnect } = isFullyAbandoned(game);
                if (abandoned && oldestDisconnect) {
                    const abandonedMs = now - new Date(oldestDisconnect).getTime();
                    if (abandonedMs > ABANDONED_GAME_TTL_MS) {
                        await gameStore.deleteGame(gameId);
                        zombieCount++;
                        continue;
                    }
                }

                // Check for stale waiting games (status 'waiting', idle > WAITING_GAME_TTL_MS)
                if (game.status === 'waiting' || (!game.gameState?.currentPlayer && !game.gameState?.winner)) {
                    const createdAt = game.createdAt ? new Date(game.createdAt).getTime() : 0;
                    if (createdAt > 0 && (now - createdAt) > WAITING_GAME_TTL_MS) {
                        await gameStore.deleteGame(gameId);
                        waitingCount++;
                        continue;
                    }
                }

                // Check for finished games lingering > 5 minutes (defensive cleanup)
                if (game.gameState?.winner) {
                    const finishedAt = game.finishedAt ? new Date(game.finishedAt).getTime() : 0;
                    const createdAt = game.createdAt ? new Date(game.createdAt).getTime() : 0;
                    const refTime = finishedAt || createdAt;
                    if (refTime > 0 && (now - refTime) > ABANDONED_GAME_TTL_MS) {
                        await gameStore.deleteGame(gameId);
                        zombieCount++;
                        continue;
                    }
                }
            }

            const total = zombieCount + waitingCount;
            if (total > 0) {
                log.info(`Game GC: cleaned up ${total} games`, { zombie: zombieCount, staleWaiting: waitingCount });
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

module.exports = { startGameCleanup, isFullyAbandoned, ABANDONED_GAME_TTL_MS, WAITING_GAME_TTL_MS, GC_INTERVAL_MS };
