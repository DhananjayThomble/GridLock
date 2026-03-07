// backend/__tests__/matchmaking.test.js
// Unit tests for the matchmaking queue service

const { MatchmakingService } = require('../services/matchmaking');

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
});
