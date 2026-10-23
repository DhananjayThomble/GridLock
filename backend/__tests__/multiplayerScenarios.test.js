/**
 * Multiplayer scenario tests (#593).
 *
 * Starts the real server as a child process (NODE_ENV=test, so the disconnect window is 8s)
 * and drives it with real socket.io clients, the way separate browsers would. Covers 2, 3 and
 * 4 player games, players leaving or dropping, rejoining, bad joins, spectators and tampering.
 *
 * Needs MongoDB (MONGO_URI, default mongodb://127.0.0.1:27017), like the rest of the backend suite.
 */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { io } = require('socket.io-client');

jest.setTimeout(60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let serverProc;
let URL;
const openClients = [];

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
        srv.on('error', reject);
    });
}

async function waitForHealth(url, ms = 30000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try { const r = await fetch(`${url}/health`); if (r.ok) return; } catch (_) { /* not up yet */ }
        await sleep(250);
    }
    throw new Error('server did not become healthy');
}

beforeAll(async () => {
    const port = await freePort();
    URL = `http://127.0.0.1:${port}`;
    // Same Mongo server as the rest of the suite, but a database of our own: drop any /dbname suffix
    const base = (process.env.MONGO_URI || 'mongodb://127.0.0.1:27017').replace(/\/[^/:@]*(\?.*)?$/, '');
    serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            MONGO_URI: `${base}/gridlock_scenarios_${process.pid}`,
            REDIS_URL: '',
            LOG_LEVEL: 'ERROR',
        },
        stdio: 'ignore',
    });
    await waitForHealth(URL);
});

afterAll(async () => {
    openClients.forEach((c) => c.close());
    if (serverProc) serverProc.kill('SIGTERM');
    await sleep(200);
});

// ── helpers ────────────────────────────────────────────────────────────────────

function client(label) {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.label = label;
    s.log = [];
    s.state = null;
    s.onAny((e, ...a) => s.log.push({ e, a }));
    s.on('game_update', (d) => { s.state = d.gameState; });
    s.on('game_started', (d) => {
        if (d.gameState) s.state = d.gameState;
        if (d.playerId) s.playerId = d.playerId;
        if (d.sessionToken) s.token = d.sessionToken;
        if (d.gameId) s.gameId = d.gameId;
    });
    openClients.push(s);
    return s;
}
const connected = (s) => new Promise((res, rej) => {
    if (s.connected) return res(s);
    s.once('connect', () => res(s));
    s.once('connect_error', rej);
});

/** Resolves with the first matching event, including ones already received since `from`. */
function waitFor(s, event, pred = () => true, { from = 0, ms = 8000 } = {}) {
    const seen = s.log.slice(from).find((x) => x.e === event && pred(...x.a));
    if (seen) return Promise.resolve(seen.a[0]);
    return new Promise((res, rej) => {
        const t = setTimeout(() => { s.off(event, h); rej(new Error(`${s.label}: timed out waiting for "${event}"`)); }, ms);
        const h = (...a) => { if (pred(...a)) { clearTimeout(t); s.off(event, h); res(a[0]); } };
        s.on(event, h);
    });
}
const eventsSince = (s, from) => s.log.slice(from).map((x) => x.e);
const errorsSince = (s, from) => s.log.slice(from).filter((x) => x.e === 'error').map((x) => x.a[0]);

async function newRoom(n, { gridSize = 3 } = {}) {
    const players = [];
    for (let i = 0; i < n; i++) players.push(client(`P${i + 1}`));
    await Promise.all(players.map(connected));
    const host = players[0];
    host.emit('create_game', { username: 'U1', avatar: '👦', gridSize, playerCount: n });
    await waitFor(host, 'game_started');
    players.forEach((p) => { p.gameId = host.gameId; });
    for (let i = 1; i < n; i++) {
        players[i].username = `U${i + 1}`;
        players[i].emit('join_game', { gameId: host.gameId, username: `U${i + 1}`, avatar: '👧' });
        await waitFor(players[i], 'game_started', (d) => !!d.playerId);
    }
    await waitFor(host, 'room_full');
    host.emit('start_game', { gameId: host.gameId, sessionToken: host.token });
    await Promise.all(players.map((p) => waitFor(p, 'all_players_joined')));
    return { players, gameId: host.gameId };
}

