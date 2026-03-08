// backend/services/matchmaking.js
/**
 * In-memory matchmaking queue for public Quick Play games.
 *
 * ## Queue Structure
 * - Queues are keyed by player preference: `"<playerCount>P:<gridSize>x<gridSize>"` (e.g. "2P:3x3").
 * - Each queue is a FIFO array of waiting player entries.
 * - When a queue reaches the required player count, the first N players are
 *   popped, matched together, and returned as a group for game creation.
 *
 * ## Matching Algorithm
 * - Exact-match only: players must share the same grid size AND player count.
 * - First-come-first-served: earliest joiners are matched first.
 * - Double-queue prevention: joining a new queue auto-removes from any prior queue.
 * - Stale entries are cleaned up periodically (STALE_ENTRY_MS).
 * - Each queue is capped at MAX_QUEUE_SIZE to prevent unbounded memory growth.
 *
 * ## Timeout
 * - After QUEUE_TIMEOUT_MS the caller is notified to suggest a CPU fallback.
 *   This constant is synced with the frontend timer thresholds (30s default).
 *   Override via QUEUE_TIMEOUT_MS env var; test env uses a shorter value.
 */

const QUEUE_TIMEOUT_MS = parseInt(process.env.QUEUE_TIMEOUT_MS, 10)
    || (process.env.NODE_ENV === 'test' ? 5_000 : 30_000);
const STALE_ENTRY_MS = 60_000;
/** Maximum players per queue key — prevents unbounded memory growth / DoS */
const MAX_QUEUE_SIZE = 100;

class MatchmakingService {
    constructor() {
        /** @type {Map<string, Array<{socketId: string, username: string, avatar: string, joinedAt: number}>>} */
        this.queues = new Map(); // key = "2P:3x3", value = waiting players

        /** @type {Map<string, {queueKey: string, timeoutTimer: ReturnType<typeof setTimeout>}>} */
        this.playerIndex = new Map(); // socketId → queue info for fast lookup

        // Stale entry cleanup interval (skip in test to avoid open handles)
        this._cleanupInterval = process.env.NODE_ENV !== 'test'
            ? setInterval(() => this.cleanStaleEntries(), STALE_ENTRY_MS)
            : null;
        if (this._cleanupInterval) this._cleanupInterval.unref();
    }

    /**
     * Build a queue key from preferences
     */
    static buildKey(playerCount, gridSize) {
        return `${playerCount}P:${gridSize}x${gridSize}`;
    }

    /**
     * Get all socket IDs currently waiting in a given queue.
     * @param {string} queueKey
     * @returns {string[]}
     */
    getWaiters(queueKey) {
        const queue = this.queues.get(queueKey);
        if (!queue) return [];
        return queue.map((e) => e.socketId);
    }

    /**
     * Add a player to the matchmaking queue.
     * Returns { queued: true, queueKey, position, queueSize }
     *       | { matched: true, players, queueKey }
     *       | { rejected: true, reason: string }
     */
    joinQueue(socketId, username, avatar, gridSize, playerCount) {
        // Prevent double-queueing
        if (this.playerIndex.has(socketId)) {
            this.leaveQueue(socketId);
        }

        const queueKey = MatchmakingService.buildKey(playerCount, gridSize);

        if (!this.queues.has(queueKey)) {
            this.queues.set(queueKey, []);
        }

        const queue = this.queues.get(queueKey);

        // Enforce queue size cap
        if (queue.length >= MAX_QUEUE_SIZE) {
            return { rejected: true, reason: 'Queue is full. Please try again later.' };
        }

        const entry = {
            socketId,
            username,
            avatar,
            gridSize,
            playerCount,
            joinedAt: Date.now(),
        };

        queue.push(entry);

        this.playerIndex.set(socketId, { queueKey, timeoutTimer: null });

        // Check if we have enough players for a match
        const matchResult = this.checkForMatch(queueKey);
        if (matchResult) {
            return { matched: true, players: matchResult, queueKey };
        }

        const position = queue.indexOf(entry) + 1;
        return { queued: true, queueKey, position, queueSize: queue.length };
    }

