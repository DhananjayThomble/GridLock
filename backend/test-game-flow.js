// test-game-flow.js - Automated integration test
const io = require('socket.io-client');

// Connect through nginx proxy like real clients do
const SERVER_URL = 'http://13.205.40.30';
let player1Socket, player2Socket;
let gameId;

console.log('\n🧪 GridLock Automated Test Starting...\n');
console.log('Connecting to:', SERVER_URL);

// Test helper with timeout
function waitForEvent(socket, eventName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout waiting for ${eventName}`));
        }, timeoutMs);
        
        socket.once(eventName, (data) => {
            clearTimeout(timeout);
            resolve(data);
        });
    });
}

// Test 1: Player 1 creates a game
async function testCreateGame() {
    console.log('📝 Test 1: Creating game as Player 1...');
    
    player1Socket = io(SERVER_URL, {
        transports: ['websocket', 'polling']
    });
    
    // Wait for connection
    await waitForEvent(player1Socket, 'connect', 3000);
    console.log('  ✅ Player 1 connected:', player1Socket.id);
    
    // Create game
    player1Socket.emit('create_game', { gridSize: 3, username: 'TestBot1' });
    
    // Wait for game_started event (player 1 gets initial state)
    const data = await waitForEvent(player1Socket, 'game_started', 5000);
    
    gameId = data.gameId;
    console.log('  ✅ Game created:', gameId);
    console.log('  ✅ Player 1 received initial state');
    console.log('     - Player 1:', data.gameState.player1Name);
    console.log('     - Player 2:', data.gameState.player2Name);
    
    if (data.gameState.player1Name !== 'TestBot1') {
        throw new Error('Player 1 name mismatch');
    }
}

// Test 2: Player 2 joins the game
async function testPlayer2Join() {
    console.log('\n📝 Test 2: Player 2 joining game', gameId);
    
    player2Socket = io(SERVER_URL, {
        transports: ['websocket', 'polling']
    });
    
    // Wait for connection
    await waitForEvent(player2Socket, 'connect', 3000);
    console.log('  ✅ Player 2 connected:', player2Socket.id);
    
    // Join game
    player2Socket.emit('join_game', { gameId, username: 'TestBot2' });
    
    // Both players should receive game_started
    const [p1Data, p2Data] = await Promise.all([
        waitForEvent(player1Socket, 'game_started', 5000),
        waitForEvent(player2Socket, 'game_started', 5000)
    ]);
    
    console.log('  ✅ Player 1 received game_started with both players:');
    console.log('     -', p1Data.gameState.player1Name, 'vs', p1Data.gameState.player2Name);
    
    console.log('  ✅ Player 2 received game_started:');
    console.log('     -', p2Data.gameState.player1Name, 'vs', p2Data.gameState.player2Name);
    
    if (p1Data.gameState.player2Name !== 'TestBot2' || p2Data.gameState.player2Name !== 'TestBot2') {
        throw new Error('Player 2 name not updated correctly');
    }
}

// Test 3: Make a move
async function testMakeMove() {
    console.log('\n📝 Test 3: Player 1 making a move...');
    
    player1Socket.emit('make_move', {
        gameId,
        playerId: 'player1',
        type: 'horizontal',
        r: 0,
        c: 0
    });
    
    // Both players should receive game_update
    const [p1Update, p2Update] = await Promise.all([
        waitForEvent(player1Socket, 'game_update', 5000),
        waitForEvent(player2Socket, 'game_update', 5000)
    ]);
    
    console.log('  ✅ Both players received game_update');
    console.log('     - Current turn:', p1Update.gameState.currentPlayer);
    console.log('     - Line claimed by player1');
    
    if (!p1Update.gameState.horizontalLines[0][0]) {
        throw new Error('Move not applied correctly');
    }
}

// Test 4: Invalid move (not player's turn)
async function testInvalidMove() {
    console.log('\n📝 Test 4: Testing invalid move (player 1 playing twice)...');
    
    player1Socket.emit('make_move', {
        gameId,
        playerId: 'player1',
        type: 'horizontal',
        r: 0,
        c: 1
    });
    
    // Should receive error
    const error = await waitForEvent(player1Socket, 'error', 3000);
    console.log('  ✅ Error received correctly:', error);
}

// Main test runner
async function runTests() {
    try {
        await testCreateGame();
        await testPlayer2Join();
        await testMakeMove();
        await testInvalidMove();
        
        console.log('\n✨ All tests passed! ✨\n');
        console.log('Game ID tested:', gameId);
        console.log('\nTest Summary:');
        console.log('  ✓ Game creation');
        console.log('  ✓ Player 2 join');
        console.log('  ✓ Both players receive updates');
        console.log('  ✓ Move validation');
        console.log('  ✓ Turn validation');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('\nStack:', error.stack);
        process.exit(1);
    } finally {
        if (player1Socket) player1Socket.disconnect();
        if (player2Socket) player2Socket.disconnect();
    }
}

runTests();
