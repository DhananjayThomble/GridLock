// test-4player-logic.js - Unit tests for 4-player game logic
const { initializeGameState, calculateNewState, getNextPlayer, calculateWinner } = require('./utils/gameLogic');

console.log('🧪 Testing 4-Player Game Logic\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`✅ ${message}`);
        testsPassed++;
    } else {
        console.error(`❌ ${message}`);
        testsFailed++;
    }
}

// Test 1: Initialize 2-player game
console.log('Test 1: Initialize 2-player game');
const game2p = initializeGameState(3, 2);
assert(game2p.playerCount === 2, 'Player count is 2');
assert(game2p.players.length === 2, 'Has 2 players');
assert(game2p.players[0] === 'player1', 'First player is player1');
assert(game2p.players[1] === 'player2', 'Second player is player2');
assert(game2p.scores.player1 === 0, 'Player 1 score is 0');
assert(game2p.scores.player2 === 0, 'Player 2 score is 0');
console.log('');

// Test 2: Initialize 4-player game
console.log('Test 2: Initialize 4-player game');
const game4p = initializeGameState(5, 4);
assert(game4p.playerCount === 4, 'Player count is 4');
assert(game4p.players.length === 4, 'Has 4 players');
assert(game4p.players[0] === 'player1', 'First player is player1');
assert(game4p.players[3] === 'player4', 'Fourth player is player4');
assert(game4p.scores.player1 === 0, 'Player 1 score is 0');
assert(game4p.scores.player4 === 0, 'Player 4 score is 0');
console.log('');

// Test 3: Turn rotation (2 players)
console.log('Test 3: Turn rotation (2 players)');
let state2p = initializeGameState(3, 2);
// Player 1 makes move (doesn't complete box)
state2p = calculateNewState(state2p, 3, 0, 0, 'horizontal');
assert(state2p.currentPlayer === 'player2', 'Turn switches to player2');
// Player 2 makes move
state2p = calculateNewState(state2p, 3, 0, 1, 'horizontal');
assert(state2p.currentPlayer === 'player1', 'Turn switches back to player1');
console.log('');

// Test 4: Turn rotation (4 players)
console.log('Test 4: Turn rotation (4 players)');
let state4p = initializeGameState(3, 4);
assert(state4p.currentPlayer === 'player1', 'Starts with player1');
state4p = calculateNewState(state4p, 3, 0, 0, 'horizontal');
assert(state4p.currentPlayer === 'player2', 'Switches to player2');
state4p = calculateNewState(state4p, 3, 0, 1, 'horizontal');
assert(state4p.currentPlayer === 'player3', 'Switches to player3');
state4p = calculateNewState(state4p, 3, 0, 2, 'horizontal');
assert(state4p.currentPlayer === 'player4', 'Switches to player4');
state4p = calculateNewState(state4p, 3, 1, 0, 'horizontal');
assert(state4p.currentPlayer === 'player1', 'Wraps back to player1');
console.log('');

// Test 5: Box completion and extra turn
console.log('Test 5: Box completion and extra turn (4 players)');
let stateBox = initializeGameState(2, 4);
// Complete a box: draw 4 sides
stateBox.horizontalLines[0][0] = 'player1';
stateBox.verticalLines[0][0] = 'player1';
stateBox.verticalLines[0][1] = 'player1';
// Player 1 completes the box with final line
stateBox = calculateNewState(stateBox, 2, 1, 0, 'horizontal');
assert(stateBox.scores.player1 === 1, 'Player 1 scored a box');
assert(stateBox.currentPlayer === 'player1', 'Player 1 gets another turn');
console.log('');

// Test 6: Winner determination (4 players)
console.log('Test 6: Winner determination (4 players)');
const players4 = ['player1', 'player2', 'player3', 'player4'];
const scores1 = { player1: 3, player2: 2, player3: 1, player4: 0 };
const winner1 = calculateWinner(scores1, 2, 3, players4); // 2x3 = 6 boxes total
assert(winner1 === 'player1', 'Player 1 wins with highest score');

const scores2 = { player1: 2, player2: 2, player3: 1, player4: 1 };
const winner2 = calculateWinner(scores2, 2, 3, players4);
assert(winner2 === 'draw', 'Draw when multiple players tie for highest');
console.log('');

// Test 7: Next player calculation
console.log('Test 7: Next player calculation');
const players = ['player1', 'player2', 'player3', 'player4'];
assert(getNextPlayer('player1', players) === 'player2', 'player1 → player2');
assert(getNextPlayer('player2', players) === 'player3', 'player2 → player3');
assert(getNextPlayer('player3', players) === 'player4', 'player3 → player4');
assert(getNextPlayer('player4', players) === 'player1', 'player4 → player1 (wraps)');
console.log('');

// Test 8: Error handling - invalid grid size
console.log('Test 8: Error handling');
try {
    initializeGameState(15, 2); // Too large
    assert(false, 'Should throw error for grid > 10');
} catch (error) {
    assert(error.message.includes('Grid size'), 'Throws error for invalid grid');
}

try {
    initializeGameState(3, 5); // Too many players
    assert(false, 'Should throw error for > 4 players');
} catch (error) {
    assert(error.message.includes('Player count'), 'Throws error for invalid player count');
}
console.log('');

// Test 9: Complete game simulation (3 players)
console.log('Test 9: Complete 2x2 game with 3 players');
let sim = initializeGameState(2, 3);
// Fill all boxes systematically
sim = calculateNewState(sim, 2, 0, 0, 'horizontal'); // P1
sim = calculateNewState(sim, 2, 0, 1, 'horizontal'); // P2
sim = calculateNewState(sim, 2, 1, 0, 'horizontal'); // P3
sim = calculateNewState(sim, 2, 1, 1, 'horizontal'); // P1
sim = calculateNewState(sim, 2, 2, 0, 'horizontal'); // P2
sim = calculateNewState(sim, 2, 2, 1, 'horizontal'); // P3
sim = calculateNewState(sim, 2, 0, 0, 'vertical');   // P1
sim = calculateNewState(sim, 2, 0, 1, 'vertical');   // P2
sim = calculateNewState(sim, 2, 0, 2, 'vertical');   // P3
sim = calculateNewState(sim, 2, 1, 0, 'vertical');   // P1
sim = calculateNewState(sim, 2, 1, 1, 'vertical');   // P2 - completes box!
assert(sim.scores.player2 > 0, 'Player completed a box');
assert(sim.currentPlayer === 'player2', 'Player gets extra turn after box');
console.log('');

// Summary
console.log('═══════════════════════════════════');
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
if (testsFailed === 0) {
    console.log('🎉 All tests passed!');
} else {
    console.log('⚠️  Some tests failed!');
    process.exit(1);
}
