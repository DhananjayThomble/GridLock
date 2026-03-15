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

describe('replace_with_cpu', () => {
  test('host replaces empty slot', async () => {
    const s = reg(mockSocket('h1', ['REPL01']));
    await makeGame('REPL01', { host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 3 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL01', sessionToken: 'a'.repeat(48), slot: 'player2', difficulty: 'hard' });
    const d = roomEmits.find(e => e.event === 'lobby_state');
    expect(d).toBeTruthy();
    expect(d.data.slots.find(s => s.slot === 'player2').isCPU).toBe(true);
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
    const g = await gameStore.getGame('REPL04');
    expect(g.players.player3).toBeUndefined();
  });

  test('rejects cross-socket token replay for host-only replace_with_cpu', async () => {
    const s = reg(mockSocket('attacker', ['REPL05']));
    await makeGame('REPL05', { host: { sid: 'host-socket', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 3 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL05', sessionToken: 'a'.repeat(48), slot: 'player2', difficulty: 'easy' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Only the game host can replace slots');
  });

  test('rejects replacing host slot (player1)', async () => {
    const s = reg(mockSocket('h1', ['REPL06']));
    await makeGame('REPL06', { host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) }, playerCount: 3 });
    await s._handlers['replace_with_cpu']({ gameId: 'REPL06', sessionToken: 'a'.repeat(48), slot: 'player1', difficulty: 'easy' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Invalid slot for this game');
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
  });

  test('rejects start_game_early when game already in progress', async () => {
    const s = reg(mockSocket('h1', ['STRT05']));
    const g = await makeGame('STRT05', {
      host: { sid: 'h1', name: 'Host', tok: 'a'.repeat(48) },
      p2: { sid: 'p2', name: 'Joiner', tok: 'b'.repeat(48) },
      playerCount: 2,
    });
    await gameStore.setGame('STRT05', g);
    await s._handlers['start_game_early']({ gameId: 'STRT05', sessionToken: 'a'.repeat(48), cpuDifficulty: 'medium' });
    expect(s._emitted.find(e => e.event === 'error')?.data).toBe('Game already in progress');
  });
});
