// src/components/Lobby.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

console.log('Initializing socket connection...');
const socket = io({
    path: '/socket.io/', // Explicit path
    transports: ['websocket', 'polling'] // Force transports
});

const Lobby = () => {
    const [username, setUsername] = useState('');
    const [gridSize, setGridSize] = useState(3);
    const [gameId, setGameId] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
        });

        socket.on('connect_error', (err) => {
            console.error('Socket connection error:', err);
        });

        socket.on('game_created', ({ gameId, playerId }) => {
            console.log('Game created event received:', gameId);
            navigate('/game', { state: { username, gridSize, gameId, role: playerId } });
        });

        return () => {
            socket.off('connect');
            socket.off('connect_error');
            socket.off('game_created');
        };
    }, [navigate, username, gridSize]); // Add dependencies

    const handleCreateGame = () => {
        console.log('Create Game clicked. Username:', username, 'GridSize:', gridSize);
        if (!username) return alert('Please enter a username');
        
        if (!socket.connected) {
            console.error('Socket is not connected. Attempting to reconnect...');
            socket.connect();
        }

        console.log('Emitting create_game with ack...');
        socket.emit('create_game', { gridSize, username }, (response) => {
            console.log('Server Ack received:', response);
            if (response && response.gameId) {
                navigate('/game', { state: { username, gridSize, gameId: response.gameId, role: response.playerId } });
            }
        });
    };

    const handleJoinGame = () => {
        console.log('Join Game clicked. GameID:', gameId);
        if (!username || !gameId) return alert('Please enter username and Game ID');
        
        // We handle navigation in Board.jsx or here? 
        // Previously navigation happened immediately. 
        // Let's keep it consistent: Navigate immediately, Board handles 'join_game' emit/verification
        // OR wait for confirmation?
        // Let's navigate immediately for now as per previous logic
        navigate('/game', { state: { username, gameId, role: 'player2' } });
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-8">
            <h1 className="text-4xl font-bold mb-8 text-blue-600">Dots and Boxes</h1>
            
            <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2">Username</label>
                    <input 
                        type="text" 
                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" 
                        value={username} 
                        onChange={(e) => setUsername(e.target.value)} 
                        placeholder="Enter your name"
                    />
                </div>

                <div className="flex space-x-4 mb-6">
                    <button 
                        onClick={handleCreateGame}
                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-1/2"
                    >
                        Create Game
                    </button>
                    <div className="w-1/2">
                        <select 
                            className="shadow border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline h-full"
                            value={gridSize}
                            onChange={(e) => setGridSize(parseInt(e.target.value))}
                        >
                            <option value={3}>3x3 Grid</option>
                            <option value={4}>4x4 Grid</option>
                            <option value={5}>5x5 Grid</option>
                        </select>
                    </div>
                </div>

                <div className="border-t border-gray-200 my-6"></div>

                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2">Join Existing Game</label>
                    <input 
                        type="text" 
                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline mb-4" 
                        value={gameId} 
                        onChange={(e) => setGameId(e.target.value)} 
                        placeholder="Enter Game ID"
                    />
                    <button 
                        onClick={handleJoinGame}
                        className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full"
                    >
                        Join Game
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Lobby;
