// utils/gameLogic.js
// Production-ready game logic supporting 2-4 players

/**
 * Calculate next game state after a move
 * @param {Object} gameState - Current game state
 * @param {number} gridSize - Grid size (rows/cols)
 * @param {number} r - Row coordinate
 * @param {number} c - Column coordinate
 * @param {string} type - 'horizontal' or 'vertical'
 * @returns {Object} New game state or error
 */
const calculateNewState = (gameState, gridSize, r, c, type) => {
    const rows = gridSize;
    const cols = gridSize;
    
    // Deep copy to avoid mutation
    const horizontalLines = gameState.horizontalLines.map(row => [...row]);
    const verticalLines = gameState.verticalLines.map(row => [...row]);
    const boxes = gameState.boxes.map(row => [...row]);
    const scores = { ...gameState.scores };
    let currentPlayer = gameState.currentPlayer;
    const playerCount = gameState.playerCount || 2;
    const players = gameState.players || ['player1', 'player2'];

    let points = 0;
    let completed = false;

    // Input validation
    if (type === 'horizontal') {
        if (r < 0 || r > rows || c < 0 || c >= cols) {
            return { error: 'Invalid coordinates' };
        }
    } else if (type === 'vertical') {
        if (r < 0 || r >= rows || c < 0 || c > cols) {
            return { error: 'Invalid coordinates' };
        }
    } else {
        return { error: 'Invalid line type' };
    }

    // Helper: Check if box is complete
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
        if (horizontalLines[r][c] !== null) {
            return { error: 'Line already taken' };
        }
        horizontalLines[r][c] = currentPlayer;
    } else {
        if (verticalLines[r][c] !== null) {
            return { error: 'Line already taken' };
        }
        verticalLines[r][c] = currentPlayer;
    }

    // Check boxes affected by this move
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
        // Player gets another turn when completing a box
    } else {
        // Switch to next player
        currentPlayer = getNextPlayer(currentPlayer, players);
    }

    // Check for winner
    const winner = calculateWinner(scores, rows, cols, players);

    return {
        horizontalLines,
        verticalLines,
        boxes,
        currentPlayer,
        scores,
        winner,
        playerCount,
        players
    };
};

/**
 * Get next player in turn order
 * @param {string} currentPlayer - Current player ID
 * @param {Array} players - Array of player IDs
 * @returns {string} Next player ID
 */
const getNextPlayer = (currentPlayer, players) => {
    const currentIndex = players.indexOf(currentPlayer);
    const nextIndex = (currentIndex + 1) % players.length;
    return players[nextIndex];
};

/**
 * Calculate game winner
 * @param {Object} scores - Player scores
 * @param {number} rows - Grid rows
 * @param {number} cols - Grid columns
 * @param {Array} players - Array of player IDs
 * @returns {string|null} Winner player ID, 'draw', or null
 */
const calculateWinner = (scores, rows, cols, players) => {
    const totalBoxes = rows * cols;
    const completedBoxes = players.reduce((sum, player) => sum + scores[player], 0);

    // Game not finished
    if (completedBoxes < totalBoxes) {
        return null;
    }

    // Find highest score
    let maxScore = -1;
    let winners = [];
    
    players.forEach(player => {
        if (scores[player] > maxScore) {
            maxScore = scores[player];
            winners = [player];
        } else if (scores[player] === maxScore) {
            winners.push(player);
        }
    });

    // Return winner or draw
    return winners.length === 1 ? winners[0] : 'draw';
};

/**
 * Initialize game state for new game
 * @param {number} gridSize - Grid size (rows/cols)
 * @param {number} playerCount - Number of players (2-4)
 * @returns {Object} Initial game state
 */
const initializeGameState = (gridSize, playerCount = 2) => {
    // Validate inputs
    if (gridSize < 2 || gridSize > 10) {
        throw new Error('Grid size must be between 2 and 10');
    }
    if (playerCount < 2 || playerCount > 4) {
        throw new Error('Player count must be between 2 and 4');
    }

    const rows = gridSize;
    const cols = gridSize;

    // Initialize grids
    const horizontalLines = Array(rows + 1).fill(null).map(() => Array(cols).fill(null));
    const verticalLines = Array(rows).fill(null).map(() => Array(cols + 1).fill(null));
    const boxes = Array(rows).fill(null).map(() => Array(cols).fill(null));

    // Create player list
    const players = [];
    const scores = {};
    for (let i = 1; i <= playerCount; i++) {
        const playerId = `player${i}`;
        players.push(playerId);
        scores[playerId] = 0;
    }

    return {
        horizontalLines,
        verticalLines,
        boxes,
        currentPlayer: 'player1',
        scores,
        winner: null,
        playerCount,
        players
    };
};

module.exports = { 
    calculateNewState, 
    initializeGameState,
    getNextPlayer,
    calculateWinner
};
