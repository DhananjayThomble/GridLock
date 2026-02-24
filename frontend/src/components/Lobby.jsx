// src/components/Lobby.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';

console.log('Lobby using shared socket connection');

const Lobby = () => {
    const [username, setUsername] = useState('');
    const [gridSize, setGridSize] = useState(3);
    const [gameId, setGameId] = useState('');
    const [selectedAvatar, setSelectedAvatar] = useState('👦');
    const navigate = useNavigate();

    // Available avatars - more interesting and diverse
    const avatars = ['👦', '👧', '🤖', '🐱', '🐶', '🦊', '🐻', '🐼', '🦁', '🐯', '🚀', '⚽'];

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
        console.log('Create Game clicked. Username:', username, 'GridSize:', gridSize, 'Avatar:', selectedAvatar);
        if (!username) return alert('Please enter a username');
        
        if (!socket.connected) {
            console.error('Socket is not connected. Attempting to reconnect...');
            socket.connect();
        }

        console.log('Emitting create_game with ack...');
        socket.emit('create_game', { gridSize, username, avatar: selectedAvatar }, (response) => {
            console.log('Server Ack received:', response);
            if (response && response.gameId) {
                navigate('/game', { state: { username, gridSize, gameId: response.gameId, role: response.playerId, avatar: selectedAvatar } });
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
        navigate('/game', { state: { username, gameId, role: 'player2', avatar: selectedAvatar } });
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <div className="w-full max-w-md">
                <h1 className="text-3xl font-bold mb-4 text-blue-600 text-center">Dots and Boxes</h1>
                
                <div className="bg-white p-4 rounded-lg shadow-lg">
                    <div className="mb-3">
                        <label className="block text-gray-700 text-xs font-bold mb-1">Username</label>
                        <input 
                            type="text" 
                            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 text-sm leading-tight focus:outline-none focus:shadow-outline" 
                            value={username} 
                            onChange={(e) => setUsername(e.target.value)} 
                            placeholder="Enter your name"
                        />
                    </div>

                    {/* Avatar Selection */}
                    <div className="mb-3">
                        <label className="block text-gray-700 text-xs font-bold mb-1">Choose Your Avatar</label>
                        <div className="grid grid-cols-6 gap-1.5">
                            {avatars.map((avatar) => (
                                <button
                                    key={avatar}
                                    onClick={() => setSelectedAvatar(avatar)}
                                    className={`text-lg p-1.5 rounded-lg transition-colors flex items-center justify-center aspect-square ${
                                        selectedAvatar === avatar 
                                            ? 'bg-blue-500 shadow-lg ring-2 ring-blue-600' 
                                            : 'bg-gray-100 hover:bg-gray-200'
                                    }`}
                                >
                                    {avatar}
                                </button>
                            ))}
                        </div>
                        <p className="text-center mt-2 text-xs text-gray-600">
                            Selected: <span className="text-base">{selectedAvatar}</span> {username || 'Player'}
                        </p>
                    </div>

                    <div className="flex space-x-2 mb-3">
                        <button 
                            onClick={handleCreateGame}
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded focus:outline-none focus:shadow-outline w-1/2 text-sm"
                        >
                            Create Game
                        </button>
                        <div className="w-1/2">
                            <select 
                                className="shadow border rounded w-full py-2 px-2 text-gray-700 leading-tight focus:outline-none focus:shadow-outline h-full text-sm"
                                value={gridSize}
                                onChange={(e) => setGridSize(parseInt(e.target.value))}
                            >
                                <option value={3}>3x3 Grid</option>
                                <option value={4}>4x4 Grid</option>
                                <option value={5}>5x5 Grid</option>
                            </select>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 my-3"></div>

                    <div className="mb-3">
                        <label className="block text-gray-700 text-xs font-bold mb-1">Join Existing Game</label>
                        <input 
                            type="text" 
                            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 text-sm leading-tight focus:outline-none focus:shadow-outline mb-2" 
                            value={gameId} 
                            onChange={(e) => setGameId(e.target.value)} 
                            placeholder="Enter Game ID"
                        />
                        <button 
                            onClick={handleJoinGame}
                            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-3 rounded focus:outline-none focus:shadow-outline w-full text-sm"
                        >
                            Join Game
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Lobby;