const currentMover = (players) => players.find((p) => p.playerId === players[0].state.currentPlayer);
const lineCount = (st) => st.horizontalLines.flat().length + st.verticalLines.flat().length;
const openLines = (st) => {
    const out = [];
    st.horizontalLines.forEach((row, r) => row.forEach((v, c) => { if (!v) out.push({ type: 'horizontal', r, c }); }));
    st.verticalLines.forEach((row, r) => row.forEach((v, c) => { if (!v) out.push({ type: 'vertical', r, c }); }));
    return out;
};
const move = (p, line) => p.emit('make_move', { gameId: p.gameId, playerId: p.playerId, sessionToken: p.token, ...line });

async function playOut(players, maxMoves = 200) {
    let n = 0;
    while (!players[0].state.winner && n++ < maxMoves) {
        const mover = currentMover(players);
        if (!mover) break;
        move(mover, openLines(players[0].state)[0]);
        await sleep(30);
    }
    await sleep(300);
}

async function rejoin(gameId, username, token) {
    const s = client(`re-${username}`);
    await connected(s);
    s.gameId = gameId;
    s.emit('join_game', { gameId, username, avatar: '👦', sessionToken: token });
    await waitFor(s, 'game_started');
    return s;
}

// ── scenarios ──────────────────────────────────────────────────────────────────

describe('full games', () => {
    test.each([2, 3, 4])('%i players play a whole 3x3 game to a result', async (n) => {
        const { players } = await newRoom(n);
        await playOut(players);
        const st = players[0].state;
        expect(st.winner).toBeTruthy();
        expect(openLines(st)).toHaveLength(0);
        const total = Object.values(st.scores).reduce((a, b) => a + b, 0);
        expect(total).toBe(9); // every box belongs to somebody
        await Promise.all(players.map((p) => waitFor(p, 'game_over')));
    });

    test('4 players: turns rotate 1 -> 2 -> 3 -> 4 -> 1 while nobody completes a box', async () => {
        const { players } = await newRoom(4);
        const order = [];
        for (let i = 0; i < 5; i++) {
            const mover = currentMover(players);
            order.push(mover.playerId);
            // lines 0, 2, 4, 6 of the open list never share a box in a fresh 3x3 board
            move(mover, openLines(players[0].state)[Math.min(i * 2, 6)]);
            await sleep(120);
        }
        expect(order).toEqual(['player1', 'player2', 'player3', 'player4', 'player1']);
    });
});

