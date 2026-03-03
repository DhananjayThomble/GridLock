const attachSocketHandlers = require('../controllers/socketHandlers');

describe('tournament helpers', () => {
  const {
    initializeBracket,
    buildTournamentSnapshot,
    sanitizeTournamentId,
    generateTournamentId,
    getTournamentJoinError,
    applyTournamentMatchResult,
  } = attachSocketHandlers._internal;

  test('initializeBracket builds expected rounds for 4 players', () => {
    const participants = [
      { username: 'A' },
      { username: 'B' },
      { username: 'C' },
      { username: 'D' },
    ];

    const rounds = initializeBracket(participants);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].matches).toHaveLength(2);
    expect(rounds[1].matches).toHaveLength(1);
    expect(rounds[0].matches[0].player1).toBe('A');
    expect(rounds[0].matches[0].player2).toBe('B');
  });

  test('initializeBracket builds expected rounds for 8 players', () => {
    const participants = Array.from({ length: 8 }, (_, i) => ({ username: `P${i + 1}` }));
    const rounds = initializeBracket(participants);

    expect(rounds).toHaveLength(3);
    expect(rounds[0].matches).toHaveLength(4);
    expect(rounds[1].matches).toHaveLength(2);
    expect(rounds[2].matches).toHaveLength(1);
    expect(rounds[0].matches[3]).toMatchObject({ player1: 'P7', player2: 'P8', winner: null, gameId: null });
  });

  test('snapshot hides socket-specific fields', () => {
    const snapshot = buildTournamentSnapshot({
      tournamentId: 'T1234',
      status: 'waiting',
      tournamentSize: 4,
      gridSize: 3,
      champion: null,
      participants: [{ username: 'A', avatar: '😀', socketId: 'socket-1' }],
      rounds: [{ matches: [] }],
    });

    expect(snapshot.participants[0]).toEqual({ username: 'A', avatar: '😀' });
    expect(snapshot.participants[0].socketId).toBeUndefined();
  });

  test('sanitizeTournamentId enforces strict format', () => {
    expect(sanitizeTournamentId(' tabc12 ')).toEqual({ valid: true, value: 'TABC12' });
    expect(sanitizeTournamentId('ABC12')).toEqual({ valid: false, value: '', error: 'Invalid tournament ID format' });
    expect(sanitizeTournamentId('TABC123')).toEqual({ valid: false, value: '', error: 'Invalid tournament ID format' });
  });

  test('generateTournamentId avoids collisions and returns null when exhausted', () => {
    const existing = new Map([['TAAAAA', {}], ['TBBBBB', {}]]);

    // Use small maxAttempts with deterministic collision map by pre-seeding each generated ID.
    const id = generateTournamentId(existing, 1);
    if (id !== null) {
      expect(existing.has(id)).toBe(false);
    }

    const alwaysTaken = new Map();
    const originalHas = alwaysTaken.has.bind(alwaysTaken);
    alwaysTaken.has = () => true;
    expect(generateTournamentId(alwaysTaken, 2)).toBeNull();
    alwaysTaken.has = originalHas;
  });

  test('getTournamentJoinError blocks duplicates/full/started tournaments', () => {
    const baseTournament = {
      status: 'waiting',
      tournamentSize: 4,
      participants: [{ username: 'Alice', socketId: 's1' }],
    };

    expect(getTournamentJoinError(null, 'Bob', 's2')).toBe('Tournament not found');
    expect(getTournamentJoinError({ ...baseTournament, status: 'in_progress' }, 'Bob', 's2')).toBe('Tournament already started');
    expect(getTournamentJoinError(baseTournament, 'Alice', 's2')).toBe('Username already joined this tournament');
    expect(getTournamentJoinError(baseTournament, 'Bob', 's1')).toBe('You have already joined this tournament');
    expect(
      getTournamentJoinError(
        { ...baseTournament, participants: [{ username: 'A', socketId: 's1' }, { username: 'B', socketId: 's2' }, { username: 'C', socketId: 's3' }, { username: 'D', socketId: 's4' }] },
        'E',
        's5'
      )
    ).toBe('Tournament is full');
    expect(getTournamentJoinError(baseTournament, 'Bob', 's2')).toBeNull();
  });

  test('applyTournamentMatchResult progresses bracket for 4-player tournament and sets champion', () => {
    const tournament = {
      status: 'in_progress',
      champion: null,
      rounds: initializeBracket([
        { username: 'A' },
        { username: 'B' },
        { username: 'C' },
        { username: 'D' },
      ]),
    };

    let progression = applyTournamentMatchResult(tournament, 0, 0, 'A');
    expect(progression).toEqual({ advancedRoundIndex: 1, tournamentCompleted: false });
    expect(tournament.rounds[1].matches[0].player1).toBe('A');

    progression = applyTournamentMatchResult(tournament, 0, 1, 'D');
    expect(progression).toEqual({ advancedRoundIndex: 1, tournamentCompleted: false });
    expect(tournament.rounds[1].matches[0].player2).toBe('D');

    progression = applyTournamentMatchResult(tournament, 1, 0, 'D');
    expect(progression).toEqual({ advancedRoundIndex: null, tournamentCompleted: true });
    expect(tournament.status).toBe('finished');
    expect(tournament.champion).toBe('D');
  });

  test('applyTournamentMatchResult supports full 8-player progression', () => {
    const tournament = {
      status: 'in_progress',
      champion: null,
      rounds: initializeBracket(Array.from({ length: 8 }, (_, i) => ({ username: `P${i + 1}` }))),
    };

    // Quarterfinals
    applyTournamentMatchResult(tournament, 0, 0, 'P1');
    applyTournamentMatchResult(tournament, 0, 1, 'P4');
    applyTournamentMatchResult(tournament, 0, 2, 'P5');
    applyTournamentMatchResult(tournament, 0, 3, 'P8');
    expect(tournament.rounds[1].matches[0]).toMatchObject({ player1: 'P1', player2: 'P4' });
    expect(tournament.rounds[1].matches[1]).toMatchObject({ player1: 'P5', player2: 'P8' });

    // Semifinals
    applyTournamentMatchResult(tournament, 1, 0, 'P4');
    applyTournamentMatchResult(tournament, 1, 1, 'P5');
    expect(tournament.rounds[2].matches[0]).toMatchObject({ player1: 'P4', player2: 'P5' });

    const finalProgress = applyTournamentMatchResult(tournament, 2, 0, 'P5');
    expect(finalProgress).toEqual({ advancedRoundIndex: null, tournamentCompleted: true });
    expect(tournament.champion).toBe('P5');
    expect(tournament.status).toBe('finished');
  });
});
