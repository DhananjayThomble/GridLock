const { validatePayload, schemas } = require('../middleware/payloadValidator');

describe('payloadValidator', () => {
  describe('validatePayload - general', () => {
    test('returns valid for unknown event names (no schema)', () => {
      const result = validatePayload('unknown_event', { foo: 'bar' });
      expect(result.valid).toBe(true);
    });

    test('rejects non-object payloads', () => {
      expect(validatePayload('create_game', null).valid).toBe(false);
      expect(validatePayload('create_game', 'string').valid).toBe(false);
      expect(validatePayload('create_game', 42).valid).toBe(false);
    });

    test('strips unknown fields', () => {
      const result = validatePayload('request_rematch', {
        gameId: 'ABCD1234',
        sessionToken: 'abc123',
        malicious: 'payload',
      });
      expect(result.valid).toBe(true);
      expect(result.value.malicious).toBeUndefined();
    });
  });

  describe('create_game schema', () => {
    test('validates valid payload', () => {
      const result = validatePayload('create_game', {
        gridSize: 3,
        username: 'Alice',
        avatar: '👦',
        playerCount: 2,
      });
      expect(result.valid).toBe(true);
      expect(result.value.gridSize).toBe(3);
      expect(result.value.username).toBe('Alice');
    });

    test('rejects missing username', () => {
      const result = validatePayload('create_game', {
        gridSize: 3,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/[Uu]sername/);
    });

    test('rejects invalid grid size', () => {
      const result = validatePayload('create_game', {
        gridSize: 99,
        username: 'Alice',
      });
      expect(result.valid).toBe(false);
    });

    test('rejects invalid cpu difficulty', () => {
      const result = validatePayload('create_game', {
        gridSize: 3,
        username: 'Alice',
        cpuDifficulty: 'impossible',
      });
      expect(result.valid).toBe(false);
    });

    test('applies defaults for optional fields', () => {
      const result = validatePayload('create_game', {
        gridSize: 3,
        username: 'Alice',
      });
      expect(result.valid).toBe(true);
      expect(result.value.playerCount).toBe(2);
      expect(result.value.cpuPlayers).toBe(0);
      expect(result.value.cpuDifficulty).toBe('medium');
    });
  });

  describe('join_game schema', () => {
    test('validates valid payload', () => {
      const result = validatePayload('join_game', {
        gameId: 'ABCD12',
        username: 'Bob',
      });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid game ID format', () => {
      const result = validatePayload('join_game', {
        gameId: 'AB',
        username: 'Bob',
      });
      expect(result.valid).toBe(false);
    });

    test('allows optional sessionToken and joinMode', () => {
      const result = validatePayload('join_game', {
        gameId: 'ABCD12',
        username: 'Bob',
        sessionToken: 'tok123',
        joinMode: 'spectator',
      });
      expect(result.valid).toBe(true);
      expect(result.value.joinMode).toBe('spectator');
    });

    test('rejects invalid joinMode', () => {
      const result = validatePayload('join_game', {
        gameId: 'ABCD12',
        username: 'Bob',
        joinMode: 'hacker',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('make_move schema', () => {
    test('validates valid payload', () => {
      const result = validatePayload('make_move', {
        gameId: 'ABCD12',
        playerId: 'player1',
        sessionToken: 'abc123',
        type: 'horizontal',
        r: 0,
        c: 1,
      });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid playerId', () => {
      const result = validatePayload('make_move', {
        gameId: 'ABCD12',
        playerId: 'player9',
        sessionToken: 'abc',
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
        sessionToken: 'abc',
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
        sessionToken: 'abc',
        type: 'horizontal',
        r: -1,
        c: 0,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('queue_join schema', () => {
    test('validates valid payload', () => {
      const result = validatePayload('queue_join', {
        username: 'Alice',
        avatar: '👦',
        gridSize: 3,
        playerCount: 2,
      });
      expect(result.valid).toBe(true);
    });

    test('rejects player count > 4', () => {
      const result = validatePayload('queue_join', {
        username: 'Alice',
        gridSize: 3,
        playerCount: 5,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('create_tournament schema', () => {
    test('validates valid payload', () => {
      const result = validatePayload('create_tournament', {
        username: 'Alice',
        tournamentSize: 4,
        gridSize: 3,
      });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid tournament size', () => {
      const result = validatePayload('create_tournament', {
        username: 'Alice',
        tournamentSize: 6,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('join_tournament schema', () => {
    test('validates valid payload', () => {
      const result = validatePayload('join_tournament', {
        tournamentId: 'TABCDE',
        username: 'Alice',
      });
      expect(result.valid).toBe(true);
    });

    test('rejects invalid tournament ID format', () => {
      const result = validatePayload('join_tournament', {
        tournamentId: 'INVALID',
        username: 'Alice',
      });
      expect(result.valid).toBe(false);
    });

    test('rejects short tournament ID', () => {
      const result = validatePayload('join_tournament', {
        tournamentId: 'TABC',
        username: 'Alice',
      });
      expect(result.valid).toBe(false);
    });
  });
});
