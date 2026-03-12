#!/usr/bin/env node
/**
 * GridLock Playtest Agent — battle-tested version
 * game_update wraps state as { gameState: {...} }
 * game_started wraps state as { gameState: {...} }  
 * game_over is flat: { winner, scores }
 */
const { io } = require('socket.io-client');
const fs = require('fs');

const ROLE = process.argv[2] || 'creator';
const URL = process.argv[3] || 'https://gridlock-api.snapurl.in';
const REPORT_FILE = process.argv[4] || `/tmp/playtest-${ROLE}-${Date.now()}.json`;

const report = { role: ROLE, url: URL, startedAt: new Date().toISOString(), gamesPlayed: 0, gamesCompleted: 0, bugs: [], observations: [], errors: [], gameResults: [] };
const bug = (sev, d, ctx={}) => { report.bugs.push({severity:sev,description:d,context:ctx}); console.log(`🐛[${sev}] ${d}`); };
const obs = (d, ctx={}) => { report.observations.push({description:d,context:ctx}); console.log(`👀 ${d}`); };
const err = (d, ctx={}) => { report.errors.push({description:d,context:ctx}); console.log(`❌ ${d}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickMove(gs) {
  const m = [];
  (gs.horizontalLines||[]).forEach((row,r) => row.forEach((v,c) => { if(!v) m.push({type:'horizontal',r,c}); }));
  (gs.verticalLines||[]).forEach((row,r) => row.forEach((v,c) => { if(!v) m.push({type:'vertical',r,c}); }));
  return m.length ? m[Math.floor(Math.random()*m.length)] : null;
}

async function playOneGame(gridSize, playerCount, cpuPlayers, cpuDifficulty) {
  return new Promise(resolve => {
    const s = io(URL, { transports:['websocket'], timeout:10000 });
    const done = setTimeout(() => { err('Timeout', {gridSize,playerCount}); s.disconnect(); resolve('timeout'); }, 35000);
    let myId=null, myToken=null, gameId=null, pendingGs=null;

    function move(gs) {
      if (!myId || !gameId || gs.gameOver) return;
      if (gs.currentPlayer !== myId) return;
      const m = pickMove(gs);
      if (!m) { bug('MEDIUM', 'No moves but not over', {gameId}); return; }
      s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c});
    }

    s.on('connect_error', e => { clearTimeout(done); err(`Connect: ${e.message}`); resolve('error'); });
    s.on('connect', () => {
      report.gamesPlayed++;
      s.emit('create_game', {gridSize, username:`Bot_${report.gamesPlayed}`, playerCount, cpuPlayers, cpuDifficulty}, resp => {
        if (!resp?.gameId) { err('Create failed', {resp}); clearTimeout(done); s.disconnect(); resolve('error'); return; }
        gameId=resp.gameId; myId=resp.playerId; myToken=resp.sessionToken;
        if (pendingGs) { move(pendingGs); pendingGs=null; }
      });
    });
    s.on('game_started', d => { const gs=d.gameState; if(!myId){pendingGs=gs;return;} move(gs); });
    s.on('game_update', d => { const gs=d.gameState; if(gs && !gs.gameOver) move(gs); });
    s.on('game_over', d => {
      clearTimeout(done);
      report.gamesCompleted++;
      const res = {gameId,gridSize,playerCount,cpuPlayers,cpuDifficulty,winner:d.winner,scores:d.scores};
      report.gameResults.push(res);
      // Score sanity
      const total = Object.values(d.scores||{}).reduce((a,b)=>a+b,0);
      const expected = gridSize*gridSize;
      if (total !== expected) bug('HIGH', `Score ${total} ≠ ${expected} boxes`, res);
      const sym = d.winner===myId?'🏆':d.winner==='draw'?'🤝':'💀';
      console.log(`  ${sym} winner=${d.winner} scores=${JSON.stringify(d.scores)}`);
      s.disconnect(); resolve('done');
    });
    s.on('error', e => err(`Socket: ${e}`, {gameId}));
  });
}

async function runCreator() {
  const configs = [];
  for (const gs of [2,3,4,5])
    for (const pc of [2,3,4])
      for (const diff of ['easy','medium','hard'])
        configs.push({gridSize:gs, playerCount:pc, cpuPlayers:pc-1, cpuDifficulty:diff});
  console.log(`📋 ${configs.length} configs\n`);
  for (const c of configs) {
    console.log(`🎮 ${c.gridSize}x${c.gridSize} ${c.playerCount}P cpu=${c.cpuPlayers} ${c.cpuDifficulty}`);
    await playOneGame(c.gridSize, c.playerCount, c.cpuPlayers, c.cpuDifficulty);
    await sleep(2500); // 2.5s between games to avoid rate limiting
  }
}

async function runChaos() {
  const cases = [
    ['Empty username',   {gridSize:3,username:'',playerCount:2,cpuPlayers:1,cpuDifficulty:'easy'}, false],
    ['Grid size 0',      {gridSize:0,username:'X',playerCount:2,cpuPlayers:1,cpuDifficulty:'easy'}, false],
    ['Grid size 999',    {gridSize:999,username:'X',playerCount:2,cpuPlayers:1,cpuDifficulty:'easy'}, false],
    ['Negative players', {gridSize:3,username:'X',playerCount:-1,cpuPlayers:0,cpuDifficulty:'easy'}, false],
    ['XSS username',     {gridSize:3,username:'<script>alert(1)</script>',playerCount:2,cpuPlayers:1,cpuDifficulty:'easy'}, false],
    ['SQL injection',    {gridSize:3,username:"'; DROP TABLE users;--",playerCount:2,cpuPlayers:1,cpuDifficulty:'easy'}, true],
    ['200-char name',    {gridSize:3,username:'A'.repeat(200),playerCount:2,cpuPlayers:1,cpuDifficulty:'easy'}, false],
    ['5 CPU in 2P',      {gridSize:3,username:'X',playerCount:2,cpuPlayers:5,cpuDifficulty:'easy'}, false],
    ['Bogus difficulty', {gridSize:3,username:'X',playerCount:2,cpuPlayers:1,cpuDifficulty:'godmode'}, false],
    ['String gridSize',  {gridSize:'lol',username:'X',playerCount:2,cpuPlayers:1,cpuDifficulty:'easy'}, false],
    ['Join fake game',   null, false], // special
    ['Bad token move',   null, false], // special
  ];

  for (const [name, payload, mayAccept] of cases) {
    console.log(`🔥 ${name}`);
    const s = io(URL, {transports:['websocket']});
    await new Promise(r => s.on('connect',r).on('connect_error',r));
    
    if (name === 'Join fake game') {
      s.emit('join_game', {gameId:'ZZZZZZ', username:'Chaos'});
      s.on('error', e => obs(`Rejected fake join: ${e}`));
      await sleep(3000);
    } else if (name === 'Bad token move') {
      s.emit('make_move', {gameId:'FAKE',playerId:'player1',sessionToken:'bad',type:'horizontal',r:0,c:0});
      s.on('error', e => obs(`Rejected bad token: ${e}`));
      await sleep(2000);
    } else {
      await new Promise(r => {
        s.emit('create_game', payload, resp => {
          if (resp?.gameId) mayAccept ? obs(`Accepted (ok): ${name}`) : bug('HIGH', `Accepted invalid: ${name}`, {resp});
          else obs(`Rejected: ${name}`);
          r();
        });
        setTimeout(r, 4000);
      });
    }
    s.disconnect();
    await sleep(400);
  }
}

(async () => {
  console.log(`🤖 [${ROLE}] → ${URL}\n`);
  try {
    if (ROLE==='creator') await runCreator();
    else if (ROLE==='chaos') await runChaos();
  } catch(e) { err(`Fatal: ${e.message}`); }
  report.endedAt = new Date().toISOString();
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n📊 Games: ${report.gamesPlayed} played, ${report.gamesCompleted} completed | 🐛 Bugs: ${report.bugs.length} | ❌ Errors: ${report.errors.length}`);
  process.exit(0);
})();
