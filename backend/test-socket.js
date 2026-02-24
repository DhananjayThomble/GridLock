// test-socket.js - Automated backend test
const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:5000';
let player1Socket, player2Socket;
let gameId;

console.log('\n🧪 Starting GridLock Backend Tests...\n');

// Test 1: Player 1 creates a game
function testCreateGame() {
    return new Promise((resolve, reject) => {
        console.log('📝 Test 1: Player 1 creates a game');
        
        player1Socket = io(SERVER_URL);
        
        player1Socket.on('connect', () => {
            console.log('  ✅ Player 1 connected:', player1Socket.id);
            
            player1Socket.emit('create_game', { gridSize: 3, username: 'TestPlayer1' }, (response) => {
                if (response && response.gameId) {
                    gameId = response.gameId;
                    console.log('  ✅ Game created:', gameId);
                } else {
                    reject('No game ID in callback');
                }
            });
        });
        
        player1Socket.on('game_started', (data) => {
            console.log('  ✅ Player 1 received game_started:', {
                player1Name: data.gameState.player1Name,
                player2Name: data.gameState.player2Name
            });
            
            if (data.gameState.player1Name === 'TestPlayer1') {
                resolve();
            } else {
                reject('Player 1 name mismatch');
            }
        });
        
        player1Socket.on('error', (err) => {
            reject('Socket error: ' + err);
        });
    });
}

// Test 2: Player 1 re-joins after navigation (simulating frontend navigation)
function testPlayer1Rejoin() {
    return new Promise((resolve, reject) => {
        console.log('\n📝 Test 2: Player 1 re-joins game after navigation');
        
        player1Socket.emit('join_game', { gameId, username: 'TestPlayer1' });
        
        let received = false;
        player1Socket.once('game_started', (data) => {
            if (!received) {
                received = true;
                console.log('  ✅ Player 1 rejoined successfully');
                resolve();
            }
        });
        
        setTimeout(() => {
            if (!received) reject('Player 1 rejoin timeout');
        }, 2000);
    });
}

// Test 3: Player 2 joins the game
function testPlayer2Join() {
    return new Promise((resolve, reject) => {
        console.log('\n📝 Test 3: Player 2 joins the game');
        
        player2Socket = io(SERVER_URL);
        
        player2Socket.on('connect', () => {
            console.log('  ✅ Player 2 connected:', player2Socket.id);
            player2Socket.emit('join_game', { gameId, username: 'TestPlayer2' });
        });
        
        let player1Received = false;
        let player2Received = false;
        
        player1Socket.once('game_started', (data) => {
            console.log('  ✅ Player 1 received game_started with both players:', {
                player1: data.gameState.player1Name,
                player2: data.gameState.player2Name
            });
            player1Received = true;
            if (player1Received && player2Received) resolve();
        });
        
        player2Socket.once('game_started', (data) => {
            console.log('  ✅ Player 2 received game_started:', {
                player1: data.gameState.player1Name,
                player2: data.gameState.player2Name
            });
            player2Received = true;
            if (player1Received && player2Received) resolve();
        });
        
        setTimeout(() => {
            if (!player1Received || !player2Received) {
                reject(`Timeout: P1 received: ${player1Received}, P2 received: ${player2Received}`);
            }
        }, 3000);
    });
}

// Test 4: Make a move
function testMakeMove() {
    return new Promise((resolve, reject) => {
        console.log('\n📝 Test 4: Player 1 makes a move');
        
        player1Socket.emit('make_move', {
            gameId,
            playerId: 'player1',
            type: 'horizontal',
            r: 0,
            c: 0
        });
        
        let receivedCount = 0;
        
        const onUpdate = (data) => {
            receivedCount++;
            console.log(`  ✅ Move update received by ${receivedCount === 1 ? 'player 1' : 'player 2'}`);
            
            if (receivedCount === 2) {
                player1Socket.off('game_update', onUpdate);
                player2Socket.off('game_update', onUpdate);
                resolve();
            }
        };
        
        player1Socket.on('game_update', onUpdate);
        player2Socket.on('game_update', onUpdate);
        
        setTimeout(() => {
            if (receivedCount < 2) reject(`Only ${receivedCount}/2 players received update`);
        }, 2000);
    });
}

// Run all tests
async function runTests() {
    try {
        await testCreateGame();
        await testPlayer1Rejoin();
        await testPlayer2Join();
        await testMakeMove();
        
        console.log('\n✨ All tests passed! ✨\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    } finally {
        if (player1Socket) player1Socket.disconnect();
        if (player2Socket) player2Socket.disconnect();
    }
}

runTests();
