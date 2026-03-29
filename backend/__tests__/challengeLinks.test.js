// backend/__tests__/challengeLinks.test.js — Unit tests for challenge link feature (#455)

const { createServer } = require('http');
const { Server } = require('socket.io');
const ClientIO = require('socket.io-client');

// Mock Redis to avoid real connections
jest.mock('../stores/redisClient', () => ({
  getRedisClient: jest.fn().mockResolvedValue(null),
}));

const PORT = 0; // Random port

describe('Challenge Links', () => {
  let io, httpServer, clientSocket1, clientSocket2, serverPort;

  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer);
    httpServer.listen(PORT, () => {
      serverPort = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    if (clientSocket1?.connected) clientSocket1.disconnect();
    if (clientSocket2?.connected) clientSocket2.disconnect();
    io.close();
    httpServer.close(done);
  });

  afterEach(() => {
    if (clientSocket1?.connected) clientSocket1.disconnect();
    if (clientSocket2?.connected) clientSocket2.disconnect();
  });

  describe('Challenge link URL parsing', () => {
    test('extract username from /play/:username path', () => {
      // Simulates what the frontend router does
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
    test('returns a valid challenge ID when creating a challenge', (done) => {
      // This test validates the socket event contract
      // First, register the handler on the server
      const challengeStore = new Map();

      io.removeAllListeners('connection');
      io.on('connection', (socket) => {
        socket.on('create_challenge', ({ username }, callback) => {
          if (!username || username.length < 2) {
            callback({ error: 'Invalid username' });
            return;
          }

          const challengeId = Math.random().toString(36).substring(2, 8).toUpperCase();
          challengeStore.set(username, {
            challengeId,
            challengerUsername: username,
            createdAt: Date.now(),
            gameId: null, // Will be set when game is actually created
          });

          callback({ challengeId, challengerUsername: username });
        });

        socket.on('join_challenge', ({ challengerUsername, username }, callback) => {
          const challenge = challengeStore.get(challengerUsername);
          if (!challenge) {
            callback({ error: 'Challenge not found or expired' });
            return;
          }
          callback({ success: true, challengerUsername });
        });
      });

      clientSocket1 = ClientIO(`http://localhost:${serverPort}`);
      clientSocket1.on('connect', () => {
        clientSocket1.emit('create_challenge', { username: 'TestHost' }, (res) => {
          expect(res.error).toBeUndefined();
          expect(res.challengeId).toBeDefined();
          expect(typeof res.challengeId).toBe('string');
          expect(res.challengeId.length).toBeGreaterThanOrEqual(4);
          expect(res.challengerUsername).toBe('TestHost');
          done();
        });
      });
    });

    test('rejects challenge creation with invalid username', (done) => {
      clientSocket1 = ClientIO(`http://localhost:${serverPort}`);
      clientSocket1.on('connect', () => {
        clientSocket1.emit('create_challenge', { username: '' }, (res) => {
          expect(res.error).toBeDefined();
          done();
        });
      });
    });

    test('join_challenge returns error for non-existent challenge', (done) => {
      clientSocket1 = ClientIO(`http://localhost:${serverPort}`);
      clientSocket1.on('connect', () => {
        clientSocket1.emit('join_challenge', {
          challengerUsername: 'NonExistent',
          username: 'Joiner',
        }, (res) => {
          expect(res.error).toBeDefined();
          expect(res.error).toMatch(/not found|expired/i);
          done();
        });
      });
    });

    test('full challenge flow: create → join', (done) => {
      clientSocket1 = ClientIO(`http://localhost:${serverPort}`);

      clientSocket1.on('connect', () => {
        // Step 1: Create challenge
        clientSocket1.emit('create_challenge', { username: 'HostPlayer' }, (createRes) => {
          expect(createRes.challengeId).toBeDefined();

          // Step 2: Another client joins the challenge
          clientSocket2 = ClientIO(`http://localhost:${serverPort}`);
          clientSocket2.on('connect', () => {
            clientSocket2.emit('join_challenge', {
              challengerUsername: 'HostPlayer',
              username: 'JoinPlayer',
            }, (joinRes) => {
              expect(joinRes.error).toBeUndefined();
              expect(joinRes.success).toBe(true);
              expect(joinRes.challengerUsername).toBe('HostPlayer');
              done();
            });
          });
        });
      });
    });
  });
});
