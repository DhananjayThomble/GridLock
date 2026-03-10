// backend/__tests__/rematch.test.js
// Unit tests for rematch store (vote tracking)

const rematchStore = require('../stores/rematchStore');

// Mock redis to use in-memory fallback
jest.mock('../stores/redisClient', () => ({
  getRedisClient: jest.fn().mockResolvedValue(null),
}));

describe('Rematch Store', () => {

  beforeEach(async () => {
    // Clear any existing votes
    await rematchStore.clearVotes('test-game-1');
    await rematchStore.clearVotes('test-game-2');
  });

  test('addVote adds a vote and returns count', async () => {
    const result = await rematchStore.addVote('test-game-1', 'player1');
    expect(result.count).toBe(1);
    expect(result.isNew).toBe(true);
  });

  test('addVote returns isNew=false for duplicate vote', async () => {
    await rematchStore.addVote('test-game-1', 'player1');
    const result = await rematchStore.addVote('test-game-1', 'player1');
    expect(result.count).toBe(1);
    expect(result.isNew).toBe(false);
  });

  test('multiple players can vote independently', async () => {
    const r1 = await rematchStore.addVote('test-game-1', 'player1');
    expect(r1.count).toBe(1);

    const r2 = await rematchStore.addVote('test-game-1', 'player2');
    expect(r2.count).toBe(2);
    expect(r2.isNew).toBe(true);
  });

  test('all players vote → count equals player count (triggers restart)', async () => {
    const playerCount = 2;
    await rematchStore.addVote('test-game-1', 'player1');
    const result = await rematchStore.addVote('test-game-1', 'player2');

    expect(result.count).toBe(playerCount);
    // When count === playerCount, the socket handler triggers game restart
  });

  test('partial votes → waiting state (count < total)', async () => {
    const playerCount = 3;
    await rematchStore.addVote('test-game-1', 'player1');
    const result = await rematchStore.addVote('test-game-1', 'player2');

    expect(result.count).toBe(2);
    expect(result.count).toBeLessThan(playerCount);
    // Only 2 of 3 players have voted — still waiting
  });

  test('removeVote decrements count (player disconnect → auto-decline)', async () => {
    await rematchStore.addVote('test-game-1', 'player1');
    await rematchStore.addVote('test-game-1', 'player2');

    // Player1 disconnects → remove their vote
    const result = await rematchStore.removeVote('test-game-1', 'player1');
    expect(result.count).toBe(1);
    expect(result.wasRemoved).toBe(true);
  });

  test('removeVote on non-existent vote returns wasRemoved=false', async () => {
    const result = await rematchStore.removeVote('test-game-1', 'nonexistent');
    expect(result.wasRemoved).toBe(false);
    expect(result.count).toBe(0);
  });

  test('clearVotes resets all votes for a game', async () => {
    await rematchStore.addVote('test-game-1', 'player1');
    await rematchStore.addVote('test-game-1', 'player2');

    await rematchStore.clearVotes('test-game-1');

    const count = await rematchStore.getVoteCount('test-game-1');
    expect(count).toBe(0);
  });

  test('getVoteCount returns correct count', async () => {
    expect(await rematchStore.getVoteCount('test-game-1')).toBe(0);

    await rematchStore.addVote('test-game-1', 'player1');
    expect(await rematchStore.getVoteCount('test-game-1')).toBe(1);

    await rematchStore.addVote('test-game-1', 'player2');
    expect(await rematchStore.getVoteCount('test-game-1')).toBe(2);
  });

  test('hasVoted returns correct boolean', async () => {
    expect(await rematchStore.hasVoted('test-game-1', 'player1')).toBe(false);

    await rematchStore.addVote('test-game-1', 'player1');
    expect(await rematchStore.hasVoted('test-game-1', 'player1')).toBe(true);
    expect(await rematchStore.hasVoted('test-game-1', 'player2')).toBe(false);
  });

  test('votes are isolated between games', async () => {
    await rematchStore.addVote('test-game-1', 'player1');
    await rematchStore.addVote('test-game-2', 'player1');
    await rematchStore.addVote('test-game-2', 'player2');

    expect(await rematchStore.getVoteCount('test-game-1')).toBe(1);
    expect(await rematchStore.getVoteCount('test-game-2')).toBe(2);
  });

  test('storeCount returns number of active rematch sessions', async () => {
    await rematchStore.addVote('test-game-1', 'player1');
    await rematchStore.addVote('test-game-2', 'player1');

    const count = await rematchStore.storeCount();
    expect(count).toBeGreaterThanOrEqual(2);
  });

});