    /**
     * Remove a player from any queue they're in.
     * Returns true if the player was in a queue.
     */
    leaveQueue(socketId) {
        const info = this.playerIndex.get(socketId);
        if (!info) return false;

        const { queueKey, timeoutTimer } = info;
        if (timeoutTimer) clearTimeout(timeoutTimer);

        const queue = this.queues.get(queueKey);
        if (queue) {
            const idx = queue.findIndex((e) => e.socketId === socketId);
            if (idx !== -1) queue.splice(idx, 1);
            if (queue.length === 0) this.queues.delete(queueKey);
        }

        this.playerIndex.delete(socketId);
        return true;
    }

    /**
     * Check if a queue has enough players for a match.
     * If so, removes them from the queue and returns the matched players array.
     * Returns null if not enough players.
     */
    checkForMatch(queueKey) {
        const queue = this.queues.get(queueKey);
        if (!queue || queue.length === 0) return null;

        // Parse required player count from key (e.g., "2P:3x3" → 2)
        const requiredPlayers = parseInt(queueKey.split('P:')[0], 10);
        if (queue.length < requiredPlayers) return null;

        // Pop the first N players
        const matched = queue.splice(0, requiredPlayers);

        // Clean up player index for matched players
        for (const player of matched) {
            const info = this.playerIndex.get(player.socketId);
            if (info?.timeoutTimer) clearTimeout(info.timeoutTimer);
            this.playerIndex.delete(player.socketId);
        }

        if (queue.length === 0) this.queues.delete(queueKey);

        return matched;
    }

    /**
     * Get queue status for a specific player.
     */
    getQueueStatus(socketId) {
        const info = this.playerIndex.get(socketId);
        if (!info) return null;

        const queue = this.queues.get(info.queueKey);
        if (!queue) return null;

        const idx = queue.findIndex((e) => e.socketId === socketId);
        return {
            position: idx + 1,
            queueSize: queue.length,
            queueKey: info.queueKey,
        };
    }

    /**
     * Store the timeout timer handle for a queued player (so we can cancel on leave/match).
     */
    setTimeoutTimer(socketId, timer) {
        const info = this.playerIndex.get(socketId);
        if (info) {
            info.timeoutTimer = timer;
        }
    }

    /**
     * Check if a player is currently in a queue.
     */
    isInQueue(socketId) {
        return this.playerIndex.has(socketId);
    }

    /**
     * Remove entries older than STALE_ENTRY_MS.
     * Returns the number of stale entries removed.
     */
    cleanStaleEntries() {
        const now = Date.now();
        let removed = 0;

        for (const [queueKey, queue] of this.queues.entries()) {
            for (let i = queue.length - 1; i >= 0; i--) {
                if (now - queue[i].joinedAt > STALE_ENTRY_MS) {
                    const entry = queue[i];
                    const info = this.playerIndex.get(entry.socketId);
                    if (info?.timeoutTimer) clearTimeout(info.timeoutTimer);
                    this.playerIndex.delete(entry.socketId);
                    queue.splice(i, 1);
                    removed++;
                }
            }
            if (queue.length === 0) this.queues.delete(queueKey);
        }

        return removed;
    }

    /**
     * Reset all queues (useful for testing).
     */
    reset() {
        for (const [, info] of this.playerIndex) {
            if (info.timeoutTimer) clearTimeout(info.timeoutTimer);
        }
        this.queues.clear();
        this.playerIndex.clear();
    }

    /**
     * Destroy the service (clean up intervals).
     */
    destroy() {
        this.reset();
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }
}

// Export the class (tests can create instances) and a singleton
const matchmaking = new MatchmakingService();

module.exports = matchmaking;
module.exports.MatchmakingService = MatchmakingService;
module.exports.QUEUE_TIMEOUT_MS = QUEUE_TIMEOUT_MS;
module.exports.MAX_QUEUE_SIZE = MAX_QUEUE_SIZE;