describe('illegal moves', () => {
    test('a move out of turn is rejected and changes nothing', async () => {
        const { players } = await newRoom(3);
        const waiting = players.find((p) => p !== currentMover(players));
        const mark = waiting.log.length;
        const before = lineCount(players[0].state) - openLines(players[0].state).length;
        move(waiting, openLines(players[0].state)[0]);
        await sleep(300);
        expect(errorsSince(waiting, mark)).toContain('Not your turn');
        expect(lineCount(players[0].state) - openLines(players[0].state).length).toBe(before);
    });

    test('rapid repeated moves from one player draw exactly one line', async () => {
        const { players } = await newRoom(2);
        const mover = currentMover(players);
        const lines = openLines(players[0].state);
        move(mover, lines[0]); move(mover, lines[1]); move(mover, lines[2]);
        await sleep(400);
        expect(lineCount(players[0].state) - openLines(players[0].state).length).toBe(1);
    });

    test('a line that is already taken is refused and the player keeps the turn', async () => {
        const { players } = await newRoom(2);
        const a = currentMover(players);
        const b = players.find((p) => p !== a);
        const line = openLines(players[0].state)[0];
        move(a, line); await sleep(200);
        move(b, line); await sleep(200);          // b takes a turn on the same line
        const mark = b.log.length;
        expect(b.state.currentPlayer).toBe(b.playerId);
        move(b, line); await sleep(300);
        expect(errorsSince(b, mark).length).toBeGreaterThan(0);
        expect(b.state.currentPlayer).toBe(b.playerId); // still b's turn
    });

    test('tampered coordinates and forged tokens never draw a line', async () => {
        const { players } = await newRoom(2);
        const mover = currentMover(players);
        const mark = mover.log.length;
        for (const bad of [{ type: 'horizontal', r: 99, c: 0 }, { type: 'horizontal', r: -1, c: 0 }, { type: 'diagonal', r: 0, c: 0 }, { type: 'horizontal', r: 0.5, c: 0 }, { type: 'horizontal', r: 5, c: 5 }]) {
            mover.emit('make_move', { gameId: mover.gameId, playerId: mover.playerId, sessionToken: mover.token, ...bad });
        }
        mover.emit('make_move', { gameId: mover.gameId, playerId: mover.playerId, sessionToken: 'f'.repeat(48), ...openLines(mover.state)[0] });
        await sleep(500);
        expect(errorsSince(mover, mark).length).toBeGreaterThanOrEqual(5);
        expect(openLines(mover.state)).toHaveLength(24);
    });

    test('nobody can move after the game is over', async () => {
        const { players } = await newRoom(2);
        await playOut(players);
        const p = players[0];
        const mark = p.log.length;
        move(p, { type: 'horizontal', r: 0, c: 0 });
        await sleep(300);
        expect(errorsSince(p, mark).length).toBeGreaterThan(0);
    });
});

