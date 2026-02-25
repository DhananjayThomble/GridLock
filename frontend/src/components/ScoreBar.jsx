// src/components/ScoreBar.jsx
// Real-time territory percentage scoreboard during gameplay

import React from 'react';

/**
 * ScoreBar Component
 * 
 * Shows all players' territory % as colored progress bars
 * 
 * @param {Array} players - Array of player objects [{id, username, avatar, color}]
 * @param {Object} scores - Object mapping player IDs to tile counts {player1: 5, player2: 8, ...}
 * @param {number} gridSize - Total number of tiles (e.g., 100 for 10x10)
 * @param {string} currentPlayer - ID of the current player (e.g., 'player1')
 */
const ScoreBar = ({ players, scores, gridSize, currentPlayer }) => {
  // Calculate total tiles (boxes in the grid)
  const totalTiles = gridSize * gridSize;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-gray-900/85 backdrop-blur-sm border-b border-gray-700/50 shadow-lg">
      <div className="max-w-6xl mx-auto px-3 py-2">
        <div className="flex flex-col gap-1.5">
          {players.map((player) => {
            const score = scores?.[player.id] || 0;
            const percentage = totalTiles > 0 ? (score / totalTiles) * 100 : 0;
            const isCurrent = currentPlayer === player.id;
            
            return (
              <div
                key={player.id}
                className={`flex items-center gap-2 transition-all duration-200 ${
                  isCurrent ? 'scale-[1.02]' : ''
                }`}
              >
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <span className="text-lg leading-none">{player.avatar}</span>
                </div>

                {/* Name */}
                <div className="flex-shrink-0 min-w-[80px] sm:min-w-[100px]">
                  <span
                    className={`text-xs font-bold truncate ${
                      isCurrent ? 'text-white' : 'text-gray-300'
                    }`}
                  >
                    {player.username}
                  </span>
                </div>

                {/* Progress bar container */}
                <div className="flex-1 h-5 bg-gray-800/50 rounded-full overflow-hidden relative">
                  {/* Progress bar fill */}
                  <div
                    className="h-full transition-all duration-500 ease-out"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: player.color,
                    }}
                  />
                  
                  {/* Current player indicator glow */}
                  {isCurrent && (
                    <div
                      className="absolute inset-0 animate-pulse"
                      style={{
                        boxShadow: `inset 0 0 8px ${player.color}40`,
                        border: `1px solid ${player.color}60`,
                        borderRadius: '9999px',
                      }}
                    />
                  )}
                </div>

                {/* Percentage */}
                <div className="flex-shrink-0 w-12 text-right">
                  <span
                    className="text-xs font-extrabold"
                    style={{ color: player.color }}
                  >
                    {percentage.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ScoreBar;
