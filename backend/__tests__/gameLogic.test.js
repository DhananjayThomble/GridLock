const {
  calculateNewState,
  initializeGameState,
  getNextPlayer,
  getNextActivePlayer,
  calculateWinner,
} = require('../utils/gameLogic');

describe('initializeGameState', () => {
  test('creates correct default 2-player state', () => {
    const state = initializeGameState(3);

    expect(state.horizontalLines).toHaveLength(4);
    expect(state.horizontalLines[0]).toHaveLength(3);
    expect(state.verticalLines).toHaveLength(3);
    expect(state.verticalLines[0]).toHaveLength(4);
    expect(state.boxes).toHaveLength(3);
    expect(state.boxes[0]).toHaveLength(3);

    expect(state.currentPlayer).toBe('player1');
    expect(state.players).toEqual(['player1', 'player2']);
    expect(state.scores).toEqual({ player1: 0, player2: 0 });
    expect(state.winner).toBeNull();
    expect(state.playerCount).toBe(2);
  });

  test.each([2, 3, 4])('supports %i player mode', (count) => {
    const state = initializeGameState(2, count);
    expect(state.playerCount).toBe(count);
    expect(state.players).toHaveLength(count);
    for (let i = 1; i <= count; i++) {
      expect(state.players).toContain(`player${i}`);
      expect(state.scores[`player${i}`]).toBe(0);
    }
  });

  test('throws on invalid grid size', () => {
    expect(() => initializeGameState(1, 2)).toThrow('Grid size must be between 2 and 10');
    expect(() => initializeGameState(11, 2)).toThrow('Grid size must be between 2 and 10');
  });

  test('throws on invalid player count', () => {
    expect(() => initializeGameState(3, 1)).toThrow('Player count must be between 2 and 4');
    expect(() => initializeGameState(3, 5)).toThrow('Player count must be between 2 and 4');
  });
});

describe('getNextPlayer', () => {
  test('cycles through 2 players', () => {
    const players = ['player1', 'player2'];
    expect(getNextPlayer('player1', players)).toBe('player2');
    expect(getNextPlayer('player2', players)).toBe('player1');
  });

  test('cycles through 4 players', () => {
    const players = ['player1', 'player2', 'player3', 'player4'];
    expect(getNextPlayer('player1', players)).toBe('player2');
    expect(getNextPlayer('player2', players)).toBe('player3');
    expect(getNextPlayer('player3', players)).toBe('player4');
    expect(getNextPlayer('player4', players)).toBe('player1');
  });

  test('falls back to first player when current not found', () => {
    const players = ['player1', 'player2', 'player3'];
    expect(getNextPlayer('unknown', players)).toBe('player1');
  });
});

describe('calculateWinner', () => {
  test('returns null while game is not complete', () => {
    const scores = { player1: 2, player2: 1 };
    expect(calculateWinner(scores, 2, 2, ['player1', 'player2'])).toBeNull();
  });

  test('returns winner when all boxes complete and one player leads', () => {
    const scores = { player1: 3, player2: 1 };
    expect(calculateWinner(scores, 2, 2, ['player1', 'player2'])).toBe('player1');
  });

  test('returns draw when all boxes complete and tied (2 players)', () => {
    const scores = { player1: 2, player2: 2 };
    expect(calculateWinner(scores, 2, 2, ['player1', 'player2'])).toBe('draw');
  });

  test('returns draw when top score tied among multiple players', () => {
    const scores = { player1: 2, player2: 2, player3: 0 };
    expect(calculateWinner(scores, 2, 2, ['player1', 'player2', 'player3'])).toBe('draw');
  });
});

