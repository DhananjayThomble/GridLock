/**
 * Tests for waiting room socket events: lobby_state, replace_with_cpu, start_game_early
 * Uses mock sockets to directly test handler logic. Compatible with Jest --runInBand.
 */

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
const { initializeGameState } = require('../utils/gameLogic');
const attachSocketHandlers = require('../controllers/socketHandlers');

const PC = { player1: '#3B82F6', player2: '#EF4444', player3: '#10B981', player4: '#A855F7' };

function mockSocket(id, rooms = []) {
  const emitted = [], handlers = {};
  const s = {
    id, rooms: new Set([id, ...rooms]), data: {},
    conn: { remoteAddress: '127.0.0.1' },
    handshake: { address: '127.0.0.1', headers: {} },
    emit: jest.fn((e, d) => emitted.push({ event: e, data: d })),
    join: jest.fn((r) => s.rooms.add(r)),
    leave: jest.fn((r) => s.rooms.delete(r)),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on: jest.fn((e, h) => { handlers[e] = h; }),
    _emitted: emitted, _handlers: handlers,
  };
  return s;
}

async function makeGame(gameId, opts = {}) {
  const pc = opts.playerCount || 2;
  const g = {
    id: gameId, gridSize: opts.gridSize || 3, playerCount: pc, players: {},
    gameState: initializeGameState(opts.gridSize || 3, pc),
    createdAt: Date.now(), metadata: { reconnectWindowMs: 8000 },
    cpuDifficulty: opts.cpuDifficulty || null,
  };
  if (opts.host) g.players.player1 = { id: opts.host.sid, username: opts.host.name, avatar: '👦', color: PC.player1, token: opts.host.tok || 'a'.repeat(48), disconnectedAt: null };
  if (opts.p2) g.players.player2 = { id: opts.p2.sid, username: opts.p2.name, avatar: '👧', color: PC.player2, token: opts.p2.tok || 'b'.repeat(48), disconnectedAt: opts.p2.disc || null };
  await gameStore.setGame(gameId, g);
  return g;
}

let io, connHandler, sockets, roomEmits;