describe('players leaving and dropping', () => {
    test('voluntary leave in a 2 player game gives the other player the win', async () => {
        const { players, gameId } = await newRoom(2);
        const [a, b] = players;
        const mark = b.log.length;
        a.emit('leave_game', { gameId });
        await waitFor(b, 'game_over', () => true, { from: mark });
        expect(b.state.winner).toBe(b.playerId);
        expect(eventsSince(b, mark)).toEqual(expect.arrayContaining(['player_left', 'player_forfeited']));
    });

    test('3 players: the leaver on the move passes the turn on and the game continues; the last two decide it', async () => {
        const { players, gameId } = await newRoom(3);
        const leaver = currentMover(players); // player1 holds the first turn
        const rest = players.filter((p) => p !== leaver);
        leaver.emit('leave_game', { gameId });
        await waitFor(rest[0], 'player_left');
        await sleep(300);
        expect(rest[0].state.winner).toBeFalsy();
        expect(['player2', 'player3']).toContain(rest[0].state.currentPlayer);

        const mover = currentMover(rest);
        move(mover, openLines(rest[0].state)[0]);
        await sleep(300);
        const next = currentMover(rest);
        expect(next).not.toBe(mover);

        const survivor = rest.find((p) => p !== next);
        next.emit('leave_game', { gameId });
        await waitFor(survivor, 'game_over');
        expect(survivor.state.winner).toBe(survivor.playerId);
    });

    test('a dropped connection is announced, and the player can come back with their token', async () => {
        const { players, gameId } = await newRoom(3);
        const dropper = players.find((p) => p !== currentMover(players) && p.playerId !== 'player1');
        const watcher = players[0];
        const mark = watcher.log.length;
        const stateBefore = JSON.stringify(watcher.state.horizontalLines);
        dropper.close();
        await waitFor(watcher, 'player_disconnected', () => true, { from: mark });

        const back = await rejoin(gameId, `U${dropper.playerId.replace('player', '')}`, dropper.token);
        await waitFor(watcher, 'player_reconnected', () => true, { from: mark });
        expect(back.playerId).toBe(dropper.playerId);
        expect(JSON.stringify(back.state.horizontalLines)).toBe(stateBefore);
        // and the game carries on: the player on the move can still move
        back.token = dropper.token;
        const mover = currentMover([watcher, back, players.find((p) => p !== watcher && p !== dropper)]);
        move(mover, openLines(watcher.state)[0]);
        await sleep(300);
        expect(lineCount(watcher.state) - openLines(watcher.state).length).toBe(1);
    });

    test('2 players: dropping on your own turn freezes the board, then forfeits after the reconnect window', async () => {
        const { players } = await newRoom(2);
        const dropper = currentMover(players);
        const other = players.find((p) => p !== dropper);
        const mark = other.log.length;
        dropper.close();
        await waitFor(other, 'player_disconnected', () => true, { from: mark });

        move(other, openLines(other.state)[0]); // it is not the other player's turn while the dropper is away
        await sleep(300);
        expect(errorsSince(other, mark)).toContain('Not your turn');

        await waitFor(other, 'game_over', () => true, { from: mark, ms: 15000 }); // 8s window in test env
        expect(other.state.winner).toBe(other.playerId);
        expect(eventsSince(other, mark)).toContain('player_forfeited');
    });

    test('4 players: a forfeit removes one player and the other three play on', async () => {
        const { players } = await newRoom(4);
        const dropper = currentMover(players);
        const rest = players.filter((p) => p !== dropper);
        const mark = rest[0].log.length;
        dropper.close();
        await waitFor(rest[0], 'player_forfeited', () => true, { from: mark, ms: 15000 });
        await sleep(300);
        expect(rest[0].state.winner).toBeFalsy();
        const mover = currentMover(rest);
        expect(mover).toBeTruthy();
        move(mover, openLines(rest[0].state)[0]);
        await sleep(300);
        expect(lineCount(rest[0].state) - openLines(rest[0].state).length).toBe(1);
    });

    test('a drop after the game is over does not forfeit or change the result', async () => {
        const { players } = await newRoom(2);
        await playOut(players);
        const winner = players[1].state.winner;
        const mark = players[1].log.length;
        players[0].close();
        await sleep(1500);
        expect(players[1].state.winner).toBe(winner);
        expect(eventsSince(players[1], mark)).not.toContain('player_forfeited');
    });
});

describe('waiting room and joining', () => {
    test('joining a full room, a missing room, or someone else\'s name is refused with a clear message', async () => {
        const { players, gameId } = await newRoom(2);
        const cases = [
            [{ gameId, username: 'Zed' }, 'Game is full'],
            [{ gameId: 'ZZZZZZ', username: 'Zed' }, 'Game not found'],
            [{ gameId, username: 'U2', sessionToken: 'a'.repeat(48) }, 'This username is already in use.'],
            [{ gameId, username: 'U2' }, 'This username is already in use.'],
        ];
        for (const [payload, message] of cases) {
            const c = client('joiner');
            await connected(c);
            c.emit('join_game', { avatar: '👦', ...payload });
            expect(await waitFor(c, 'error')).toBe(message);
        }
        expect(players).toHaveLength(2);
    });

    test('the host leaving the waiting room closes it for everyone; a guest leaving just frees the seat', async () => {
        const host = client('host'); const g1 = client('g1'); const g2 = client('g2');
        await Promise.all([host, g1, g2].map(connected));
        host.emit('create_game', { username: 'H', avatar: '👦', gridSize: 3, playerCount: 3 });
        await waitFor(host, 'game_started');
        g1.emit('join_game', { gameId: host.gameId, username: 'G1', avatar: '👧' });
        await waitFor(g1, 'game_started', (d) => !!d.playerId);

        const markHost = host.log.length;
        g1.close();
        const left = await waitFor(host, 'player_left', () => true, { from: markHost });
        expect(left.reason).toBe('disconnect_lobby');

        g2.emit('join_game', { gameId: host.gameId, username: 'G2', avatar: '🧑' }); // seat is free again
        expect((await waitFor(g2, 'game_started', (d) => !!d.playerId)).playerId).toBe('player2');

        const markG2 = g2.log.length;
        host.close();
        const closed = await waitFor(g2, 'room_closed', () => true, { from: markG2 });
        expect(closed.reason).toMatch(/host/i);
    });

    test('opening the same game in a second tab hands the seat to the new tab and tells the old one', async () => {
        const { players, gameId } = await newRoom(2);
        const first = players[0];
        const mark = first.log.length;
        const second = client('second-tab');
        await connected(second);
        second.emit('join_game', { gameId, username: 'U1', avatar: '👦', sessionToken: first.token });
        await waitFor(second, 'game_started');
        await waitFor(first, 'session_conflict', () => true, { from: mark });
        expect(second.playerId).toBe(first.playerId);
    });
});

