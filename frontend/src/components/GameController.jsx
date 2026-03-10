// src/components/GameController.jsx
import React, { useState } from 'react';
import Board from './Board';

const GameController = () => {
    const [gridSize, setGridSize] = useState(3);

    const handleGridSizeChange = (size) => {
        setGridSize(size);
    };

    return (
        <div
            className="flex flex-col items-center justify-center p-8 shadow-xl rounded-lg"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        >
            <h1 className="text-4xl font-bold mb-8" style={{ color: 'var(--text-primary)' }}>GridLock</h1>
            
            <div className="mb-6 flex items-center space-x-4">
                <label htmlFor="gridSize" className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>Grid Size:</label>
                <select 
                    id="gridSize" 
                    onChange={(e) => handleGridSizeChange(parseInt(e.target.value))} 
                    value={gridSize}
                    className="rounded px-3 py-1 focus:outline-none focus:ring-2"
                    style={{
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-color)',
                    }}
                >
                    <option value={3}>3x3</option>
                    <option value={4}>4x4</option>
                    <option value={5}>5x5</option>
                    <option value={6}>6x6</option>
                    <option value={8}>8x8</option>
                </select>
            </div>

            <Board rows={gridSize} cols={gridSize} />
            
            <div className="mt-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                <p>Click on lines to connect dots. Complete a box to score!</p>
            </div>
        </div>
    );
};

export default GameController;
