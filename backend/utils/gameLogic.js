// utils/gameLogic.js
const calculateNewState = (gameState, gridSize, r, c, type) => {
    // Clone state
    const rows = gridSize;
    const cols = gridSize;
    
    // Deep copy to avoid mutation
    const horizontalLines = gameState.horizontalLines.map(row => [...row]);
    const verticalLines = gameState.verticalLines.map(row => [...row]);
    const boxes = gameState.boxes.map(row => [...row]);
    const scores = { ...gameState.scores };
    let currentPlayer = gameState.currentPlayer;

    let points = 0;
    let completed = false;

    // Helper check
    const isBoxComplete = (row, col) => {
        if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
        return (
            horizontalLines[row][col] !== null && 
            horizontalLines[row + 1][col] !== null &&
            verticalLines[row][col] !== null && 
            verticalLines[row][col + 1] !== null
        );
    };

    // Update lines
    if (type === 'horizontal') {
        if (horizontalLines[r][c] !== null) return { error: 'Line already taken' };
        horizontalLines[r][c] = currentPlayer;
    } else {
        if (verticalLines[r][c] !== null) return { error: 'Line already taken' };
        verticalLines[r][c] = currentPlayer;
    }

    // Check boxes
    if (type === 'horizontal') {
        // Check box below
        if (r < rows && isBoxComplete(r, c) && boxes[r][c] === null) {
            boxes[r][c] = currentPlayer;
            completed = true;
            points++;
        }
        // Check box above
        if (r > 0 && isBoxComplete(r - 1, c) && boxes[r - 1][c] === null) {
            boxes[r - 1][c] = currentPlayer;
            completed = true;
            points++;
        }
    } else {
        // Check box right
        if (c < cols && isBoxComplete(r, c) && boxes[r][c] === null) {
            boxes[r][c] = currentPlayer;
            completed = true;
            points++;
        }
        // Check box left
        if (c > 0 && isBoxComplete(r, c - 1) && boxes[r][c - 1] === null) {
            boxes[r][c - 1] = currentPlayer;
            completed = true;
            points++;
        }
    }

    if (completed) {
        scores[currentPlayer] += points;
    } else {
        // Switch turn if no box completed
        currentPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
    }

    // Check winner
    let winner = null;
    if (scores.player1 + scores.player2 === rows * cols) {
        if (scores.player1 > scores.player2) winner = 'player1';
        else if (scores.player2 > scores.player1) winner = 'player2';
        else winner = 'draw';
    }

    return {
        horizontalLines,
        verticalLines,
        boxes,
        currentPlayer,
        scores,
        winner
    };
};

const initializeGameState = (gridSize) => {
    const rows = gridSize;
    const cols = gridSize;

    // hLines: (rows+1) x cols
    const horizontalLines = Array(rows + 1).fill(null).map(() => Array(cols).fill(null));
    // vLines: rows x (cols+1)
    const verticalLines = Array(rows).fill(null).map(() => Array(cols + 1).fill(null));
    // boxes: rows x cols
    const boxes = Array(rows).fill(null).map(() => Array(cols).fill(null));

    return {
        horizontalLines,
        verticalLines,
        boxes,
        currentPlayer: 'player1',
        scores: { player1: 0, player2: 0 },
        winner: null
    };
};

module.exports = { calculateNewState, initializeGameState };