describe('spectators', () => {
    test('a spectator sees the game, cannot move it, and leaving is announced', async () => {
        const { players, gameId } = await newRoom(2);
        const mover = currentMover(players);
        const spectator = client('spec');
        await connected(spectator);
        spectator.emit('join_game', { gameId, username: 'Watcher', avatar: '👀', joinMode: 'spectator' });
        await waitFor(spectator, 'game_started');
        expect(spectator.state).toBeTruthy();

        const before = openLines(mover.state).length;
        // forge the mover's identity, with and without the real token
        spectator.emit('make_move', { gameId, playerId: mover.playerId, sessionToken: mover.token, ...openLines(mover.state)[0] });
        spectator.emit('make_move', { gameId, playerId: mover.playerId, sessionToken: 'f'.repeat(48), ...openLines(mover.state)[0] });
        await sleep(400);
        expect(openLines(mover.state)).toHaveLength(before);

        const mark = mover.log.length;
        spectator.close();
        await waitFor(mover, 'spectator_left', () => true, { from: mark });
    });
});

describe('ranked queue', () => {
    const joinQueue = (c, name) => c.emit('ranked_queue_join', { username: name, avatar: '👦', gridSize: 3 });

    test('two players in the queue are matched into one game', async () => {
        const a = client('rq-a'); const b = client('rq-b');
        await Promise.all([connected(a), connected(b)]);
        joinQueue(a, 'RankedA'); joinQueue(b, 'RankedB');
        const [ma, mb] = await Promise.all([waitFor(a, 'ranked_queue_matched', () => true, { ms: 15000 }), waitFor(b, 'ranked_queue_matched', () => true, { ms: 15000 })]);
        expect(ma.gameId).toBe(mb.gameId);
    });

    test('a player who left the queue (cancel or closed tab) is never matched as a ghost', async () => {
        const leaver = client('rq-leaver'); const dropper = client('rq-dropper'); const waiter = client('rq-waiter');
        await Promise.all([leaver, dropper, waiter].map(connected));
        // One at a time: two players in the queue together are matched at once, which is correct
        joinQueue(leaver, 'RankedLeaver'); await waitFor(leaver, 'ranked_queue_status');
        leaver.emit('ranked_queue_leave', {}); await waitFor(leaver, 'ranked_queue_left');
        joinQueue(dropper, 'RankedDropper'); await waitFor(dropper, 'ranked_queue_status');
        dropper.close();
        await sleep(500);

        const mark = waiter.log.length;
        joinQueue(waiter, 'RankedWaiter');
        await waitFor(waiter, 'ranked_queue_status', () => true, { from: mark });
        await sleep(2500);
        expect(eventsSince(waiter, mark)).not.toContain('ranked_queue_matched');
        expect(eventsSince(leaver, 0)).not.toContain('ranked_queue_matched');
    });
});
