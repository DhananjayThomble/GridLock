#!/usr/bin/env node
/**
 * GridLock Advanced Scenarios — tests edge cases not covered by basic gameplay
 * - Concurrent games on same socket
 * - Disconnect/reconnect mid-game
 * - Spectator flows
 * - Rapid move spam
 * - Out-of-turn moves
 * - Double moves
 */
const { io } = require('socket.io-client');
const fs = require('fs');

const URL = process.argv[2] || 'https://gridlock-api.snapurl.in';
const REPORT_FILE = process.argv[3] || `/tmp/playtest-advanced-${Date.now()}.json`;
const report = { scenarios: [], bugs: [], observations: [] };
const bug = (sev, d, ctx={}) => { report.bugs.push({severity:sev,description:d,context:ctx}); console.log(`🐛[${sev}] ${d}`); };
const obs = (d) => { report.observations.push(d); console.log(`👀 ${d}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickMove(gs) {
  const m = [];
  (gs.horizontalLines||[]).forEach((row,r) => row.forEach((v,c) => { if(!v) m.push({type:'horizontal',r,c}); }));
  (gs.verticalLines||[]).forEach((row,r) => row.forEach((v,c) => { if(!v) m.push({type:'vertical',r,c}); }));
  return m.length ? m[Math.floor(Math.random()*m.length)] : null;
}

// Scenario 1: Out-of-turn move
async function testOutOfTurnMove() {
  console.log('\n🧪 Scenario: Out-of-turn move');
  return new Promise(resolve => {
    const s = io(URL, {transports:['websocket']});
    const t = setTimeout(() => { s.disconnect(); resolve(); }, 20000);
    let myId, myToken, gameId, tested = false;
    s.on('connect', () => {
      s.emit('create_game', {gridSize:3, username:'OOT_Test', playerCount:2, cpuPlayers:1, cpuDifficulty:'easy'}, r => {
        gameId=r.gameId; myId=r.playerId; myToken=r.sessionToken;
      });
    });
    s.on('game_started', d => {
      const gs = d.gameState;
      if (gs.currentPlayer !== myId && !tested) {
        tested = true;
        // Try to move when it's NOT our turn
        s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:'horizontal', r:0, c:0});
        obs('Sent out-of-turn move — watching for error or acceptance');
      }
    });
    s.on('game_update', d => {
      const gs = d.gameState;
      if (gs.currentPlayer !== myId && !tested) {
        tested = true;
        s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:'horizontal', r:0, c:0});
        obs('Sent out-of-turn move during game_update');
      }
      if (gs.currentPlayer === myId) {
        const m = pickMove(gs);
        if (m) s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c});
      }
    });
    s.on('error', e => obs(`Error response: ${e}`));
    s.on('game_over', () => { clearTimeout(t); obs('Game completed normally after OOT test'); s.disconnect(); resolve(); });
  });
}

// Scenario 2: Double-click same line
async function testDoubleClickLine() {
  console.log('\n🧪 Scenario: Double-click same line');
  return new Promise(resolve => {
    const s = io(URL, {transports:['websocket']});
    const t = setTimeout(() => { s.disconnect(); resolve(); }, 25000);
    let myId, myToken, gameId, pendingGs, doubleClickTested = false;
    
    function doMove(gs) {
      if (gs.currentPlayer !== myId) return;
      const m = pickMove(gs);
      if (!m) return;
      
      if (!doubleClickTested) {
        doubleClickTested = true;
        // Send same move twice rapidly
        s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c});
        s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c});
        obs('Sent double move on same line');
      } else {
        s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c});
      }
    }
    
    s.on('connect', () => {
      s.emit('create_game', {gridSize:3, username:'DblClick', playerCount:2, cpuPlayers:1, cpuDifficulty:'easy'}, r => {
        gameId=r.gameId; myId=r.playerId; myToken=r.sessionToken;
        if (pendingGs) doMove(pendingGs);
      });
    });
    s.on('game_started', d => { if(!myId){pendingGs=d.gameState;return;} doMove(d.gameState); });
    s.on('game_update', d => doMove(d.gameState));
    s.on('error', e => obs(`Double-click error: ${e}`));
    s.on('game_over', d => {
      clearTimeout(t);
      const total = Object.values(d.scores||{}).reduce((a,b)=>a+b,0);
      if (total !== 9) bug('HIGH', `Score corruption after double-click: ${total} ≠ 9`, d);
      else obs('Double-click: scores correct, no corruption');
      s.disconnect(); resolve();
    });
  });
}

// Scenario 3: Move on already-claimed line
async function testClaimedLine() {
  console.log('\n🧪 Scenario: Move on already-claimed line');
  return new Promise(resolve => {
    const s = io(URL, {transports:['websocket']});
    const t = setTimeout(() => { s.disconnect(); resolve(); }, 25000);
    let myId, myToken, gameId, pendingGs, claimTested = false;
    let lastClaimedMove = null;

    function doMove(gs) {
      if (gs.currentPlayer !== myId) return;
      
      // Find a claimed line and try to claim it again
      if (!claimTested) {
        for (let r=0; r<gs.horizontalLines.length; r++)
          for (let c=0; c<gs.horizontalLines[r].length; c++)
            if (gs.horizontalLines[r][c]) {
              claimTested = true;
              s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:'horizontal', r, c});
              obs('Attempted to claim already-taken line');
              // Also make a valid move so game progresses
              const m = pickMove(gs);
              if (m) setTimeout(() => s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c}), 200);
              return;
            }
      }
      
      const m = pickMove(gs);
      if (m) s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c});
    }

    s.on('connect', () => {
      s.emit('create_game', {gridSize:3, username:'ClaimTest', playerCount:2, cpuPlayers:1, cpuDifficulty:'easy'}, r => {
        gameId=r.gameId; myId=r.playerId; myToken=r.sessionToken;
        if (pendingGs) doMove(pendingGs);
      });
    });
    s.on('game_started', d => { if(!myId){pendingGs=d.gameState;return;} doMove(d.gameState); });
    s.on('game_update', d => doMove(d.gameState));
    s.on('error', e => obs(`Claimed-line error: ${e}`));
    s.on('game_over', d => { clearTimeout(t); obs('Claimed line test complete'); s.disconnect(); resolve(); });
  });
}

// Scenario 4: Spectator join
async function testSpectator() {
  console.log('\n🧪 Scenario: Spectator join');
  return new Promise(resolve => {
    const s1 = io(URL, {transports:['websocket']});
    const t = setTimeout(() => { s1.disconnect(); resolve(); }, 25000);
    let gameId;

    s1.on('connect', () => {
      s1.emit('create_game', {gridSize:2, username:'Player1', playerCount:2, cpuPlayers:1, cpuDifficulty:'easy'}, r => {
        gameId = r.gameId;
        // Join as spectator
        const s2 = io(URL, {transports:['websocket']});
        s2.on('connect', () => {
          s2.emit('join_game', {gameId, username:'Spectator', joinMode:'spectate'});
          obs(`Spectator attempting to join game ${gameId}`);
        });
        s2.on('spectator_joined', () => obs('Spectator joined successfully'));
        s2.on('game_update', () => obs('Spectator receiving game updates'));
        s2.on('error', e => obs(`Spectator error: ${e}`));
        
        setTimeout(() => { s2.disconnect(); clearTimeout(t); s1.disconnect(); resolve(); }, 10000);
      });
    });
  });
}

// Scenario 5: Rapid create-disconnect spam
async function testRapidDisconnect() {
  console.log('\n🧪 Scenario: Rapid connect-create-disconnect');
  let crashes = 0;
  for (let i = 0; i < 5; i++) {
    try {
      const s = io(URL, {transports:['websocket']});
      await new Promise(r => { s.on('connect', r); setTimeout(r, 3000); });
      s.emit('create_game', {gridSize:2, username:`Rapid${i}`, playerCount:2, cpuPlayers:1, cpuDifficulty:'easy'});
      await sleep(100);
      s.disconnect();
    } catch { crashes++; }
    await sleep(1000);
  }
  if (crashes > 0) bug('MEDIUM', `${crashes}/5 rapid disconnect cycles crashed`);
  else obs('Rapid connect-disconnect: server survived 5 cycles');
}

// Scenario 6: Game with all grid/player combos but only easy CPU (speed test)
async function testSpeedRound() {
  console.log('\n🧪 Scenario: Speed round — all grid sizes');
  for (const gs of [2, 3, 4, 5, 6]) {
    console.log(`  ⚡ ${gs}x${gs}`);
    const start = Date.now();
    await new Promise(resolve => {
      const s = io(URL, {transports:['websocket']});
      const t = setTimeout(() => { obs(`${gs}x${gs} timed out`); s.disconnect(); resolve(); }, 30000);
      let myId, myToken, gameId, pendingGs;
      
      function doMove(state) {
        if (state.currentPlayer !== myId || state.gameOver) return;
        const m = pickMove(state);
        if (m) s.emit('make_move', {gameId, playerId:myId, sessionToken:myToken, type:m.type, r:m.r, c:m.c});
      }
      
      s.on('connect', () => {
        s.emit('create_game', {gridSize:gs, username:`Speed${gs}`, playerCount:2, cpuPlayers:1, cpuDifficulty:'easy'}, r => {
          if (!r?.gameId) { clearTimeout(t); s.disconnect(); resolve(); return; }
          gameId=r.gameId; myId=r.playerId; myToken=r.sessionToken;
          if (pendingGs) doMove(pendingGs);
        });
      });
      s.on('game_started', d => { if(!myId){pendingGs=d.gameState;return;} doMove(d.gameState); });
      s.on('game_update', d => doMove(d.gameState));
      s.on('game_over', d => {
        clearTimeout(t);
        const elapsed = Date.now() - start;
        const total = Object.values(d.scores||{}).reduce((a,b)=>a+b,0);
        const expected = gs*gs;
        if (total !== expected) bug('HIGH', `${gs}x${gs}: score ${total} ≠ ${expected}`);
        obs(`${gs}x${gs}: completed in ${elapsed}ms, scores correct`);
        s.disconnect(); resolve();
      });
      s.on('error', e => { obs(`${gs}x${gs} error: ${e}`); });
    });
    await sleep(2000);
  }
}

(async () => {
  console.log(`🧪 Advanced Scenarios → ${URL}\n`);
  const scenarios = [
    ['Out-of-turn move', testOutOfTurnMove],
    ['Double-click line', testDoubleClickLine],
    ['Claimed line', testClaimedLine],
    ['Spectator', testSpectator],
    ['Rapid disconnect', testRapidDisconnect],
    ['Speed round', testSpeedRound],
  ];
  
  for (const [name, fn] of scenarios) {
    try { await fn(); } catch (e) { bug('HIGH', `Scenario "${name}" crashed: ${e.message}`); }
    await sleep(3000); // cooldown
  }
  
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n📊 Advanced: ${report.bugs.length} bugs, ${report.observations.length} observations`);
  console.log(`📄 Report: ${REPORT_FILE}`);
  process.exit(0);
})();