describe('calculateNewState', () => {
  test('applies valid move without box completion and switches player', () => {
    const state = initializeGameState(2, 2);
    const next = calculateNewState(state, 2, 0, 0, 'horizontal');

    expect(next.error).toBeUndefined();
    expect(next.horizontalLines[0][0]).toBe('player1');
    expect(next.currentPlayer).toBe('player2');
    expect(next.scores).toEqual({ player1: 0, player2: 0 });
  });

  test('returns error for invalid line type', () => {
    const state = initializeGameState(2, 2);
    const result = calculateNewState(state, 2, 0, 0, 'diagonal');
    expect(result).toEqual({ error: 'Invalid line type' });
  });

  test('returns error for invalid coordinates', () => {
    const state = initializeGameState(2, 2);
    expect(calculateNewState(state, 2, -1, 0, 'horizontal')).toEqual({ error: 'Invalid coordinates' });
    expect(calculateNewState(state, 2, 0, 3, 'horizontal')).toEqual({ error: 'Invalid coordinates' });
    expect(calculateNewState(state, 2, 2, 0, 'vertical')).toEqual({ error: 'Invalid coordinates' });
    expect(calculateNewState(state, 2, 0, -1, 'vertical')).toEqual({ error: 'Invalid coordinates' });
  });

  test('returns error when taking an already used line', () => {
    const state = initializeGameState(2, 2);
    const first = calculateNewState(state, 2, 0, 0, 'horizontal');
    const second = calculateNewState(first, 2, 0, 0, 'horizontal');
    expect(second).toEqual({ error: 'Line already taken' });
  });

  test('keeps same player and awards point when box is completed', () => {
    let state = initializeGameState(2, 2);

    state = calculateNewState(state, 2, 0, 0, 'horizontal'); // p1
    state = calculateNewState(state, 2, 0, 0, 'vertical');   // p2
    state = calculateNewState(state, 2, 1, 0, 'horizontal'); // p1

    const finishingMove = calculateNewState(state, 2, 0, 1, 'vertical'); // p2 completes box

    expect(finishingMove.boxes[0][0]).toBe('player2');
    expect(finishingMove.scores.player2).toBe(1);
    expect(finishingMove.currentPlayer).toBe('player2');
  });

  test('supports completing two boxes in one move', () => {
    let state = initializeGameState(2, 2);

    // Prepare top-left and top-right boxes so center vertical line completes both
    state.horizontalLines[0][0] = 'player1';
    state.horizontalLines[0][1] = 'player2';
    state.horizontalLines[1][0] = 'player1';
    state.horizontalLines[1][1] = 'player2';
    state.verticalLines[0][0] = 'player1';
    state.verticalLines[0][2] = 'player2';
    state.currentPlayer = 'player1';

    const next = calculateNewState(state, 2, 0, 1, 'vertical');

    expect(next.boxes[0][0]).toBe('player1');
    expect(next.boxes[0][1]).toBe('player1');
    expect(next.scores.player1).toBe(2);
    expect(next.currentPlayer).toBe('player1');
  });

  test('detects winner when game is completed', () => {
    let state = initializeGameState(2, 2);

    state.horizontalLines[0][0] = 'player1';
    state.horizontalLines[0][1] = 'player1';
    state.horizontalLines[1][0] = 'player1';
    state.horizontalLines[1][1] = 'player1';
    state.horizontalLines[2][0] = 'player1';
    state.horizontalLines[2][1] = 'player1';

    state.verticalLines[0][0] = 'player1';
    state.verticalLines[1][0] = 'player1';
    state.verticalLines[0][1] = 'player1';
    state.verticalLines[1][1] = 'player1';
    state.verticalLines[0][2] = 'player1';

    state.boxes[0][0] = 'player1';
    state.boxes[0][1] = 'player1';
    state.boxes[1][0] = 'player1';
    state.scores.player1 = 3;
    state.currentPlayer = 'player1';

    const final = calculateNewState(state, 2, 1, 2, 'vertical');

    expect(final.boxes[1][1]).toBe('player1');
    expect(final.scores.player1).toBe(4);
    expect(final.winner).toBe('player1');
  });

  test('detects draw on completion for multi-player setup', () => {
    const state = {
      horizontalLines: [
        ['player1', 'player2'],
        ['player3', 'player4'],
        ['player1', 'player2'],
      ],
      verticalLines: [
        ['player1', 'player2', 'player3'],
        ['player1', 'player4', null],
      ],
      boxes: [
        ['player1', 'player2'],
        ['player3', null],
      ],
      currentPlayer: 'player4',
      scores: { player1: 1, player2: 1, player3: 1, player4: 0 },
      winner: null,
      playerCount: 4,
      players: ['player1', 'player2', 'player3', 'player4'],
    };

    const final = calculateNewState(state, 2, 1, 2, 'vertical');

    expect(final.scores).toEqual({ player1: 1, player2: 1, player3: 1, player4: 1 });
    expect(final.winner).toBe('draw');
  });

  test('does not mutate original state object', () => {
    const state = initializeGameState(2, 2);
    const original = JSON.parse(JSON.stringify(state));

    calculateNewState(state, 2, 0, 0, 'horizontal');

    expect(state).toEqual(original);
  });
});

// Fix #7: Unit tests for getNextActivePlayer
describe('getNextActivePlayer', () => {
  const players = ['player1', 'player2', 'player3', 'player4'];

  test('normal case — returns next active player in order', () => {
    const active = new Set(['player1', 'player2', 'player3', 'player4']);
    expect(getNextActivePlayer('player1', players, active)).toBe('player2');
    expect(getNextActivePlayer('player2', players, active)).toBe('player3');
    expect(getNextActivePlayer('player4', players, active)).toBe('player1');
  });

  test('skips inactive players', () => {
    const active = new Set(['player1', 'player3']);
    expect(getNextActivePlayer('player1', players, active)).toBe('player3');
    expect(getNextActivePlayer('player3', players, active)).toBe('player1');
  });

  test('currentPlayer not in players list — falls back to first active', () => {
    const active = new Set(['player2', 'player4']);
    expect(getNextActivePlayer('playerX', players, active)).toBe('player2');
  });

  test('empty active set — returns null', () => {
    const active = new Set();
    expect(getNextActivePlayer('player1', players, active)).toBeNull();
  });

  test('all players disconnected (empty active array) — returns null', () => {
    expect(getNextActivePlayer('player1', players, [])).toBeNull();
  });

  test('only one active player — always returns that player', () => {
    const active = new Set(['player3']);
    expect(getNextActivePlayer('player1', players, active)).toBe('player3');
    expect(getNextActivePlayer('player3', players, active)).toBe('player3');
  });

  test('accepts Array instead of Set for activePlayers', () => {
    const active = ['player1', 'player4'];
    expect(getNextActivePlayer('player1', players, active)).toBe('player4');
    expect(getNextActivePlayer('player4', players, active)).toBe('player1');
  });

  test('falls back to getNextPlayer when activePlayers is undefined', () => {
    expect(getNextActivePlayer('player1', players)).toBe('player2');
    expect(getNextActivePlayer('player4', players)).toBe('player1');
  });
});
