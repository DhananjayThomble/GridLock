// src/components/GameController.jsx
import React, { useState } from 'react';
import Board from './Board';

const GameController = () => {
    const [gridSize, setGridSize] = useState(3);
    const [turn, setTurn] = useState('player1'); // Managed by Board, can lift state up later if needed for global display

    const handleGridSizeChange = (size) => {
        setGridSize(size);
    };

    return (
        <div className="flex flex-col items-center justify-center p-8 bg-white shadow-xl rounded-lg">
            <h1 className="text-4xl font-bold mb-8 text-gray-800">Dots and Boxes</h1>
            
            <div className="mb-6 flex items-center space-x-4">
                <label htmlFor="gridSize" className="text-lg font-medium text-gray-700">Grid Size:</label>
                <select 
                    id="gridSize" 
                    onChange={(e) => handleGridSizeChange(parseInt(e.target.value))} 
                    value={gridSize}
                    className="border border-gray-300 rounded px-3 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value={3}>3x3</option>
                    <option value={4}>4x4</option>
                    <option value={5}>5x5</option>
                    <option value={6}>6x6</option>
                    <option value={8}>8x8</option>
                </select>
            </div>

            <Board rows={gridSize} cols={gridSize} />
            
            <div className="mt-8 text-sm text-gray-500">
                <p>Click on lines to connect dots. Complete a box to score!</p>
            </div>
        </div>
    );
};

export default GameController;
