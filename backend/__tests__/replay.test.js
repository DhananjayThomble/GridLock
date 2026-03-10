// backend/__tests__/replay.test.js
// Unit tests for the replay API endpoint

const express = require('express');
const request = require('supertest');
const replayRouter = require('../routes/replay');

// Mock the Game model
jest.mock('../models/Game', () => {
  const games = new Map();

  // Seed test data
  games.set('TESTGM', {
    gameId: 'TESTGM',
    gridSize: 3,
    playerCount: 2,
    players: {
      player1: { username: 'Alice', avatar: '👩', color: '#e74c3c', token: 'tok1', isCPU: false },
      player2: { username: 'Bob', avatar: '👨', color: '#3498db', token: 'tok2', isCPU: false },
    },
    moveHistory: [
      { player: 'player1', type: 'h', row: 0, col: 0, timestamp: new Date() },
      { player: 'player2', type: 'v', row: 0, col: 1, timestamp: new Date() },
      { player: 'player1', type: 'h', row: 1, col: 0, timestamp: new Date() },
    ],
    gameState: {
      scores: { player1: 2, player2: 1 },
      winner: 'player1',
    },
    status: 'completed',
    createdAt: new Date(),
    finishedAt: new Date(),
  });

  games.set('EMPTYGM', {
    gameId: 'EMPTYGM',
    gridSize: 3,
    playerCount: 2,
    players: {
      player1: { username: 'Carol', avatar: '👩', color: '#e74c3c', token: 'tok3', isCPU: false },
    },
    moveHistory: [],
    gameState: { scores: {}, winner: null },
    status: 'abandoned',
    createdAt: new Date(),
    finishedAt: null,
  });

  return {
    findOne: jest.fn(({ gameId }) => ({
      lean: () => Promise.resolve(games.get(gameId) || null),
    })),
  };
});

function createApp() {
  const app = express();
  app.use('/api/games', replayRouter);
  return app;
}

describe('Replay API', () => {

  test('GET /api/games/:id/replay returns move history for valid game', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/TESTGM/replay');

    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe('TESTGM');
    expect(res.body.gridSize).toBe(3);
    expect(res.body.playerCount).toBe(2);
    expect(res.body.moveHistory).toHaveLength(3);
    expect(res.body.moveHistory[0]).toMatchObject({
      player: 'player1',
      type: 'h',
      row: 0,
      col: 0,
    });
    expect(res.body.players.player1.username).toBe('Alice');
    expect(res.body.players.player2.username).toBe('Bob');
    expect(res.body.scores).toEqual({ player1: 2, player2: 1 });
    expect(res.body.winner).toBe('player1');
    expect(res.body.status).toBe('completed');
  });

  test('GET /api/games/:id/replay returns 404 for invalid game ID', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/NONEXIST/replay');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Game not found');
  });

  test('GET /api/games/:id/replay returns empty array for game without moves', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/EMPTYGM/replay');

    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe('EMPTYGM');
    expect(res.body.moveHistory).toEqual([]);
    expect(res.body.status).toBe('abandoned');
  });

  test('GET /api/games/:id/replay rejects overly long game IDs', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/THISIDISTOOLONG123/replay');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid game ID');
  });

  test('replay response contains player metadata without tokens', async () => {
    const app = createApp();
    const res = await request(app).get('/api/games/TESTGM/replay');

    expect(res.status).toBe(200);
    // Should NOT expose auth tokens
    expect(res.body.players.player1.token).toBeUndefined();
    expect(res.body.players.player1).toHaveProperty('username');
    expect(res.body.players.player1).toHaveProperty('avatar');
    expect(res.body.players.player1).toHaveProperty('isCPU');
  });

  test('game ID is normalized to uppercase', async () => {
    const app = createApp();
    // Send lowercase — should be normalized
    const res = await request(app).get('/api/games/testgm/replay');

    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe('TESTGM');
  });

  test('replay handles Mongoose Map for players field', async () => {
    // The real Mongoose model stores players as a Map, not a plain object.
    // Seed a game with Map-based players to exercise that branch in replay.js.
    const Game = require('../models/Game');
    const mapPlayers = new Map([
      ['player1', { username: 'MapAlice', avatar: '👩', color: '#e74c3c', token: 'tok-m1', isCPU: false }],
      ['player2', { username: 'MapBob', avatar: '👨', color: '#3498db', token: 'tok-m2', isCPU: false }],
    ]);

    Game.findOne.mockImplementationOnce(() => ({
      lean: () => Promise.resolve({
        gameId: 'MAPGM',
        gridSize: 3,
        playerCount: 2,
        players: mapPlayers,
        moveHistory: [
          { player: 'player1', type: 'h', row: 0, col: 0, timestamp: new Date() },
        ],
        gameState: { scores: { player1: 1, player2: 0 }, winner: 'player1' },
        status: 'completed',
        createdAt: new Date(),
        finishedAt: new Date(),
      }),
    }));

    const app = createApp();
    const res = await request(app).get('/api/games/MAPGM/replay');

    expect(res.status).toBe(200);
    expect(res.body.gameId).toBe('MAPGM');
    expect(res.body.players.player1.username).toBe('MapAlice');
    expect(res.body.players.player2.username).toBe('MapBob');
    // Tokens should be stripped
    expect(res.body.players.player1.token).toBeUndefined();
  });

});
