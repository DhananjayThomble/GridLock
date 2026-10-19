// test-avatars.js - Test avatar feature
const io = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
let player1Socket, player2Socket;

console.log('\n🎨 Testing Avatar Feature...\n');

async function testAvatars() {
    return new Promise((resolve, reject) => {
        player1Socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
        
        player1Socket.on('connect', () => {
            console.log('✅ Player 1 connected');
            player1Socket.emit('create_game', { gridSize: 3, username: 'Raj', avatar: '🦁' });
        });
        
        player1Socket.on('game_started', (data) => {
            if (!player2Socket) {
                console.log('✅ Game created with avatar:');
                console.log('  Player 1:', data.gameState.player1Avatar, data.gameState.player1Name);
                console.log('  Player 2:', data.gameState.player2Avatar, data.gameState.player2Name);
                
                // Now join as player 2
                player2Socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
                player2Socket.on('connect', () => {
                    console.log('\n✅ Player 2 connected');
                    player2Socket.emit('join_game', { gameId: data.gameId, username: 'Priya', avatar: '🐼' });
                });
                
                player2Socket.on('game_started', (p2Data) => {
                    console.log('\n✅ Both players joined with avatars:');
                    console.log('  Player 1:', p2Data.gameState.player1Avatar, p2Data.gameState.player1Name);
                    console.log('  Player 2:', p2Data.gameState.player2Avatar, p2Data.gameState.player2Name);
                    
                    if (p2Data.gameState.player1Avatar === '🦁' && 
                        p2Data.gameState.player2Avatar === '🐼') {
                        console.log('\n✨ Avatar test passed! ✨\n');
                        resolve();
                    } else {
                        reject(new Error('Avatars not matching'));
                    }
                });
            }
        });
        
        player1Socket.on('error', (err) => reject(new Error('Socket error: ' + err)));
        setTimeout(() => reject(new Error('Timeout')), 10000);
    });
}

testAvatars()
    .then(() => {
        if (player1Socket) player1Socket.disconnect();
        if (player2Socket) player2Socket.disconnect();
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Test failed:', err.message);
        if (player1Socket) player1Socket.disconnect();
        if (player2Socket) player2Socket.disconnect();
        process.exit(1);
    });
