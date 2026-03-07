// src/components/ScoreBar.jsx
// Real-time territory percentage scoreboard during gameplay

import React from 'react';

/**
 * ScoreBar Component — wrapped with React.memo to prevent re-renders
 * when parent re-renders but props haven't changed.
 *
 * @param {Array} players - [{id, username, avatar, color}]
 * @param {Object} scores - {player1: 5, player2: 8, ...}
 * @param {number} gridSize - Grid dimension (e.g. 3 for 3×3 = 9 total boxes)
 * @param {string} currentPlayer - ID of the current player
 */
const ScoreBar = React.memo(({ players, scores, gridSize, currentPlayer }) => {
  const totalTiles = (gridSize - 1) * (gridSize - 1);
  // On mobile with 3-4 players, split into two rows of 2
  const splitIntoRows = players.length > 2;

  // Truncate long usernames gracefully
  const truncateName = (name, maxLen = 12) => {
    if (!name) return '';
    return name.length > maxLen ? name.slice(0, maxLen) + '…' : name;
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 backdrop-blur-sm shadow-lg score-bar"
      style={{ backgroundColor: 'var(--nav-bg)', borderBottom: '1px solid var(--border-color)' }}
    >
      <div className="max-w-6xl mx-auto px-2 sm:px-3 py-1.5 sm:py-2">
        {splitIntoRows ? (
          // Multi-player: grid layout that wraps into 2 columns on mobile
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1">
            {players.map((player) => {
              const score = scores?.[player.id] || 0;
              const percentage = totalTiles > 0 ? (score / totalTiles) * 100 : 0;
              const isCurrent = currentPlayer === player.id;

              return (
                <div
                  key={player.id}
                  className={`flex items-center gap-1.5 transition-all duration-200 ${
                    isCurrent ? 'scale-[1.02]' : ''
                  }`}
                >
                  <span className="text-base leading-none flex-shrink-0">{player.avatar}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span
                        className="text-xs font-bold truncate"
                        style={{ maxWidth: '70px', color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                        title={player.username}
                      >
                        {truncateName(player.username, 10)}
                      </span>
                      <span className="text-xs font-extrabold flex-shrink-0" style={{ color: player.color }}>
                        {percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden relative" style={{ backgroundColor: 'var(--bg-surface)' }}>
                      <div
                        className="h-full transition-all duration-500 ease-out"
                        style={{ width: `${percentage}%`, backgroundColor: player.color }}
                      />
                      {isCurrent && (
                        <div
                          className="absolute inset-0 animate-pulse"
                          style={{
                            boxShadow: `inset 0 0 6px ${player.color}40`,
                            border: `1px solid ${player.color}60`,
                            borderRadius: '9999px',
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // 2-player: original single-column layout
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

                  {/* Name — wider on mobile, truncated with ellipsis */}
                  <div className="flex-shrink-0" style={{ width: 'clamp(64px, 20vw, 96px)' }}>
                    <span
                      className="text-xs font-bold truncate block"
                      style={{ color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      title={player.username}
                    >
                      {truncateName(player.username, 14)}
                    </span>
                  </div>

                  {/* Progress bar container */}
                  <div className="flex-1 h-5 rounded-full overflow-hidden relative" style={{ backgroundColor: 'var(--bg-surface)' }}>
                    <div
                      className="h-full transition-all duration-500 ease-out"
                      style={{ width: `${percentage}%`, backgroundColor: player.color }}
                    />
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
                  <div className="flex-shrink-0 w-10 sm:w-12 text-right">
                    <span className="text-xs font-extrabold" style={{ color: player.color }}>
                      {percentage.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

ScoreBar.displayName = 'ScoreBar';

export default ScoreBar;
