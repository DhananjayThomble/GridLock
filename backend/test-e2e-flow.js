// test-e2e-flow.js - End-to-end multiplayer integration tests

const { io } = require('socket.io-client');
const BASE = 'http://localhost:5000';

let passed = 0, failed = 0;
const clients = [];

function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else       { console.error(`  ❌ ${msg}`); failed++; }
}
function makeClient() {
  const c = io(BASE, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}
function waitFor(socket, event, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createAndJoin2Players() {
  const p1 = makeClient(); const p2 = makeClient();
  await sleep(200);

  const ack = await new Promise(resolve =>
    p1.emit('create_game', { gridSize: 2, username: 'Alice', avatar: '👩', playerCount: 2 }, resolve)
  );
  const gid = ack.gameId;

  // P1 join
  const p1StartedP = waitFor(p1, 'game_started');
  p1.emit('join_game', { gameId: gid, username: 'Alice', avatar: '👩' });
  await p1StartedP;

  // P2 join — p1 also gets updated game_started
  const p2StartedP = waitFor(p2, 'game_started');
  p2.emit('join_game', { gameId: gid, username: 'Bob', avatar: '👦' });
  const p2State = await p2StartedP;

  return { p1, p2, gid, p2State };
}

async function runTests() {
  console.log('🧪 GridLock E2E Integration Tests\n');

  // ── Test 1: 2-Player create & join ───────────────────────────────────────
  console.log('Test 1: 2-Player create & join');
  try {
    const { p1, p2, gid, p2State } = await createAndJoin2Players();
    assert(gid && gid.length === 6, 'Game created with 6-char ID');
    assert(p2State?.gameState?.player2Name === 'Bob', 'P2 name in game state');
    assert(p2State?.gameState?.player1Name === 'Alice', 'P1 name in game state');
    assert(p2State?.gameState?.currentPlayer === 'player1', 'P1 starts first');
    p1.disconnect(); p2.disconnect();
    console.log('');
  } catch (e) { console.error('  ❌ Test 1 error:', e.message); failed++; console.log(''); }

  // ── Test 2: 4-Player game setup ──────────────────────────────────────────
  console.log('Test 2: 4-Player game setup');
  try {
    const players = ['Alice','Bob','Charlie','Diana'].map(name => ({ name, client: makeClient() }));
    await sleep(200);

    const ack = await new Promise(resolve =>
      players[0].client.emit('create_game', { gridSize: 4, username: 'Alice', avatar: '👩', playerCount: 4 }, resolve)
    );
    assert(ack?.gameId, '4-player game created with ID');
    const gid4 = ack.gameId;

    for (const { name, client } of players) {
      const startP = waitFor(client, 'game_started');
      client.emit('join_game', { gameId: gid4, username: name, avatar: '👤' });
      await startP;
      await sleep(80);
    }

    // Last started state
    const finalStartP = waitFor(players[3].client, 'game_started');
    players[3].client.emit('join_game', { gameId: gid4, username: 'Diana', avatar: '👤' });
    const finalState = await finalStartP;
    assert(finalState?.gameState?.playerCount === 4, 'playerCount is 4');
    assert(finalState?.gameState?.player4Name === 'Diana', 'Player 4 name is Diana');

    players.forEach(p => p.client.disconnect());
    console.log('');
  } catch (e) { console.error('  ❌ Test 2 error:', e.message); failed++; console.log(''); }

  // ── Test 3: Turn rotation ────────────────────────────────────────────────
  console.log('Test 3: Turn rotation (2-player)');
  try {
    const { p1, p2, gid } = await createAndJoin2Players();
    await sleep(100);

    p1.emit('make_move', { gameId: gid, playerId: 'player1', type: 'horizontal', r: 0, c: 0 });
    const upd = await waitFor(p1, 'game_update');
    assert(upd.gameState.currentPlayer === 'player2', 'Turn switches to P2');

    // P1 attempts to play out of turn
    const errP = waitFor(p1, 'error', 1500);
    p1.emit('make_move', { gameId: gid, playerId: 'player1', type: 'horizontal', r: 0, c: 1 });
    const errMsg = await errP;
    assert(errMsg === 'Not your turn', 'Out-of-turn move rejected');

    p1.disconnect(); p2.disconnect();
    console.log('');
  } catch (e) { console.error('  ❌ Test 3 error:', e.message); failed++; console.log(''); }

  // ── Test 4: Duplicate line rejected ─────────────────────────────────────
  console.log('Test 4: Duplicate line rejected');
  try {
    const { p1, p2, gid } = await createAndJoin2Players();
    await sleep(100);

    p1.emit('make_move', { gameId: gid, playerId: 'player1', type: 'horizontal', r: 0, c: 0 });
    await waitFor(p1, 'game_update');
    // P2 tries to claim the same line
    const errP = waitFor(p2, 'error', 1500);
    p2.emit('make_move', { gameId: gid, playerId: 'player2', type: 'horizontal', r: 0, c: 0 });
    const errMsg = await errP;
    assert(typeof errMsg === 'string', 'Duplicate line rejected with error');

    p1.disconnect(); p2.disconnect();
    console.log('');
  } catch (e) { console.error('  ❌ Test 4 error:', e.message); failed++; console.log(''); }

  // ── Test 5: Complete game + winner detection ──────────────────────────────
  console.log('Test 5: Complete 2x2 game + winner detection');
  try {
    const { p1, p2, gid } = await createAndJoin2Players();
    await sleep(100);

    // Replay all 12 moves for a 2x2 grid
    const lines = [
      ['horizontal',0,0],['horizontal',0,1],
      ['horizontal',1,0],['horizontal',1,1],
      ['horizontal',2,0],['horizontal',2,1],
      ['vertical',0,0],  ['vertical',0,1],  ['vertical',0,2],
      ['vertical',1,0],  ['vertical',1,1],  ['vertical',1,2],
    ];

    let currentPlayer = 'player1';
    let lastGs = null;

    for (const [type, r, c] of lines) {
      const sock = currentPlayer === 'player1' ? p1 : p2;
      const updP = waitFor(p1, 'game_update', 3000);
      sock.emit('make_move', { gameId: gid, playerId: currentPlayer, type, r, c });
      try {
        const upd = await updP;
        lastGs = upd.gameState;
        if (!lastGs.gameOver) currentPlayer = lastGs.currentPlayer;
        else break;
      } catch { break; }
    }

    assert(lastGs?.gameOver === true, 'gameOver flag is true');
    assert(lastGs?.winner, `Winner determined: ${lastGs?.winner}`);
    const total = Object.values(lastGs.scores || {}).reduce((a, b) => a + b, 0);
    assert(total === 4, `All 4 boxes scored (got ${total})`);

    p1.disconnect(); p2.disconnect();
    console.log('');
  } catch (e) { console.error('  ❌ Test 5 error:', e.message); failed++; console.log(''); }

  // ── Test 6: Error — join non-existent game ────────────────────────────────
  console.log('Test 6: Error handling');
  try {
    const c = makeClient(); await sleep(200);
    const errP = waitFor(c, 'error', 2000);
    c.emit('join_game', { gameId: 'ZZZZZZ', username: 'Test', avatar: '👤' });
    const err = await errP;
    assert(typeof err === 'string', 'Error emitted for non-existent game');
    c.disconnect(); console.log('');
  } catch (e) { console.error('  ❌ Test 6 error:', e.message); failed++; console.log(''); }

  // ── Test 7: Health endpoint ───────────────────────────────────────────────
  console.log('Test 7: Health endpoint');
  try {
    const http = require('http');
    const h = await new Promise((res, rej) => {
      http.get('http://localhost:5000/health', (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });
    assert(h.status === 'ok', 'Health status is ok');
    assert(typeof h.activeGames === 'number', 'Reports activeGames count');
    console.log(`  Active games: ${h.activeGames}`);
    console.log('');
  } catch (e) { console.error('  ❌ Test 7 error:', e.message); failed++; console.log(''); }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  clients.forEach(c => { try { c.disconnect(); } catch {} });
  await sleep(200);

  console.log('════════════════════════════════════════');
  console.log(`Tests Passed : ${passed}`);
  console.log(`Tests Failed : ${failed}`);
  if (failed === 0) { console.log('🎉 All E2E tests passed!'); }
  else              { console.log('⚠️  Some tests failed!'); }
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => { console.error('Fatal:', e); process.exit(1); });
