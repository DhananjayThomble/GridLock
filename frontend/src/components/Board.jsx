// src/components/Board.jsx
import React, { useState, useEffect } from 'react';

const Board = ({ rows = 3, cols = 3 }) => {
  const [horizontalLines, setHorizontalLines] = useState([]);
  const [verticalLines, setVerticalLines] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState('player1');
  const [scores, setScores] = useState({ player1: 0, player2: 0 });
  const [winner, setWinner] = useState(null);

  // Initialize board on load or reset
  useEffect(() => {
    initializeBoard();
  }, [rows, cols]);

  const initializeBoard = () => {
    // Horizontal lines: (rows + 1) x cols
    // Each row has 'cols' lines
    const hLines = [];
    for (let i = 0; i < rows + 1; i++) {
      hLines.push(new Array(cols).fill(null));
    }
    setHorizontalLines(hLines);

    // Vertical lines: rows x (cols + 1)
    // Each row has 'cols + 1' lines
    const vLines = [];
    for (let i = 0; i < rows; i++) {
      vLines.push(new Array(cols + 1).fill(null));
    }
    setVerticalLines(vLines);

    // Boxes: rows x cols
    const b = [];
    for (let i = 0; i < rows; i++) {
      b.push(new Array(cols).fill(null));
    }
    setBoxes(b);

    setCurrentPlayer('player1');
    setScores({ player1: 0, player2: 0 });
    setWinner(null);
  };

  const checkBoxCompletion = (hLines, vLines, type, r, c) => {
    let completed = false;
    const newBoxes = boxes.map(row => [...row]);
    let points = 0;

    // Helper to check a single box at [row, col]
    const isBoxComplete = (row, col) => {
      if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
      // Top, Bottom, Left, Right
      return (
        hLines[row][col] !== null && 
        hLines[row + 1][col] !== null &&
        vLines[row][col] !== null && 
        vLines[row][col + 1] !== null
      );
    };

    // If horizontal line at [r, c] was clicked:
    // It could be the TOP of box [r, c] (if r < rows)
    // It could be the BOTTOM of box [r-1, c] (if r > 0)
    if (type === 'horizontal') {
      // Check box below the line
      if (r < rows && isBoxComplete(r, c) && newBoxes[r][c] === null) {
        newBoxes[r][c] = currentPlayer;
        completed = true;
        points++;
      }
      // Check box above the line
      if (r > 0 && isBoxComplete(r - 1, c) && newBoxes[r - 1][c] === null) {
        newBoxes[r - 1][c] = currentPlayer;
        completed = true;
        points++;
      }
    }

    // If vertical line at [r, c] was clicked:
    // It could be the LEFT of box [r, c] (if c < cols)
    // It could be the RIGHT of box [r, c-1] (if c > 0)
    if (type === 'vertical') {
      // Check box to the right
      if (c < cols && isBoxComplete(r, c) && newBoxes[r][c] === null) {
        newBoxes[r][c] = currentPlayer;
        completed = true;
        points++;
      }
      // Check box to the left
      if (c > 0 && isBoxComplete(r, c - 1) && newBoxes[r][c - 1] === null) {
        newBoxes[r][c - 1] = currentPlayer;
        completed = true;
        points++;
      }
    }

    if (completed) {
      setBoxes(newBoxes);
      setScores(prev => {
        const newScores = { ...prev };
        newScores[currentPlayer] += points;
        
        // Check win condition
        const totalBoxes = rows * cols;
        const takenBoxes = newScores.player1 + newScores.player2;
        if (takenBoxes === totalBoxes) {
          if (newScores.player1 > newScores.player2) setWinner('Player 1');
          else if (newScores.player2 > newScores.player1) setWinner('Player 2');
          else setWinner('Draw');
        }
        
        return newScores;
      });
      // Player keeps turn if they completed a box
      return true; 
    }
    
    return false;
  };

  const handleLineClick = (type, r, c) => {
    if (winner) return;

    // Check if line is already taken
    if (type === 'horizontal') {
      if (horizontalLines[r][c] !== null) return;
    } else {
      if (verticalLines[r][c] !== null) return;
    }

    // Update lines state
    let newHLines = horizontalLines.map(row => [...row]);
    let newVLines = verticalLines.map(row => [...row]);

    if (type === 'horizontal') {
      newHLines[r][c] = currentPlayer;
      setHorizontalLines(newHLines);
    } else {
      newVLines[r][c] = currentPlayer;
      setVerticalLines(newVLines);
    }

    // Check for completed boxes
    const boxCompleted = checkBoxCompletion(newHLines, newVLines, type, r, c);

    // Switch turn only if no box was completed
    if (!boxCompleted) {
      setCurrentPlayer(prev => prev === 'player1' ? 'player2' : 'player1');
    }
  };

  // Rendering
  const renderHorizontalLine = (r, c) => {
    const owner = horizontalLines[r][c];
    let colorClass = 'bg-gray-200 hover:bg-gray-400';
    if (owner === 'player1') colorClass = 'bg-blue-500';
    if (owner === 'player2') colorClass = 'bg-red-500';

    return (
      <div 
        key={`h-${r}-${c}`}
        className={`h-2 w-16 mx-1 cursor-pointer transition-colors duration-200 ${colorClass}`}
        onClick={() => handleLineClick('horizontal', r, c)}
      />
    );
  };

  const renderVerticalLine = (r, c) => {
    const owner = verticalLines[r][c];
    let colorClass = 'bg-gray-200 hover:bg-gray-400';
    if (owner === 'player1') colorClass = 'bg-blue-500';
    if (owner === 'player2') colorClass = 'bg-red-500';

    return (
      <div 
        key={`v-${r}-${c}`}
        className={`w-2 h-16 my-1 cursor-pointer transition-colors duration-200 ${colorClass}`}
        onClick={() => handleLineClick('vertical', r, c)}
      />
    );
  };

  const renderBox = (r, c) => {
    const owner = boxes[r][c];
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
      <div key={`b-${r}-${c}`} className={`w-16 h-16 flex items-center justify-center transition-all duration-300 ${bgClass}`}>
        {content}
      </div>
    );
  };

  if (!horizontalLines.length) return <div>Loading...</div>;

  return (
    <div className="flex flex-col items-center">
      
      {/* HUD */}
      <div className="flex space-x-8 mb-6 text-xl font-bold">
        <div className={`px-4 py-2 rounded ${currentPlayer === 'player1' ? 'bg-blue-100 border-2 border-blue-500' : ''}`}>
          <span className="text-blue-600">Player 1: {scores.player1}</span>
        </div>
        <div className={`px-4 py-2 rounded ${currentPlayer === 'player2' ? 'bg-red-100 border-2 border-red-500' : ''}`}>
          <span className="text-red-600">Player 2: {scores.player2}</span>
        </div>
      </div>

      {winner && (
        <div className="mb-6 p-4 bg-green-100 border border-green-400 text-green-700 rounded text-2xl font-bold animate-bounce">
          {winner === 'Draw' ? 'Game Over: It\'s a Draw!' : `Game Over: ${winner} Wins!`}
        </div>
      )}

      <div className="inline-block bg-white p-6 rounded-xl shadow-2xl select-none border border-gray-100">
        {horizontalLines.map((row, r) => (
          <div key={`row-${r}`} className="flex flex-col">
            
            {/* Horizontal Line Row */}
            <div className="flex items-center">
              {row.map((_, c) => (
                <React.Fragment key={`hr-${c}`}>
                  <div className="w-4 h-4 bg-gray-800 rounded-full z-10" /> {/* Dot */}
                  {renderHorizontalLine(r, c)}
                  {c === row.length - 1 && <div className="w-4 h-4 bg-gray-800 rounded-full z-10" />} {/* Last Dot */}
                </React.Fragment>
              ))}
            </div>

            {/* Vertical Lines + Boxes Row (only if not the last row of dots) */}
            {r < rows && (
              <div className="flex items-center">
                {verticalLines[r].map((_, c) => (
                  <React.Fragment key={`vr-${c}`}>
                    {renderVerticalLine(r, c)}
                    {c < cols && renderBox(r, c)}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button 
        onClick={initializeBoard}
        className="mt-8 px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-800"
      >
        Restart Game
      </button>
    </div>
  );
};

export default Board;
