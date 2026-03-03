const { SocketRateLimiter } = require('../middleware/rateLimiter');

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
});
