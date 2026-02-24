// src/components/Board.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import socket from '../socket';

console.log('Board using shared socket connection');

const Board = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { username, role, gameId, gridSize } = location.state || {}; 

    const [gameState, setGameState] = useState(null);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState('Connecting...');

    useEffect(() => {
        if (!gameId || !username) {
            navigate('/');
            return;
        }

        // Setup listeners
        const onGameUpdate = (data) => {
            console.log('Game update:', data);
            setGameState(data.gameState);
            setStatus(`Turn: ${data.gameState.currentPlayer === 'player1' ? 'Player 1' : 'Player 2'}`);
        };

        const onGameStarted = (data) => {
            console.log('Game started:', data);
            setGameState(data.gameState);
            setStatus('Game Started!');
        };
        
        const onGameOver = ({ winner }) => {
            setStatus(`Game Over! Winner: ${winner}`);
            alert(`Game Over! Winner: ${winner}`);
        };

        const onError = (msg) => {
            console.error('Socket error:', msg);
            setError(msg);
        };

        socket.on('game_update', onGameUpdate);
        socket.on('game_started', onGameStarted);
        socket.on('game_over', onGameOver);
        socket.on('error', onError);

        // Player 1: After creating game, they need to ensure they're in the room
        // Player 2: Emit join_game to trigger game start
        if (role === 'player1') {
            console.log(`Player 1 (${username}) ensuring room subscription for game ${gameId}`);
            // Re-subscribe to ensure socket is in the room (in case of reconnect/navigation)
            socket.emit('join_game', { gameId, username });
        } else if (role === 'player2') {
            console.log(`Player 2 (${username}) joining game ${gameId}...`);
            socket.emit('join_game', { gameId, username });
        }

        return () => {
            socket.off('game_update', onGameUpdate);
            socket.off('game_started', onGameStarted);
            socket.off('game_over', onGameOver);
            socket.off('error', onError);
        };
    }, [gameId, username, navigate, role]);

    const handleLineClick = (type, r, c) => {
        if (!gameState) return;
        
        if (gameState.currentPlayer !== role) {
            console.log("Not your turn");
            return;
        }

        socket.emit('make_move', {
            gameId,
            playerId: role,
            type,
            r,
            c
        });
    };

    // Rendering helpers (Responsive Layout)
    // Calculate size based on grid and viewport
    const getResponsiveSize = () => {
        if (typeof window === 'undefined') return { dot: 6, line: 16, box: 16 };
        
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const maxWidth = Math.min(screenWidth - 64, 600); // padding + max width
        const maxHeight = screenHeight - 400; // reserve space for header/footer
        
        const gridCells = gridSize || 3;
        const totalUnits = gridCells * 2 + 1; // dots + boxes
        
        // Calculate optimal size
        const maxBoxWidth = Math.floor(maxWidth / totalUnits);
        const maxBoxHeight = Math.floor(maxHeight / totalUnits);
        const boxSize = Math.min(Math.max(maxBoxWidth, maxBoxHeight, 40), 80); // min 40px, max 80px
        const lineSize = boxSize;
        const dotSize = Math.max(Math.floor(boxSize * 0.25), 4); // dot is 25% of box, min 4px
        
        return { dot: dotSize, line: lineSize, box: boxSize };
    };
    
    const sizes = getResponsiveSize();
    const DOT_WRAPPER = `flex-none flex items-center justify-center`;
    const H_LINE_WRAPPER = `flex-none flex items-center justify-center`;
    const V_LINE_WRAPPER = `flex-none flex justify-center items-center`;
    const BOX_WRAPPER = `flex-none flex items-center justify-center`;

    const renderHorizontalLine = (r, c) => {
        const owner = gameState.horizontalLines[r]?.[c]; 
        let colorClass = 'bg-gray-200 hover:bg-gray-400';
        if (owner === 'player1') colorClass = 'bg-blue-500';
        if (owner === 'player2') colorClass = 'bg-red-500';

        return (
            <div key={`h-wrap-${r}-${c}`} className={H_LINE_WRAPPER} style={{ width: `${sizes.line}px`, height: `${sizes.dot}px` }}>
                <div 
                    className={`h-2 w-full cursor-pointer transition-colors duration-200 rounded-sm ${colorClass}`}
                    onClick={() => handleLineClick('horizontal', r, c)}
                    style={{ maxHeight: '8px' }}
                />
            </div>
        );
    };

    const renderVerticalLine = (r, c) => {
        const owner = gameState.verticalLines[r]?.[c];
        let colorClass = 'bg-gray-200 hover:bg-gray-400';
        if (owner === 'player1') colorClass = 'bg-blue-500';
        if (owner === 'player2') colorClass = 'bg-red-500';

        return (
            <div key={`v-wrap-${r}-${c}`} className={V_LINE_WRAPPER} style={{ width: `${sizes.dot}px`, height: `${sizes.line}px` }}>
                <div 
                    className={`w-2 h-full cursor-pointer transition-colors duration-200 rounded-sm ${colorClass}`}
                    onClick={() => handleLineClick('vertical', r, c)}
                    style={{ maxWidth: '8px' }}
                />
            </div>
        );
    };

    const renderBox = (r, c) => {
        const owner = gameState.boxes[r]?.[c];
        let content = null;
        let bgClass = '';
        
        if (owner === 'player1') {
            content = 'P1';
            bgClass = 'bg-blue-100 text-blue-600 font-bold';
        } else if (owner === 'player2') {
            content = 'P2';
            bgClass = 'bg-red-100 text-red-600 font-bold';
        }

        return (
            <div key={`b-wrap-${r}-${c}`} className={BOX_WRAPPER} style={{ width: `${sizes.box}px`, height: `${sizes.box}px` }}>
                <div className={`w-full h-full flex items-center justify-center transition-all duration-300 rounded-md ${bgClass}`} style={{ fontSize: `${Math.max(sizes.box * 0.3, 10)}px` }}>
                    {content}
                </div>
            </div>
        );
    };

    if (!gameState) return (
        <div className="flex items-center justify-center h-screen">
            <div className="text-xl">Waiting for opponent or game data...</div>
            <div className="mt-4 text-sm text-gray-500">Game ID: {gameId}</div>
        </div>
    );

    return (
        <div className="flex flex-col items-center p-4 sm:p-8 min-h-screen bg-gray-50 overflow-x-auto">
            <div className="mb-4 sm:mb-8 text-center w-full">
                <h1 className="text-2xl sm:text-3xl font-bold mb-2">Game Room: {gameId}</h1>
                <p className="text-sm sm:text-base text-gray-600">You are: <span className="font-bold uppercase">{role}</span> ({username})</p>
                <p className="text-base sm:text-lg font-semibold mt-2 text-purple-600">{status}</p>
                {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
            </div>

            <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-12 mb-4 sm:mb-8 text-base sm:text-2xl font-bold w-full max-w-md sm:max-w-none justify-center">
                <div className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg shadow-md transition-all ${gameState.currentPlayer === 'player1' ? 'bg-blue-100 border-2 border-blue-500 scale-105 sm:scale-110' : 'bg-white text-gray-400'}`}>
                    <span className="text-blue-600 text-sm sm:text-base">Player 1 ({gameState.player1Name}): {gameState.scores.player1}</span>
                </div>
                <div className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg shadow-md transition-all ${gameState.currentPlayer === 'player2' ? 'bg-red-100 border-2 border-red-500 scale-105 sm:scale-110' : 'bg-white text-gray-400'}`}>
                    <span className="text-red-600 text-sm sm:text-base">Player 2 ({gameState.player2Name}): {gameState.scores.player2}</span>
                </div>
            </div>

            <div className="inline-block bg-white p-2 sm:p-8 rounded-xl shadow-2xl select-none border border-gray-100 overflow-auto max-w-full">
                {gameState.horizontalLines.map((row, r) => (
                    <div key={`row-${r}`} className="flex flex-col">
                        <div className="flex items-center">
                            {row.map((_, c) => (
                                <React.Fragment key={`hr-${c}`}>
                                    <div className={DOT_WRAPPER} style={{ width: `${sizes.dot}px`, height: `${sizes.dot}px` }}>
                                        <div className="bg-gray-800 rounded-full z-10 shadow-sm" style={{ width: `${Math.max(sizes.dot - 2, 2)}px`, height: `${Math.max(sizes.dot - 2, 2)}px` }} /> 
                                    </div>
                                    {renderHorizontalLine(r, c)}
                                    {c === row.length - 1 && (
                                        <div className={DOT_WRAPPER} style={{ width: `${sizes.dot}px`, height: `${sizes.dot}px` }}>
                                            <div className="bg-gray-800 rounded-full z-10 shadow-sm" style={{ width: `${Math.max(sizes.dot - 2, 2)}px`, height: `${Math.max(sizes.dot - 2, 2)}px` }} />
                                        </div>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>

                        {r < gameState.boxes.length && gameState.verticalLines[r] && (
                            <div className="flex items-center">
                                {gameState.boxes[r].map((_, c) => (
                                    <React.Fragment key={`vr-${c}`}>
                                        {renderVerticalLine(r, c)}
                                        {renderBox(r, c)}
                                        {c === gameState.boxes[r].length - 1 && renderVerticalLine(r, c + 1)}
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            
            <button 
                onClick={() => navigate('/')}
                className="mt-6 sm:mt-12 px-4 sm:px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition text-sm sm:text-base"
            >
                Leave Game
            </button>
        </div>
    );
};

export default Board;