beforeAll(() => {
  sockets = new Map(); roomEmits = [];
  io = {
    on: jest.fn(), sockets: { sockets },
    to: jest.fn(() => ({ emit: jest.fn((e, d) => roomEmits.push({ event: e, data: d })) })),
  };
  attachSocketHandlers(io, { info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  connHandler = io.on.mock.calls.find(([e]) => e === 'connection')[1];
});

afterEach(async () => {
  roomEmits.length = 0;
  for (const [id] of (await gameStore.getAllActiveGames()).entries()) await gameStore.deleteGame(id);
});

function reg(s) { sockets.set(s.id, s); connHandler(s); return s; }

function expectLobbyStatePayload(payload, expected) {
  expect(payload).toMatchObject({
    gameId: expected.gameId,
    playerCount: expected.playerCount,
    filled: expected.filled,
  });
  expect(payload.slots).toEqual(expect.arrayContaining(expected.slots));
}

describe('lobby_state', () => {
  test('returns correct slots', async () => {
    const s = reg(mockSocket('h1', ['LOBY01']));
    await makeGame('LOBY01', { host: { sid: 'h1', name: 'Alice' }, playerCount: 3 });
    await s._handlers['lobby_state']({ gameId: 'LOBY01' });
    const d = s._emitted.find(e => e.event === 'lobby_state');
    expect(d).toBeTruthy();
    expect(d.data.slots).toHaveLength(3);
    expect(d.data.slots[0].username).toBe('Alice');
    expect(d.data.slots[0].isHost).toBe(true);
    expect(d.data.filled).toBe(1);
  });

  test('rejects socket not in room', async () => {
    const s = reg(mockSocket('outsider'));
    await makeGame('LOBY02', { host: { sid: 'other', name: 'Bob' } });
    await s._handlers['lobby_state']({ gameId: 'LOBY02' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Not in this game');
  });
});

describe('leave_waiting_room', () => {
  test('removes socket from the waiting room', async () => {
    const s = reg(mockSocket('h1', ['LEAV01']));
    expect(s.rooms.has('LEAV01')).toBe(true);

    await s._handlers['leave_waiting_room']({ gameId: 'LEAV01' });

    expect(s.leave).toHaveBeenCalledWith('LEAV01');
    expect(s.rooms.has('LEAV01')).toBe(false);
    expect(s._emitted.find(e => e.event === 'error')).toBeFalsy();
  });
});

describe('replace_with_cpu', () => {
  test('host replaces empty slot', async () => {
    const s = reg(mockSocket('h1', ['REPL01']));
    await makeGame('REPL01', { host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 3 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL01', sessionToken: 'a'.repeat(48), slot: 'player2', difficulty: 'hard' });
    const d = roomEmits.find(e => e.event === 'lobby_state');
    expect(d).toBeTruthy();
    expect(d.data).toMatchObject({
      gameId: 'REPL01',
      playerCount: 3,
      cpuDifficulty: 'hard',
      filled: 2,
    });
    expect(d.data.slots).toHaveLength(3);
    expect(d.data.slots[0]).toMatchObject({
      slot: 'player1',
      username: 'Host',
      isHost: true,
      isCPU: false,
      connected: true,
      disconnectedAt: null,
    });
    expect(d.data.slots[1]).toMatchObject({
      slot: 'player2',
      username: 'Bot-Beta',
      avatar: '🧠',
      isCPU: true,
      isHost: false,
      connected: true,
      disconnectedAt: null,
    });
    expect(d.data.slots[2]).toMatchObject({
      slot: 'player3',
      username: null,
      avatar: null,
      isCPU: false,
      isHost: false,
      connected: false,
      disconnectedAt: null,
    });
  });

  test('non-host rejected', async () => {
    const s = reg(mockSocket('nh', ['REPL02']));
    await makeGame('REPL02', { host: { sid: 'h2', name: 'Host' }, p2: { sid: 'nh', name: 'J', tok: 'b'.repeat(48) }, playerCount: 3 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL02', sessionToken: 'b'.repeat(48), slot: 'player3', difficulty: 'easy' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Only the game host can replace slots');
  });

  test('rejects already-CPU slot', async () => {
    const s = reg(mockSocket('h1', ['REPL03']));
    const g = await makeGame('REPL03', { host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 2 });
    g.players.player2 = { id: 'cpu-1', username: 'Bot', avatar: '🤖', color: PC.player2, token: 'ct', disconnectedAt: null, isCPU: true };
    await gameStore.setGame('REPL03', g);
    await s._handlers['replace_with_cpu']({ gameId: 'REPL03', sessionToken: 'a'.repeat(48), slot: 'player2', difficulty: 'medium' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('This slot is already a CPU player');
  });

  test('rejects invalid slot for a 2-player game', async () => {
    const s = reg(mockSocket('h1', ['REPL04']));
    await makeGame('REPL04', { host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 2 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL04', sessionToken: 'a'.repeat(48), slot: 'player3', difficulty: 'medium' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Invalid slot for this game');
    expect(roomEmits.find(e => e.event === 'lobby_state')).toBeFalsy();
    const g = await gameStore.getGame('REPL04');
    expect(g.players.player3).toBeUndefined();
  });

  test('rejects cross-socket token replay for host-only replace_with_cpu', async () => {
    const s = reg(mockSocket('attacker', ['REPL05']));
    await makeGame('REPL05', { host: { sid: 'host-socket', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 3 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL05', sessionToken: 'a'.repeat(48), slot: 'player2', difficulty: 'easy' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Only the game host can replace slots');
    const g = await gameStore.getGame('REPL05');
    expect(g.players.player2).toBeUndefined();
  });

  test('rejects replacing host slot (player1)', async () => {
    const s = reg(mockSocket('h1', ['REPL06']));
    await makeGame('REPL06', { host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 3 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL06', sessionToken: 'a'.repeat(48), slot: 'player1', difficulty: 'easy' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Invalid slot for this game');
  });

  test('auto-starts when CPU replacement fills the last slot', async () => {
    const hs = reg(mockSocket('h1', ['REPL07']));
    const p2s = mockSocket('p2', ['REPL07']); sockets.set('p2', p2s);
    await makeGame('REPL07', {
      host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) },
      p2: { sid: 'p2', name: 'Joiner', tok: 'b'.repeat(48) },
      playerCount: 3,
    });

    await hs._handlers['replace_with_cpu']({
      gameId: 'REPL07',
      sessionToken: 'a'.repeat(48),
      slot: 'player3',
      difficulty: 'medium',
    });

    expect(hs._emitted.find(e => e.event === 'game_started')?.data).toMatchObject({
      gameId: 'REPL07',
      playerId: 'player1',
      sessionToken: 'a'.repeat(48),
      cpuDifficulty: 'medium',
    });
    expect(p2s._emitted.find(e => e.event === 'game_started')?.data).toMatchObject({
      gameId: 'REPL07',
      playerId: 'player2',
      sessionToken: 'b'.repeat(48),
      cpuDifficulty: 'medium',
    });

    const joinedEvent = roomEmits.find(e => e.event === 'all_players_joined');
    expect(joinedEvent).toBeTruthy();
    expect(joinedEvent.data).toMatchObject({
      gameId: 'REPL07',
      lobbyState: {
        gameId: 'REPL07',
        playerCount: 3,
        cpuDifficulty: 'medium',
        filled: 3,
      },
    });
    expect(roomEmits.find(e => e.event === 'lobby_state')).toBeFalsy();

    const g = await gameStore.getGame('REPL07');
    expect(g.players.player3).toMatchObject({
      isCPU: true,
      username: 'Bot-Gamma',
    });
  });
});

describe('start_game_early', () => {
  test('per-player game_started + CPU fill', async () => {
    const hs = reg(mockSocket('h1', ['STRT01']));
    const p2s = mockSocket('p2', ['STRT01']); sockets.set('p2', p2s);
    await makeGame('STRT01', { host: { sid: 'h1', name: 'H', tok: 'a'.repeat(48) }, p2: { sid: 'p2', name: 'J', tok: 'b'.repeat(48) }, playerCount: 3 });
    await hs._handlers['start_game_early']({ gameId: 'STRT01', sessionToken: 'a'.repeat(48), cpuDifficulty: 'easy' });
    const hd = hs._emitted.find(e => e.event === 'game_started');
    expect(hd?.data.playerId).toBe('player1');
    expect(hd?.data.sessionToken).toBe('a'.repeat(48));
    const pd = p2s._emitted.find(e => e.event === 'game_started');
    expect(pd?.data.playerId).toBe('player2');
    expect(pd?.data.sessionToken).toBe('b'.repeat(48));
    const lobbyEvent = roomEmits.find(e => e.event === 'all_players_joined');
    expect(lobbyEvent).toBeTruthy();
    expect(lobbyEvent.data).toMatchObject({
      gameId: 'STRT01',
      lobbyState: {
        gameId: 'STRT01',
        playerCount: 3,
        cpuDifficulty: 'easy',
        filled: 3,
      },
    });
    expect(lobbyEvent.data.lobbyState.slots).toHaveLength(3);
    expect(lobbyEvent.data.lobbyState.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slot: 'player1',
        username: 'H',
        isHost: true,
        isCPU: false,
        connected: true,
        disconnectedAt: null,
      }),
      expect.objectContaining({
        slot: 'player2',
        username: 'J',
        isHost: false,
        isCPU: false,
        connected: true,
        disconnectedAt: null,
      }),
      expect.objectContaining({
        slot: 'player3',
        username: 'Bot-Gamma',
        avatar: '🎯',
        isHost: false,
        isCPU: true,
        connected: true,
        disconnectedAt: null,
      }),
    ]));
    const g = await gameStore.getGame('STRT01');
    expect(g.players.player3?.isCPU).toBe(true);
  });

  test('rejects non-host', async () => {
    const s = reg(mockSocket('nh', ['STRT02']));
    await makeGame('STRT02', { host: { sid: 'h2', name: 'H' }, p2: { sid: 'nh', name: 'J', tok: 'b'.repeat(48) }, playerCount: 3 });
    await s._handlers['start_game_early']({ gameId: 'STRT02', sessionToken: 'b'.repeat(48), cpuDifficulty: 'medium' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Only the game host can start the game');
  });

  test('rejects 1-player start', async () => {
    const s = reg(mockSocket('h1', ['STRT03']));
    await makeGame('STRT03', { host: { sid: 'h1', name: 'Solo', tok: 'a'.repeat(48) }, playerCount: 3 });
    await s._handlers['start_game_early']({ gameId: 'STRT03', sessionToken: 'a'.repeat(48), cpuDifficulty: 'medium' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Need at least 2 players to start the game');
  });

  test('rejects cross-socket token replay for host-only start_game_early', async () => {
    const s = reg(mockSocket('attacker', ['STRT04']));
    await makeGame('STRT04', { host: { sid: 'host-socket', name: 'Host', tok: 'a'.repeat(48) }, p2: { sid: 'p2', name: 'Joiner', tok: 'b'.repeat(48) }, playerCount: 3 });
    await s._handlers['start_game_early']({ gameId: 'STRT04', sessionToken: 'a'.repeat(48), cpuDifficulty: 'medium' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Only the game host can start the game');
    expect(roomEmits.find(e => e.event === 'all_players_joined')).toBeFalsy();
  });

  test('rejects start_game_early when game already in progress', async () => {
    const s = reg(mockSocket('h1', ['STRT05']));
    const cb = jest.fn();
    const g = await makeGame('STRT05', {
      host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) },
      p2: { sid: 'p2', name: 'Joiner', tok: 'b'.repeat(48) },
      playerCount: 2,
    });
    await gameStore.setGame('STRT05', g);
    await s._handlers['start_game_early']({ gameId: 'STRT05', sessionToken: 'a'.repeat(48), cpuDifficulty: 'medium' }, cb);
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Game already in progress');
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Game already in progress' });
  });
});

describe('lobbyState event payloads', () => {
  test('includes lobbyState on player_joined', async () => {
    const host = reg(mockSocket('host', ['JOIN01']));
    const joiner = reg(mockSocket('joiner'));
    await makeGame('JOIN01', {
      host: { sid: 'host', name: 'Host', tok: 'a'.repeat(48) },
      playerCount: 3,
    });

    await joiner._handlers.join_game({
      gameId: 'JOIN01',
      username: 'Joiner',
      avatar: '👧',
    });

    const joinedEvent = roomEmits.find(e => e.event === 'player_joined');
    expect(joinedEvent).toBeTruthy();
    expectLobbyStatePayload(joinedEvent.data.lobbyState, {
      gameId: 'JOIN01',
      playerCount: 3,
      filled: 2,
      slots: [
        expect.objectContaining({
          slot: 'player1',
          username: 'Host',
          isHost: true,
          connected: true,
        }),
        expect.objectContaining({
          slot: 'player2',
          username: 'Joiner',
          avatar: '👧',
          isHost: false,
          connected: true,
        }),
        expect.objectContaining({
          slot: 'player3',
          username: null,
          connected: false,
        }),
      ],
    });
    expect(host.rooms.has('JOIN01')).toBe(true);
  });

  test('includes lobbyState on player_disconnected', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockReturnValue(123);
    const host = reg(mockSocket('h1', ['DISC01']));
    const player2 = reg(mockSocket('p2', ['DISC01']));
    await makeGame('DISC01', {
      host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) },
      p2: { sid: 'p2', name: 'Joiner', tok: 'b'.repeat(48) },
      playerCount: 3,
    });
    player2.data.gameId = 'DISC01';
    player2.data.playerId = 'player2';
    player2.data.username = 'Joiner';

    await player2._handlers.disconnect();
    setTimeoutSpy.mockRestore();

    const disconnectedEvent = roomEmits.find(e => e.event === 'player_disconnected');
    expect(disconnectedEvent).toBeTruthy();
    expectLobbyStatePayload(disconnectedEvent.data.lobbyState, {
      gameId: 'DISC01',
      playerCount: 3,
      filled: 2,
      slots: [
        expect.objectContaining({
          slot: 'player1',
          username: 'Host',
          connected: true,
        }),
        expect.objectContaining({
          slot: 'player2',
          username: 'Joiner',
          connected: false,
        }),
        expect.objectContaining({
          slot: 'player3',
          username: null,
          connected: false,
        }),
      ],
    });
    expect(disconnectedEvent.data.lobbyState.slots.find(s => s.slot === 'player2').disconnectedAt).toBeTruthy();
    expect(host.rooms.has('DISC01')).toBe(true);
  });

  test('includes lobbyState on player_reconnected', async () => {
    const host = reg(mockSocket('host', ['RECON01']));
    const original = reg(mockSocket('old-p2', ['RECON01']));
    await makeGame('RECON01', {
      host: { sid: 'host', name: 'Host', tok: 'a'.repeat(48) },
      p2: { sid: 'old-p2', name: 'Joiner', tok: 'b'.repeat(48), disc: new Date().toISOString() },
      playerCount: 3,
    });

    const reconnecting = reg(mockSocket('new-p2'));
    await reconnecting._handlers.join_game({
      gameId: 'RECON01',
      username: 'Joiner',
      avatar: '😎',
      sessionToken: 'b'.repeat(48),
    });

    const reconnectedEvent = reconnecting.to.mock.results[0].value.emit.mock.calls.find(([event]) => event === 'player_reconnected');
    expect(reconnectedEvent).toBeTruthy();
    expect(reconnectedEvent[1].lobbyState).toBeTruthy();
    expectLobbyStatePayload(reconnectedEvent[1].lobbyState, {
      gameId: 'RECON01',
      playerCount: 3,
      filled: 2,
      slots: [
        expect.objectContaining({
          slot: 'player1',
          username: 'Host',
          connected: true,
        }),
        expect.objectContaining({
          slot: 'player2',
          username: 'Joiner',
          avatar: '😎',
          connected: true,
          disconnectedAt: null,
        }),
        expect.objectContaining({
          slot: 'player3',
          username: null,
          connected: false,
        }),
      ],
    });
    expect(host.rooms.has('RECON01')).toBe(true);
  });
});
