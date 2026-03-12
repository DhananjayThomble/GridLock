const { SocketRateLimiter, IPRateLimiter, checkRateLimit, MAX_IP_TRACKER_SIZE } = require('../middleware/rateLimiter');

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
  });

  test('test environment bypasses socket throttling', () => {
    process.env.NODE_ENV = 'test';
    const limiter = new SocketRateLimiter();

    for (let i = 0; i < 100; i += 1) {
      expect(limiter.allow('socket-test', 'create_game')).toBe(true);
    }
  });

  test('global per-socket rate limit blocks after 10 events/second', () => {
    const limiter = new SocketRateLimiter();
    const socketId = 's-global';

    // Use an event with no per-event limit to test global only
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow(socketId, 'unknown_event')).toBe(true);
    }
    // 11th event in same second should be blocked by global limit
    expect(limiter.allow(socketId, 'unknown_event')).toBe(false);
  });

  test('tournament creation is rate limited', () => {
    const limiter = new SocketRateLimiter();
    const socketId = 's-tournament';

    for (let i = 0; i < 3; i++) {
      expect(limiter.allow(socketId, 'create_tournament')).toBe(true);
    }
    expect(limiter.allow(socketId, 'create_tournament')).toBe(false);
  });
});

describe('IPRateLimiter', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('allows up to max events per IP per window then blocks', () => {
    const limiter = new IPRateLimiter();
    const ip = '192.168.1.1';

    // queue_join: 10 per minute (raised from 3 in #203)
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow(ip, 'queue_join')).toBe(true);
    }
    expect(limiter.allow(ip, 'queue_join')).toBe(false);
  });

  test('different IPs have independent limits', () => {
    const limiter = new IPRateLimiter();

    for (let i = 0; i < 10; i++) {
      limiter.allow('10.0.0.1', 'queue_join');
    }
    expect(limiter.allow('10.0.0.1', 'queue_join')).toBe(false);
    expect(limiter.allow('10.0.0.2', 'queue_join')).toBe(true);
  });

  test('resets after window expires', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new IPRateLimiter();
    const ip = '192.168.1.2';

    for (let i = 0; i < 15; i++) {
      limiter.allow(ip, 'create_game');
    }
    expect(limiter.allow(ip, 'create_game')).toBe(false);

    jest.setSystemTime(now + 60_001);
    expect(limiter.allow(ip, 'create_game')).toBe(true);

    jest.useRealTimers();
  });

  test('test environment bypasses IP throttling', () => {
    process.env.NODE_ENV = 'test';
    const limiter = new IPRateLimiter();

    for (let i = 0; i < 100; i++) {
      expect(limiter.allow('1.2.3.4', 'queue_join')).toBe(true);
    }
  });

  test('tournament creation limited to 2 per minute per IP', () => {
    const limiter = new IPRateLimiter();
    const ip = '10.0.0.5';

    expect(limiter.allow(ip, 'create_tournament')).toBe(true);
    expect(limiter.allow(ip, 'create_tournament')).toBe(true);
    expect(limiter.allow(ip, 'create_tournament')).toBe(false);
  });

  test('purgeStale removes expired entries', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const limiter = new IPRateLimiter();
    limiter.allow('stale-ip', 'queue_join');

    jest.setSystemTime(now + 6 * 60_000);
    limiter.purgeStale();

    expect(limiter.trackers.has('stale-ip')).toBe(false);

    jest.useRealTimers();
  });

  test('rejects new IPs when tracker map reaches maxTrackerSize (OOM guard)', () => {
    const limiter = new IPRateLimiter(3); // tiny cap for testing
    // Fill up the tracker with 3 IPs
    for (let i = 0; i < 3; i++) {
      expect(limiter.allow(`10.0.0.${i}`, 'queue_join')).toBe(true);
    }
    // 4th IP should be rejected (fail-closed)
    expect(limiter.allow('10.0.0.99', 'queue_join')).toBe(false);
    // Existing IPs should still work
    expect(limiter.allow('10.0.0.0', 'queue_join')).toBe(true);
  });

  test('MAX_IP_TRACKER_SIZE is exported and reasonable', () => {
    expect(MAX_IP_TRACKER_SIZE).toBe(10_000);
  });
});

describe('checkRateLimit (shared)', () => {
  test('allows up to maxPerWindow then blocks', () => {
    const tracker = new Map();
    const limit = { maxPerWindow: 3, windowMs: 60_000 };
    const now = Date.now();

    expect(checkRateLimit(tracker, 'test', limit, now)).toBe(true);
    expect(checkRateLimit(tracker, 'test', limit, now)).toBe(true);
    expect(checkRateLimit(tracker, 'test', limit, now)).toBe(true);
    expect(checkRateLimit(tracker, 'test', limit, now)).toBe(false);
  });

  test('resets after window expires', () => {
    const tracker = new Map();
    const limit = { maxPerWindow: 1, windowMs: 1_000 };
    const now = Date.now();

    expect(checkRateLimit(tracker, 'test', limit, now)).toBe(true);
    expect(checkRateLimit(tracker, 'test', limit, now)).toBe(false);
    expect(checkRateLimit(tracker, 'test', limit, now + 1_001)).toBe(true);
  });
});
