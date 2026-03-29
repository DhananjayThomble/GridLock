// backend/__tests__/recordGameHistory.test.js
// Unit tests for recordGameHistory() in socketHandlers (#362)

const attachSocketHandlers = require('../controllers/socketHandlers');

// Mock GameHistory model
jest.mock('../models/GameHistory', () => ({
  insertMany: jest.fn(),
}));

const GameHistory = require('../models/GameHistory');

const { recordGameHistory } = attachSocketHandlers._internal;

// Minimal logger stub
const createLog = () => ({
  info: jest.fn(),
  error: jest.fn(),
});

function makeGame(overrides = {}) {
  return {
    id: 'ABC123',
    playerCount: 2,
    gridSize: 3,
    players: {
      player1: { username: 'alice', isCPU: false },
      player2: { username: 'bob', isCPU: false },
    },
    gameState: { scores: { player1: 5, player2: 3 } },
    createdAt: Date.now() - 60_000, // 60 seconds ago
    ...overrides,
  };
}

describe('recordGameHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('records history for a normal win', async () => {
    const log = createLog();
    const game = makeGame();

    await recordGameHistory(game, 'player1', log);

    expect(GameHistory.insertMany).toHaveBeenCalledTimes(1);
    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(2);

    const aliceDoc = docs.find((d) => d.username === 'alice');
    const bobDoc = docs.find((d) => d.username === 'bob');

    expect(aliceDoc.result).toBe('win');
    expect(aliceDoc.opponents).toEqual(['bob']);
    expect(aliceDoc.gameId).toBe('ABC123');
    expect(aliceDoc.gridSize).toBe(3);
    expect(aliceDoc.playerCount).toBe(2);
    expect(aliceDoc.scores.player).toBe(5);
    expect(aliceDoc.scores.opponent).toBe(3);
    expect(typeof aliceDoc.duration).toBe('number');
    expect(aliceDoc.playedAt).toBeInstanceOf(Date);

    expect(bobDoc.result).toBe('loss');
    expect(bobDoc.opponents).toEqual(['alice']);
    expect(bobDoc.scores.player).toBe(3);
    expect(bobDoc.scores.opponent).toBe(5);

    expect(log.info).toHaveBeenCalledWith('GameHistory recorded', expect.any(Object));
    expect(log.error).not.toHaveBeenCalled();
  });

  test('records history for a draw', async () => {
    const log = createLog();
    const game = makeGame({
      gameState: { scores: { player1: 4, player2: 4 } },
    });

    await recordGameHistory(game, 'draw', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs.every((d) => d.result === 'draw')).toBe(true);
  });

  test('includes CPU opponents in names and scores', async () => {
    const log = createLog();
    const game = makeGame({
      players: {
        player1: { username: 'alice', isCPU: false },
        player2: { username: 'Bot-1', isCPU: true },
      },
      gameState: { scores: { player1: 6, player2: 3 } },
    });

    await recordGameHistory(game, 'player1', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0].username).toBe('alice');
    // CPU opponents appear in opponents list
    expect(docs[0].opponents).toEqual(['Bot-1']);
    expect(docs[0].scores.player).toBe(6);
    expect(docs[0].scores.opponent).toBe(3);
    expect(docs[0].result).toBe('win');
  });

  test('does nothing when all players are CPU', async () => {
    const log = createLog();
    const game = makeGame({
      players: {
        player1: { username: 'Bot-1', isCPU: true },
        player2: { username: 'Bot-2', isCPU: true },
      },
    });

    await recordGameHistory(game, 'player1', log);

    expect(GameHistory.insertMany).not.toHaveBeenCalled();
  });

  test('does nothing when player has no username', async () => {
    const log = createLog();
    const game = makeGame({
      players: {
        player1: { isCPU: false },
        player2: { username: 'bob', isCPU: false },
      },
    });

    await recordGameHistory(game, 'player1', log);

    // player1 has no username, only bob gets recorded
    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0].username).toBe('bob');
  });

  test('handles missing gameState.scores gracefully', async () => {
    const log = createLog();
    const game = makeGame({ gameState: {} });

    await recordGameHistory(game, 'player1', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(2);
    // Scores should default to 0
    expect(docs[0].scores.player).toBe(0);
    expect(docs[0].scores.opponent).toBe(0);
  });

  test('handles missing createdAt (null duration)', async () => {
    const log = createLog();
    const game = makeGame({ createdAt: null });

    await recordGameHistory(game, 'player1', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs[0].duration).toBeNull();
  });

  test('logs error on DB failure without throwing', async () => {
    const log = createLog();
    const game = makeGame();
    GameHistory.insertMany.mockRejectedValueOnce(new Error('DB connection lost'));

    await recordGameHistory(game, 'player1', log);

    expect(log.error).toHaveBeenCalledWith(
      'Failed to record GameHistory',
      expect.objectContaining({ gameId: 'ABC123', error: 'DB connection lost' }),
    );
  });

  test('handles 3-player game correctly', async () => {
    const log = createLog();
    const game = makeGame({
      playerCount: 3,
      players: {
        player1: { username: 'alice', isCPU: false },
        player2: { username: 'bob', isCPU: false },
        player3: { username: 'charlie', isCPU: false },
      },
      gameState: { scores: { player1: 5, player2: 3, player3: 2 } },
    });

    await recordGameHistory(game, 'player1', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(3);

    const aliceDoc = docs.find((d) => d.username === 'alice');
    expect(aliceDoc.result).toBe('win');
    expect(aliceDoc.opponents).toEqual(expect.arrayContaining(['bob', 'charlie']));
    expect(aliceDoc.scores.player).toBe(5);
    expect(aliceDoc.scores.opponent).toBe(5); // 3 + 2
  });

  test('records correct loss result vs CPU', async () => {
    const log = createLog();
    const game = makeGame({
      players: {
        player1: { username: 'alice', isCPU: false },
        player2: { username: 'Bot-Alpha', isCPU: true },
      },
      gameState: { scores: { player1: 3, player2: 6 } },
    });

    await recordGameHistory(game, 'player2', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0].username).toBe('alice');
    expect(docs[0].result).toBe('loss');
    expect(docs[0].opponents).toEqual(['Bot-Alpha']);
    expect(docs[0].scores.player).toBe(3);
    expect(docs[0].scores.opponent).toBe(6);
  });

  test('includes multiple CPU opponents with correct scores', async () => {
    const log = createLog();
    const game = makeGame({
      playerCount: 3,
      players: {
        player1: { username: 'alice', isCPU: false },
        player2: { username: 'Bot-Alpha', isCPU: true },
        player3: { username: 'Bot-Beta', isCPU: true },
      },
      gameState: { scores: { player1: 5, player2: 3, player3: 4 } },
    });

    await recordGameHistory(game, 'player1', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0].username).toBe('alice');
    expect(docs[0].result).toBe('win');
    expect(docs[0].opponents).toEqual(expect.arrayContaining(['Bot-Alpha', 'Bot-Beta']));
    expect(docs[0].opponents).toHaveLength(2);
    expect(docs[0].scores.player).toBe(5);
    expect(docs[0].scores.opponent).toBe(7); // 3 + 4
  });

  test('mixed human and CPU players', async () => {
    const log = createLog();
    const game = makeGame({
      playerCount: 3,
      players: {
        player1: { username: 'alice', isCPU: false },
        player2: { username: 'bob', isCPU: false },
        player3: { username: 'Bot-Alpha', isCPU: true },
      },
      gameState: { scores: { player1: 5, player2: 3, player3: 4 } },
    });

    await recordGameHistory(game, 'player1', log);

    const docs = GameHistory.insertMany.mock.calls[0][0];
    // Only human players get history docs
    expect(docs).toHaveLength(2);

    const aliceDoc = docs.find((d) => d.username === 'alice');
    expect(aliceDoc.result).toBe('win');
    // Both human and CPU opponents listed
    expect(aliceDoc.opponents).toEqual(expect.arrayContaining(['bob', 'Bot-Alpha']));
    expect(aliceDoc.scores.player).toBe(5);
    expect(aliceDoc.scores.opponent).toBe(7); // 3 + 4

    const bobDoc = docs.find((d) => d.username === 'bob');
    expect(bobDoc.result).toBe('loss');
    expect(bobDoc.opponents).toEqual(expect.arrayContaining(['alice', 'Bot-Alpha']));
    expect(bobDoc.scores.player).toBe(3);
    expect(bobDoc.scores.opponent).toBe(9); // 5 + 4
  });
});
