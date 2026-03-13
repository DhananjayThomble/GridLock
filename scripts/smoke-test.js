#!/usr/bin/env node
/**
 * smoke-test.js — API-level smoke test for GridLock backend
 *
 * Usage: node scripts/smoke-test.js [base_url]
 * Default: https://api.gridlock.pro
 *
 * Tests:
 *   1. WebSocket connect via socket.io-client
 *   2. create_game event → expects game_created callback with gameId
 *   3. Disconnect
 *
 * Exits 0 on success, 1 on failure. Timeout: 10 seconds.
 */

const path = require('path');
const { io } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'socket.io-client'));

const BASE_URL = process.argv[2] || 'https://api.gridlock.pro';
const TIMEOUT_MS = 10000;

function fail(msg) {
  console.error(`❌ SMOKE FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`✅ SMOKE PASS: ${msg}`);
}

(async () => {
  const timer = setTimeout(() => fail('Timed out after 10s'), TIMEOUT_MS);

  let socket;
  try {
    // 1. Connect
    console.log(`Connecting to ${BASE_URL} ...`);
    socket = io(BASE_URL, {
      transports: ['websocket'],
      timeout: 5000,
      forceNew: true,
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', (err) => reject(new Error(`Connection failed: ${err.message}`)));
    });
    pass(`Connected (id: ${socket.id})`);

    // 2. Create game via callback
    console.log('Creating test game ...');
    const payload = {
      username: `smoke_test_${Date.now()}`,
      playerCount: 2,
      gridSize: 3,
      cpuPlayers: 1,
      cpuDifficulty: 'easy',
    };

    const response = await new Promise((resolve, reject) => {
      socket.emit('create_game', payload, (res) => {
        if (res && res.error) return reject(new Error(`Server error: ${res.error}`));
        resolve(res);
      });

      // Fallback: listen for game_created event
      socket.on('game_created', (data) => resolve(data));

      setTimeout(() => reject(new Error('No response to create_game within 5s')), 5000);
    });

    if (!response || !response.gameId) {
      fail(`create_game response missing gameId: ${JSON.stringify(response)}`);
    }
    pass(`Game created (gameId: ${response.gameId})`);

    // 3. Disconnect
    socket.disconnect();
    pass('Disconnected cleanly');

    clearTimeout(timer);
    console.log('\n✅ ALL SMOKE TESTS PASSED');
    process.exit(0);
  } catch (err) {
    clearTimeout(timer);
    if (socket) socket.disconnect();
    fail(err.message);
  }
})();
