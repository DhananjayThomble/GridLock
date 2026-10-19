// test-5x5-grid.js - Test 5x5 grid
const io = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
let player1Socket;

console.log('\n🧪 Testing 5×5 Grid...\n');

async function test5x5Grid() {
    return new Promise((resolve, reject) => {
        player1Socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
        
        player1Socket.on('connect', () => {
            console.log('✅ Connected:', player1Socket.id);
            
            // Create 5x5 game
            player1Socket.emit('create_game', { gridSize: 5, username: 'Test5x5' });
        });
        
        player1Socket.on('game_started', (data) => {
            console.log('✅ 5×5 Game created:', data.gameId);
            console.log('  Grid size:', data.gridSize);
            console.log('  Horizontal lines:', data.gameState.horizontalLines.length, 'rows');
            console.log('  Vertical lines:', data.gameState.verticalLines.length, 'rows');
            console.log('  Boxes:', data.gameState.boxes.length, 'rows');
            
            if (data.gridSize === 5 && 
                data.gameState.horizontalLines.length === 6 && 
                data.gameState.verticalLines.length === 5 &&
                data.gameState.boxes.length === 5) {
                console.log('\n✨ 5×5 grid test passed!\n');
                resolve();
            } else {
                reject(new Error('Grid dimensions incorrect'));
            }
        });
        
        player1Socket.on('error', (err) => {
            reject(new Error('Socket error: ' + err));
        });
        
        setTimeout(() => reject(new Error('Timeout')), 5000);
    });
}

test5x5Grid()
    .then(() => {
        if (player1Socket) player1Socket.disconnect();
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Test failed:', err.message);
        if (player1Socket) player1Socket.disconnect();
        process.exit(1);
    });
