const { validatePayload } = require('../middleware/socketSchemas');

describe('validatePayload', () => {
  test('returns valid:true for unknown event names (no schema)', () => {
    const result = validatePayload('some_custom_event', { foo: 'bar' });
    expect(result.valid).toBe(true);
  });

  test('rejects null/undefined payload', () => {
    const result = validatePayload('create_game', null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expected an object');
  });

  describe('create_game', () => {
    test('accepts valid payload', () => {
      const result = validatePayload('create_game', {
        gridSize: 3,
        username: 'Alice',
        playerCount: 2,
      });
      expect(result.valid).toBe(true);
      expect(result.value.gridSize).toBe(3);
      expect(result.value.username).toBe('Alice');
    });

    test('rejects missing required fields', () => {
      const result = validatePayload('create_game', { username: 'Alice' });
      expect(result.valid).toBe(false);
    });

    test('rejects gridSize out of range', () => {
      const result = validatePayload('create_game', {
        gridSize: 99,
        username: 'Alice',
      });
      expect(result.valid).toBe(false);
      // Client-facing error should be generic (no schema details leaked)
      expect(result.error).not.toContain('gridSize');
      expect(result.error).not.toContain('"gridSize"');
      // Detailed error should be available for server-side logging
      expect(result.detailedError).toBeDefined();
    });

    test('strips unknown fields', () => {
      const result = validatePayload('create_game', {
        gridSize: 3,
        username: 'Alice',
        __proto__: 'hack',
        malicious: true,
      });
      expect(result.valid).toBe(true);
      expect(result.value.malicious).toBeUndefined();
    });

    test('coerces string gridSize to number', () => {
      const result = validatePayload('create_game', {
        gridSize: '4',
        username: 'Bob',
      });
      expect(result.valid).toBe(true);
      expect(result.value.gridSize).toBe(4);
    });
  });

  describe('make_move', () => {
    test('accepts valid move payload', () => {
      const result = validatePayload('make_move', {
        gameId: 'ABCD12',
        playerId: 'player1',
        sessionToken: 'a'.repeat(48),
        type: 'horizontal',
        r: 0,
        c: 0,
      });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid playerId format', () => {
      const result = validatePayload('make_move', {
        gameId: 'ABCD12',
        playerId: 'player5',
        sessionToken: 'a'.repeat(48),
        type: 'horizontal',
        r: 0,
        c: 0,
      });
      expect(result.valid).toBe(false);
    });

    test('rejects invalid move type', () => {
      const result = validatePayload('make_move', {
        gameId: 'ABCD12',
        playerId: 'player1',
        sessionToken: 'a'.repeat(48),
        type: 'diagonal',
        r: 0,
        c: 0,
      });
      expect(result.valid).toBe(false);
    });

    test('rejects negative coordinates', () => {
      const result = validatePayload('make_move', {
        gameId: 'ABCD12',
        playerId: 'player1',
        sessionToken: 'a'.repeat(48),
        type: 'horizontal',
        r: -1,
        c: 0,
      });
      expect(result.valid).toBe(false);
    });

    test('rejects coordinates exceeding max grid size', () => {
      const result = validatePayload('make_move', {
        gameId: 'ABCD12',
        playerId: 'player1',
        sessionToken: 'a'.repeat(48),
        type: 'horizontal',
        r: 7,
        c: 0,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('join_game', () => {
    test('accepts valid join payload', () => {
      const result = validatePayload('join_game', {
        gameId: 'AB1234',
        username: 'TestUser',
      });
      expect(result.valid).toBe(true);
    });

    test('accepts spectator join mode', () => {
      const result = validatePayload('join_game', {
        gameId: 'AB1234',
        username: 'Viewer',
        joinMode: 'spectator',
      });
      expect(result.valid).toBe(true);
      expect(result.value.joinMode).toBe('spectator');
    });

    test('rejects invalid join mode', () => {
      const result = validatePayload('join_game', {
        gameId: 'AB1234',
        username: 'Hacker',
        joinMode: 'admin',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('queue_join', () => {
    test('accepts valid queue join', () => {
      const result = validatePayload('queue_join', {
        username: 'Player1',
        gridSize: 3,
        playerCount: 2,
      });
      expect(result.valid).toBe(true);
    });

    test('rejects playerCount > 4', () => {
      const result = validatePayload('queue_join', {
        username: 'Player1',
        gridSize: 3,
        playerCount: 5,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('create_tournament', () => {
    test('accepts valid tournament creation', () => {
      const result = validatePayload('create_tournament', {
        username: 'Host',
        tournamentSize: 4,
        gridSize: 3,
      });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid tournament size', () => {
      const result = validatePayload('create_tournament', {
        username: 'Host',
        tournamentSize: 6,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('join_tournament', () => {
    test('accepts valid tournament join', () => {
      const result = validatePayload('join_tournament', {
        tournamentId: 'T12345',
        username: 'Player',
      });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid tournament ID format', () => {
      const result = validatePayload('join_tournament', {
        tournamentId: 'bad',
        username: 'Player',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('game_chat', () => {
    test('accepts valid game_chat payload', () => {
      const result = validatePayload('game_chat', {
        gameId: 'ABC123',
        content: 'Hello! 👋',
      });
      expect(result.valid).toBe(true);
      expect(result.value.gameId).toBe('ABC123');
      expect(result.value.content).toBe('Hello! 👋');
    });

    test('rejects missing gameId', () => {
      const result = validatePayload('game_chat', { content: 'Hello! 👋' });
      expect(result.valid).toBe(false);
    });

    test('rejects missing content', () => {
      const result = validatePayload('game_chat', { gameId: 'ABC123' });
      expect(result.valid).toBe(false);
    });

    test('rejects empty content', () => {
      const result = validatePayload('game_chat', { gameId: 'ABC123', content: '' });
      expect(result.valid).toBe(false);
    });

    test('rejects content exceeding max length', () => {
      const result = validatePayload('game_chat', { gameId: 'ABC123', content: 'A'.repeat(51) });
      expect(result.valid).toBe(false);
    });

    test('accepts emoji content', () => {
      const result = validatePayload('game_chat', { gameId: 'ABC123', content: '😂' });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid gameId format', () => {
      const result = validatePayload('game_chat', { gameId: '!@#$%', content: 'Hello! 👋' });
      expect(result.valid).toBe(false);
    });
  });
});
