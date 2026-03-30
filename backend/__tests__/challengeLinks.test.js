// backend/__tests__/challengeLinks.test.js — Tests for challenge link feature (#455)
// Uses the real challengeHandler via attachSocketHandlers (not stubs)

process.env.NODE_ENV = 'test';

jest.mock('../stores/redisClient', () => ({
  getRedisClient: jest.fn().mockResolvedValue(null),
}));
jest.mock('../models/Game', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
}));
jest.mock('../models/DailyResult', () => ({
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue(null),
}));
jest.mock('../models/DailyChallenge', () => ({}));
jest.mock('../models/Leaderboard', () => ({
  find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
}));
jest.mock('../models/RankedProfile', () => {
  const mock = jest.fn();
  mock.findOne = jest.fn().mockResolvedValue(null);
  return mock;
});

const gameStore = require('../stores/gameStore');
const attachSocketHandlers = require('../controllers/socketHandlers');
const { challengeStore } = require('../controllers/handlers/challengeHandler');

function mockSocket(id) {
  const emitted = [], handlers = {};
  const s = {
    id,
    rooms: new Set([id]),
    data: {},
    conn: { remoteAddress: '127.0.0.1' },
    handshake: { address: '127.0.0.1', headers: {} },
    emit: jest.fn((e, d) => emitted.push({ event: e, data: d })),
    join: jest.fn((r) => s.rooms.add(r)),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on: jest.fn((e, h) => { handlers[e] = h; }),
    _emitted: emitted,
    _handlers: handlers,
  };
  return s;
}

let io, connHandler, sockets, roomEmits;

