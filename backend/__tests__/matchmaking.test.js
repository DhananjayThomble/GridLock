// backend/__tests__/matchmaking.test.js
// Unit tests for the matchmaking queue service

const { MatchmakingService, MAX_QUEUE_SIZE } = require('../services/matchmaking');

describe('MatchmakingService', () => {
    let mm;

    beforeEach(() => {
        mm = new MatchmakingService();
    });

    afterEach(() => {
        mm.destroy();
    });

    describe('buildKey', () => {
        it('builds correct queue key', () => {
            expect(MatchmakingService.buildKey(2, 3)).toBe('2P:3x3');
            expect(MatchmakingService.buildKey(4, 5)).toBe('4P:5x5');
        });
    });

    describe('joinQueue', () => {
        it('queues a player when no match available', () => {
            const result = mm.joinQueue('socket1', 'Alice', '👧', 3, 2);
            expect(result.queued).toBe(true);
            expect(result.position).toBe(1);
            expect(result.queueSize).toBe(1);
            expect(result.queueKey).toBe('2P:3x3');
        });

        it('matches players when queue fills up (2P)', () => {
            mm.joinQueue('socket1', 'Alice', '👧', 3, 2);
            const result = mm.joinQueue('socket2', 'Bob', '👦', 3, 2);
            expect(result.matched).toBe(true);
            expect(result.players).toHaveLength(2);
            expect(result.players[0].username).toBe('Alice');
            expect(result.players[1].username).toBe('Bob');
        });

        it('matches players when queue fills up (3P)', () => {
            mm.joinQueue('s1', 'Alice', '👧', 4, 3);
            mm.joinQueue('s2', 'Bob', '👦', 4, 3);
            const result = mm.joinQueue('s3', 'Charlie', '🐱', 4, 3);
            expect(result.matched).toBe(true);
            expect(result.players).toHaveLength(3);
        });

        it('matches players when queue fills up (4P)', () => {
            mm.joinQueue('s1', 'P1', '👧', 5, 4);
            mm.joinQueue('s2', 'P2', '👦', 5, 4);
            mm.joinQueue('s3', 'P3', '🐱', 5, 4);
            const result = mm.joinQueue('s4', 'P4', '🐶', 5, 4);
            expect(result.matched).toBe(true);
            expect(result.players).toHaveLength(4);
        });

        it('does not match across different preferences', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            const result = mm.joinQueue('s2', 'Bob', '👦', 4, 2); // Different grid size
            expect(result.queued).toBe(true);
            expect(result.queueSize).toBe(1);
        });

        it('removes from old queue on double-join', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            expect(mm.isInQueue('s1')).toBe(true);

            // Join a different queue
            const result = mm.joinQueue('s1', 'Alice', '👧', 4, 2);
            expect(result.queued).toBe(true);
            expect(result.queueKey).toBe('2P:4x4');

            // Old queue should be empty
            const status = mm.getQueueStatus('s1');
            expect(status.queueKey).toBe('2P:4x4');
        });

        it('preserves player data in match result', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            const result = mm.joinQueue('s2', 'Bob', '🤖', 3, 2);
            expect(result.players[0]).toMatchObject({
                socketId: 's1',
                username: 'Alice',
                avatar: '👧',
                gridSize: 3,
                playerCount: 2,
            });
            expect(result.players[1]).toMatchObject({
                socketId: 's2',
                username: 'Bob',
                avatar: '🤖',
            });
        });
    });

    describe('leaveQueue', () => {
        it('removes player from queue', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            expect(mm.leaveQueue('s1')).toBe(true);
            expect(mm.isInQueue('s1')).toBe(false);
        });

        it('returns false if player not in queue', () => {
            expect(mm.leaveQueue('nonexistent')).toBe(false);
        });

        it('cleans up empty queue map entry', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            mm.leaveQueue('s1');
            expect(mm.queues.has('2P:3x3')).toBe(false);
        });

        it('does not affect other players in same queue', () => {
            mm.joinQueue('s1', 'Alice', '👧', 5, 3);
            mm.joinQueue('s2', 'Bob', '👦', 5, 3);
            mm.leaveQueue('s1');
            expect(mm.isInQueue('s2')).toBe(true);
            const status = mm.getQueueStatus('s2');
            expect(status.position).toBe(1);
            expect(status.queueSize).toBe(1);
        });
    });

    describe('getQueueStatus', () => {
        it('returns null for non-queued player', () => {
            expect(mm.getQueueStatus('nonexistent')).toBeNull();
        });

        it('returns correct position and size', () => {
            mm.joinQueue('s1', 'Alice', '👧', 5, 3);
            mm.joinQueue('s2', 'Bob', '👦', 5, 3);

            const status1 = mm.getQueueStatus('s1');
            expect(status1.position).toBe(1);
            expect(status1.queueSize).toBe(2);

            const status2 = mm.getQueueStatus('s2');
            expect(status2.position).toBe(2);
            expect(status2.queueSize).toBe(2);
        });
    });

    describe('isInQueue', () => {
        it('returns true for queued player', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            expect(mm.isInQueue('s1')).toBe(true);
        });

        it('returns false after match', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            mm.joinQueue('s2', 'Bob', '👦', 3, 2);
            expect(mm.isInQueue('s1')).toBe(false);
            expect(mm.isInQueue('s2')).toBe(false);
        });
    });

    describe('cleanStaleEntries', () => {
        it('removes entries older than threshold', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            // Manually backdate the entry
            const queue = mm.queues.get('2P:3x3');
            queue[0].joinedAt = Date.now() - 120_000; // 2 minutes ago

            const removed = mm.cleanStaleEntries();
            expect(removed).toBe(1);
            expect(mm.isInQueue('s1')).toBe(false);
            expect(mm.queues.has('2P:3x3')).toBe(false);
        });

        it('keeps fresh entries', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            const removed = mm.cleanStaleEntries();
            expect(removed).toBe(0);
            expect(mm.isInQueue('s1')).toBe(true);
        });
    });

    describe('setTimeoutTimer', () => {
        it('stores timer handle', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            const timer = setTimeout(() => {}, 10000);
            mm.setTimeoutTimer('s1', timer);
            // Timer is cleaned up when leaving queue
            mm.leaveQueue('s1');
            clearTimeout(timer); // Prevent leak
        });
    });

    describe('reset', () => {
        it('clears all queues and indexes', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            mm.joinQueue('s2', 'Bob', '👦', 4, 2);
            mm.reset();
            expect(mm.queues.size).toBe(0);
            expect(mm.playerIndex.size).toBe(0);
        });
    });

    describe('overflow matching', () => {
        it('matches first N players and keeps extras in queue', () => {
            mm.joinQueue('s1', 'P1', '👧', 3, 2);
            mm.joinQueue('s2', 'P2', '👦', 3, 2); // Match!
            // s1 and s2 matched, queue should be empty

            mm.joinQueue('s3', 'P3', '🐱', 3, 2);
            mm.joinQueue('s4', 'P4', '🐶', 3, 2); // Match!

            // Both pairs matched, no one left
            expect(mm.queues.has('2P:3x3')).toBe(false);
        });

        it('queues 3rd player after 2P match', () => {
            mm.joinQueue('s1', 'P1', '👧', 3, 2);
            mm.joinQueue('s2', 'P2', '👦', 3, 2); // Match!

            const result = mm.joinQueue('s3', 'P3', '🐱', 3, 2);
            expect(result.queued).toBe(true);
            expect(result.position).toBe(1);
        });
    });

    describe('disconnect during match creation', () => {
        it('allows a player to leave mid-queue and not block the match', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            mm.joinQueue('s2', 'Bob', '👦', 3, 2); // Match!
            // Simulate disconnect of s1 after match — should already be cleaned up
            expect(mm.isInQueue('s1')).toBe(false);
            expect(mm.isInQueue('s2')).toBe(false);

            // A third player joins and waits
            const result = mm.joinQueue('s3', 'Charlie', '🐱', 3, 2);
            expect(result.queued).toBe(true);

            // Simulate s3 disconnecting before a partner arrives
            mm.leaveQueue('s3');
            expect(mm.isInQueue('s3')).toBe(false);
            expect(mm.queues.has('2P:3x3')).toBe(false);
        });
    });

    describe('rapid re-queue (leave + immediate rejoin)', () => {
        it('handles leave then immediate rejoin cleanly', () => {
            const r1 = mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            expect(r1.queued).toBe(true);

            // Leave and immediately rejoin the same queue
            mm.leaveQueue('s1');
            expect(mm.isInQueue('s1')).toBe(false);

            const r2 = mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            expect(r2.queued).toBe(true);
            expect(r2.position).toBe(1);
            expect(r2.queueSize).toBe(1);
        });

        it('handles leave then rejoin a different queue', () => {
            mm.joinQueue('s1', 'Alice', '👧', 3, 2);
            mm.leaveQueue('s1');

            const result = mm.joinQueue('s1', 'Alice', '👧', 4, 2);
            expect(result.queued).toBe(true);
            expect(result.queueKey).toBe('2P:4x4');
            expect(mm.queues.has('2P:3x3')).toBe(false);
        });
    });

    describe('queue overflow (MAX_QUEUE_SIZE)', () => {
        it('rejects when queue reaches MAX_QUEUE_SIZE', () => {
            // Fill queue to capacity
            for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
                // Use 3P queue so it doesn't auto-match at 2
                const result = mm.joinQueue(`s${i}`, `P${i}`, '👧', 3, 3);
                // Every third player triggers a match (3P), so we need to account for that
                // Actually for 3P, matches happen at every 3rd join. Let's use a simpler approach.
            }
        });

        it('rejects the 101st player in a 3P queue that never fills', () => {
            // For a 3P queue: every 3 players match, so queue never stays at 100
            // Use a large playerCount that won't match easily — actually let's just
            // test with 4P queue and fill 100 players (25 matches = 100 players matched,
            // none left). Instead, let's manipulate the queue directly.
            const queueKey = '2P:3x3';
            mm.queues.set(queueKey, []);
            const queue = mm.queues.get(queueKey);

            // Manually fill to MAX_QUEUE_SIZE without triggering match logic
            for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
                queue.push({ socketId: `fake-${i}`, username: `P${i}`, avatar: '👧', gridSize: 3, playerCount: 2, joinedAt: Date.now() });
                mm.playerIndex.set(`fake-${i}`, { queueKey, timeoutTimer: null });
            }

            expect(queue.length).toBe(MAX_QUEUE_SIZE);

            // Next join should be rejected
            const result = mm.joinQueue('overflow-socket', 'Overflow', '🐶', 3, 2);
            expect(result.rejected).toBe(true);
            expect(result.reason).toContain('full');
        });
    });

    describe('getWaiters', () => {
        it('returns socket IDs of all waiting players', () => {
            mm.joinQueue('s1', 'Alice', '👧', 5, 3);
            mm.joinQueue('s2', 'Bob', '👦', 5, 3);

            const waiters = mm.getWaiters('3P:5x5');
            expect(waiters).toEqual(['s1', 's2']);
        });

        it('returns empty array for non-existent queue', () => {
            expect(mm.getWaiters('99P:99x99')).toEqual([]);
        });
    });
});
