const { SocketRateLimiter, IPRateLimiter, GLOBAL_EVENTS_PER_SECOND, EVENT_LIMITS } = require('../middleware/rateLimiter');

describe('SocketRateLimiter', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('allows up to max events per window then blocks', () => {
    const limiter = new SocketRateLimiter();
    const socketId = 's1';

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.allow(socketId, 'create_game')).toBe(true);
    }
    expect(limiter.allow(socketId, 'create_game')).toBe(false);
  });

  test('resets counts after window expires', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new SocketRateLimiter();
    const socketId = 's2';

    for (let i = 0; i < 10; i += 1) {
      expect(limiter.allow(socketId, 'join_game')).toBe(true);
    }
    expect(limiter.allow(socketId, 'join_game')).toBe(false);

    jest.setSystemTime(now + 60_001);
    expect(limiter.allow(socketId, 'join_game')).toBe(true);

    jest.useRealTimers();
  });

  test('cleanup removes socket tracking state', () => {
    const limiter = new SocketRateLimiter();
    limiter.allow('socket-clean', 'make_move');
    expect(limiter.trackers.has('socket-clean')).toBe(true);

    limiter.cleanup('socket-clean');
    expect(limiter.trackers.has('socket-clean')).toBe(false);
    expect(limiter.globalTrackers.has('socket-clean')).toBe(false);
  });

  test('test environment bypasses socket throttling', () => {
    process.env.NODE_ENV = 'test';
    const limiter = new SocketRateLimiter();

    for (let i = 0; i < 100; i += 1) {
      expect(limiter.allow('socket-test', 'create_game')).toBe(true);
    }
  });

  // ── Global flood protection ──────────────────────────────────────────────
  test('blocks events exceeding global events-per-second limit', () => {
    const limiter = new SocketRateLimiter();
    const socketId = 'flood-socket';

    // Events with no per-event limit still hit the global cap
    for (let i = 0; i < GLOBAL_EVENTS_PER_SECOND; i++) {
      expect(limiter.allow(socketId, 'unknown_event')).toBe(true);
    }
    expect(limiter.allow(socketId, 'unknown_event')).toBe(false);
  });

  test('global flood counter resets after 1 second', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new SocketRateLimiter();
    const socketId = 'flood-reset';

    for (let i = 0; i < GLOBAL_EVENTS_PER_SECOND; i++) {
      limiter.allow(socketId, 'unknown_event');
    }
    expect(limiter.allow(socketId, 'unknown_event')).toBe(false);

    jest.setSystemTime(now + 1001);
    expect(limiter.allow(socketId, 'unknown_event')).toBe(true);

    jest.useRealTimers();
  });

  test('purgeStale cleans up old entries and global trackers', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new SocketRateLimiter();
    limiter.allow('stale-socket', 'make_move');
    expect(limiter.trackers.has('stale-socket')).toBe(true);

    // Advance past max stale age (5 minutes)
    jest.setSystemTime(now + 6 * 60_000);
    limiter.purgeStale();

    expect(limiter.trackers.has('stale-socket')).toBe(false);
    expect(limiter.globalTrackers.has('stale-socket')).toBe(false);

    jest.useRealTimers();
  });

  // ── Event limit configuration ────────────────────────────────────────────
  test('queue_join is limited to 3 per minute', () => {
    const limiter = new SocketRateLimiter();
    const socketId = 'queue-socket';

    for (let i = 0; i < 3; i++) {
      expect(limiter.allow(socketId, 'queue_join')).toBe(true);
    }
    expect(limiter.allow(socketId, 'queue_join')).toBe(false);
  });

  test('create_tournament is limited to 3 per minute', () => {
    const limiter = new SocketRateLimiter();
    const socketId = 'tourney-socket';

    for (let i = 0; i < 3; i++) {
      expect(limiter.allow(socketId, 'create_tournament')).toBe(true);
    }
    expect(limiter.allow(socketId, 'create_tournament')).toBe(false);
  });
});

// ─── IP Rate Limiter ─────────────────────────────────────────────────────────

describe('IPRateLimiter', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('limits queue_join to 3 per minute per IP', () => {
    const limiter = new IPRateLimiter();
    const ip = '192.168.1.1';

    for (let i = 0; i < 3; i++) {
      expect(limiter.allow(ip, 'queue_join')).toBe(true);
    }
    expect(limiter.allow(ip, 'queue_join')).toBe(false);
  });

  test('limits create_game to 5 per minute per IP', () => {
    const limiter = new IPRateLimiter();
    const ip = '10.0.0.1';

    for (let i = 0; i < 5; i++) {
      expect(limiter.allow(ip, 'create_game')).toBe(true);
    }
    expect(limiter.allow(ip, 'create_game')).toBe(false);
  });

  test('limits create_tournament to 3 per minute per IP', () => {
    const limiter = new IPRateLimiter();
    const ip = '172.16.0.1';

    for (let i = 0; i < 3; i++) {
      expect(limiter.allow(ip, 'create_tournament')).toBe(true);
    }
    expect(limiter.allow(ip, 'create_tournament')).toBe(false);
  });

  test('different IPs have independent limits', () => {
    const limiter = new IPRateLimiter();

    for (let i = 0; i < 3; i++) {
      limiter.allow('1.1.1.1', 'queue_join');
    }
    expect(limiter.allow('1.1.1.1', 'queue_join')).toBe(false);
    expect(limiter.allow('2.2.2.2', 'queue_join')).toBe(true);
  });

  test('resets after window expires', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new IPRateLimiter();
    const ip = '10.0.0.2';

    for (let i = 0; i < 3; i++) {
      limiter.allow(ip, 'queue_join');
    }
    expect(limiter.allow(ip, 'queue_join')).toBe(false);

    jest.setSystemTime(now + 60_001);
    expect(limiter.allow(ip, 'queue_join')).toBe(true);

    jest.useRealTimers();
  });

  test('bypasses in test environment', () => {
    process.env.NODE_ENV = 'test';
    const limiter = new IPRateLimiter();

    for (let i = 0; i < 100; i++) {
      expect(limiter.allow('1.1.1.1', 'queue_join')).toBe(true);
    }
  });

  test('purgeStale removes old entries', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new IPRateLimiter();
    limiter.allow('1.1.1.1', 'queue_join');
    expect(limiter.trackers.size).toBe(1);

    jest.setSystemTime(now + 6 * 60_000);
    limiter.purgeStale();
    expect(limiter.trackers.size).toBe(0);

    jest.useRealTimers();
  });
});