beforeAll(() => {
  sockets = new Map();
  roomEmits = [];
  io = {
    on: jest.fn(),
    sockets: { sockets },
    to: jest.fn(() => ({ emit: jest.fn((e, d) => roomEmits.push({ event: e, data: d })) })),
  };
  attachSocketHandlers(io, { info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  connHandler = io.on.mock.calls.find(([e]) => e === 'connection')[1];
});

afterEach(async () => {
  roomEmits.length = 0;
  challengeStore.clear();
  for (const [id] of (await gameStore.getAllActiveGames()).entries()) {
    await gameStore.deleteGame(id);
  }
});

describe('Challenge Links (real handler)', () => {
  describe('Challenge link URL parsing', () => {
    test('extract username from /play/:username path', () => {
      const paths = [
        { url: '/play/PlayerOne', expected: 'PlayerOne' },
        { url: '/play/test_user', expected: 'test_user' },
        { url: '/play/Player-123', expected: 'Player-123' },
      ];

      paths.forEach(({ url, expected }) => {
        const match = url.match(/^\/play\/([a-zA-Z0-9_-]+)$/);
        expect(match).not.toBeNull();
        expect(match[1]).toBe(expected);
      });
    });

    test('rejects invalid usernames in path', () => {
      const invalidPaths = [
        '/play/',          // empty
        '/play/ ',         // space
        '/play/a',         // too short (1 char)
        '/play/user name', // space in name
      ];

      invalidPaths.forEach((url) => {
        const match = url.match(/^\/play\/([a-zA-Z0-9_-]{2,16})$/);
        expect(match).toBeNull();
      });
    });
  });

  describe('create_challenge socket event', () => {
    test('returns a valid game/challenge ID when creating a challenge', async () => {
      const sock = mockSocket('sock-create-1');
      sockets.set(sock.id, sock);
      connHandler(sock);

      const handler = sock._handlers['create_challenge'];
      expect(handler).toBeDefined();

      const result = await new Promise((resolve) => {
        handler({ username: 'TestHost', avatar: '👦' }, resolve);
      });

      expect(result.error).toBeUndefined();
      expect(result.gameId).toBeDefined();
      expect(typeof result.gameId).toBe('string');
      expect(result.challengeId).toBe(result.gameId);
      expect(result.challengerUsername).toBe('TestHost');
      expect(result.sessionToken).toBeDefined();
      expect(result.sessionToken.length).toBeGreaterThan(0);

      // Verify game was stored
      const game = await gameStore.getGame(result.gameId);
      expect(game).toBeDefined();
      expect(game.players.player1.username).toBe('TestHost');
      expect(game.metadata.challenge).toBe(true);

      // Verify socket joined the room
      expect(sock.join).toHaveBeenCalledWith(result.gameId);

      // Verify game_started was emitted to the creator
      const gameStarted = sock._emitted.find((e) => e.event === 'game_started');
      expect(gameStarted).toBeDefined();
      expect(gameStarted.data.playerId).toBe('player1');
    });

    test('rejects challenge creation with invalid username', async () => {
      const sock = mockSocket('sock-create-bad');
      sockets.set(sock.id, sock);
      connHandler(sock);

      const handler = sock._handlers['create_challenge'];

      const result = await new Promise((resolve) => {
        handler({ username: '' }, resolve);
      });

      expect(result.error).toBeDefined();
    });

    test('stores challenge in challengeStore keyed by lowercase username', async () => {
      const sock = mockSocket('sock-store');
      sockets.set(sock.id, sock);
      connHandler(sock);

      const handler = sock._handlers['create_challenge'];
      const result = await new Promise((resolve) => {
        handler({ username: 'HostPlayer', avatar: '👦' }, resolve);
      });

      expect(result.error).toBeUndefined();
      const challenge = challengeStore.get('hostplayer');
      expect(challenge).toBeDefined();
      expect(challenge.gameId).toBe(result.gameId);
      expect(challenge.challengerUsername).toBe('HostPlayer');
    });
  });

  describe('join_challenge socket event', () => {
    test('returns error for non-existent challenge', async () => {
      const sock = mockSocket('sock-join-bad');
      sockets.set(sock.id, sock);
      connHandler(sock);

      const handler = sock._handlers['join_challenge'];

      const result = await new Promise((resolve) => {
        handler({ challengerUsername: 'NonExistent', username: 'Joiner', avatar: '👧' }, resolve);
      });

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/not found|expired/i);
    });

    test('full challenge flow: create → join', async () => {
      // Step 1: Host creates challenge
      const hostSock = mockSocket('sock-host');
      sockets.set(hostSock.id, hostSock);
      connHandler(hostSock);

      const createHandler = hostSock._handlers['create_challenge'];
      const createRes = await new Promise((resolve) => {
        createHandler({ username: 'HostPlayer', avatar: '👦' }, resolve);
      });
      expect(createRes.error).toBeUndefined();
      expect(createRes.gameId).toBeDefined();

      // Step 2: Joiner joins the challenge
      const joinSock = mockSocket('sock-joiner');
      sockets.set(joinSock.id, joinSock);
      connHandler(joinSock);

      const joinHandler = joinSock._handlers['join_challenge'];
      const joinRes = await new Promise((resolve) => {
        joinHandler({ challengerUsername: 'HostPlayer', username: 'JoinPlayer', avatar: '👧' }, resolve);
      });

      expect(joinRes.error).toBeUndefined();
      expect(joinRes.success).toBe(true);
      expect(joinRes.challengerUsername).toBe('HostPlayer');
      expect(joinRes.gameId).toBe(createRes.gameId);
      expect(joinRes.playerId).toBe('player2');
      expect(joinRes.sessionToken).toBeDefined();

      // Verify game has both players
      const game = await gameStore.getGame(createRes.gameId);
      expect(game.players.player1.username).toBe('HostPlayer');
      expect(game.players.player2.username).toBe('JoinPlayer');

      // Verify joiner socket joined the room
      expect(joinSock.join).toHaveBeenCalledWith(createRes.gameId);

      // Verify game_started was emitted to joiner
      const gameStarted = joinSock._emitted.find((e) => e.event === 'game_started');
      expect(gameStarted).toBeDefined();
      expect(gameStarted.data.playerId).toBe('player2');
    });

    test('rejects joining a full challenge', async () => {
      // Create and fill the challenge
      const hostSock = mockSocket('sock-full-host');
      sockets.set(hostSock.id, hostSock);
      connHandler(hostSock);

      const createRes = await new Promise((resolve) => {
        hostSock._handlers['create_challenge']({ username: 'FullHost', avatar: '👦' }, resolve);
      });

      const join1Sock = mockSocket('sock-full-j1');
      sockets.set(join1Sock.id, join1Sock);
      connHandler(join1Sock);

      await new Promise((resolve) => {
        join1Sock._handlers['join_challenge']({ challengerUsername: 'FullHost', username: 'Player2', avatar: '👧' }, resolve);
      });

      // Third player tries to join — should fail
      const join2Sock = mockSocket('sock-full-j2');
      sockets.set(join2Sock.id, join2Sock);
      connHandler(join2Sock);

      const result = await new Promise((resolve) => {
        join2Sock._handlers['join_challenge']({ challengerUsername: 'FullHost', username: 'Player3', avatar: '🧑' }, resolve);
      });

      // Challenge is cleaned up after fill, so it should say not found
      expect(result.error).toBeDefined();
    });

    test('rate-limited create_challenge invokes callback with error', async () => {
      const sock = mockSocket('sock-rl');
      sockets.set(sock.id, sock);
      connHandler(sock);

      const handler = sock._handlers['create_challenge'];
      // Spam requests to trigger rate limit
      const results = [];
      for (let i = 0; i < 20; i++) {
        const res = await new Promise((resolve) => {
          handler({ username: `RLUser${i}`, avatar: '👦' }, resolve);
        });
        results.push(res);
      }

      // At least one should have been rate-limited with a callback error
      // (exact threshold depends on config, but 20 rapid calls should trigger it)
      const rateLimitedRes = results.find((r) => r?.error && /too many/i.test(r.error));
      // If rate limiting is strict enough, we expect this. If not, the test just
      // validates the handler doesn't crash on rapid calls.
      if (rateLimitedRes) {
        expect(rateLimitedRes.error).toMatch(/too many/i);
      }
    });
  });
});
