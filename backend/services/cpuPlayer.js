// backend/services/cpuPlayer.js
// CPU/AI player move selection for Dots & Boxes

const CPU_NAMES = ['Bot-Alpha', 'Bot-Beta', 'Bot-Gamma', 'Bot-Delta', 'Bot-Epsilon', 'Bot-Zeta'];
const CPU_AVATARS = ['🤖', '🧠', '🎯', '🔮', '⚡', '🎲'];

const CPU_DELAYS = {
    easy: 800,
    medium: 1200,
    hard: 1500,
};

/**
 * Get all valid (unoccupied) moves for the current game state.
 * @param {Object} gameState
 * @returns {Array<{r: number, c: number, type: string}>}
 */
function getValidMoves(gameState) {
    const moves = [];
    const { horizontalLines, verticalLines } = gameState;

    for (let r = 0; r < horizontalLines.length; r++) {
        for (let c = 0; c < horizontalLines[r].length; c++) {
            if (horizontalLines[r][c] === null) {
                moves.push({ r, c, type: 'horizontal' });
            }
        }
    }

    for (let r = 0; r < verticalLines.length; r++) {
        for (let c = 0; c < verticalLines[r].length; c++) {
            if (verticalLines[r][c] === null) {
                moves.push({ r, c, type: 'vertical' });
            }
        }
    }

    return moves;
}

/**
 * Count how many sides a box currently has filled.
 * @param {Object} gameState
 * @param {number} row - Box row
 * @param {number} col - Box column
 * @returns {number} 0-4
 */
function countBoxSides(gameState, row, col) {
    const { horizontalLines, verticalLines } = gameState;
    let count = 0;
    if (horizontalLines[row][col] !== null) count++;       // top
    if (horizontalLines[row + 1][col] !== null) count++;   // bottom
    if (verticalLines[row][col] !== null) count++;         // left
    if (verticalLines[row][col + 1] !== null) count++;     // right
    return count;
}

/**
 * Get all boxes adjacent to a given move.
 * @param {Object} gameState
 * @param {{r: number, c: number, type: string}} move
 * @returns {Array<{row: number, col: number}>}
 */
function getAdjacentBoxes(gameState, move) {
    const boxes = [];
    const rows = gameState.boxes.length;
    const cols = gameState.boxes[0].length;

    if (move.type === 'horizontal') {
        // Box below (row = r, col = c)
        if (move.r < rows && move.c < cols) {
            boxes.push({ row: move.r, col: move.c });
        }
        // Box above (row = r-1, col = c)
        if (move.r > 0 && move.r - 1 < rows && move.c < cols) {
            boxes.push({ row: move.r - 1, col: move.c });
        }
    } else {
        // Box right (row = r, col = c)
        if (move.r < rows && move.c < cols) {
            boxes.push({ row: move.r, col: move.c });
        }
        // Box left (row = r, col = c-1)
        if (move.c > 0 && move.r < rows && move.c - 1 < cols) {
            boxes.push({ row: move.r, col: move.c - 1 });
        }
    }

    return boxes;
}

/**
 * Analyze a move: how many boxes it completes, and how many 3-side boxes it creates.
 * @param {Object} gameState
 * @param {{r: number, c: number, type: string}} move
 * @returns {{completions: number, opensThreeSide: number}}
 */
function analyzeMove(gameState, move) {
    const adjacentBoxes = getAdjacentBoxes(gameState, move);
    let completions = 0;
    let opensThreeSide = 0;

    for (const box of adjacentBoxes) {
        if (gameState.boxes[box.row][box.col] !== null) continue; // already captured
        const sides = countBoxSides(gameState, box.row, box.col);
        if (sides === 3) {
            completions++;
        } else if (sides === 2) {
            opensThreeSide++;
        }
    }

    return { completions, opensThreeSide };
}

/**
 * Easy CPU: picks a random valid move.
 * @param {Object} gameState
 * @returns {{r: number, c: number, type: string}|null}
 */
function chooseEasyMove(gameState) {
    const moves = getValidMoves(gameState);
    if (moves.length === 0) return null;
    return moves[Math.floor(Math.random() * moves.length)];
}

/**
 * Medium CPU: prioritizes completing boxes, avoids giving away 3rd-side boxes.
 * @param {Object} gameState
 * @returns {{r: number, c: number, type: string}|null}
 */
function chooseMediumMove(gameState) {
    const moves = getValidMoves(gameState);
    if (moves.length === 0) return null;

    const completing = [];
    const safe = [];
    const dangerous = [];

    for (const move of moves) {
        const { completions, opensThreeSide } = analyzeMove(gameState, move);
        if (completions > 0) {
            completing.push({ move, completions });
        } else if (opensThreeSide === 0) {
            safe.push(move);
        } else {
            dangerous.push({ move, opensThreeSide });
        }
    }

    // 1. Complete boxes (prioritize moves that complete the most)
    if (completing.length > 0) {
        completing.sort((a, b) => b.completions - a.completions);
        return completing[0].move;
    }

    // 2. Safe moves that don't give away boxes
    if (safe.length > 0) {
        return safe[Math.floor(Math.random() * safe.length)];
    }

    // 3. Least dangerous move
    dangerous.sort((a, b) => a.opensThreeSide - b.opensThreeSide);
    return dangerous[0].move;
}

/**
 * Hard CPU: Chain counting strategy.
 * - Complete all available chains greedily
 * - Avoid opening long chains for the opponent
 * - When forced, sacrifice the shortest chain
 * @param {Object} gameState
 * @returns {{r: number, c: number, type: string}|null}
 */
function chooseHardMove(gameState) {
    const moves = getValidMoves(gameState);
    if (moves.length === 0) return null;

    // Phase 1: Take any box-completing move (greedy chain capture)
    const completing = [];
    for (const move of moves) {
        const { completions } = analyzeMove(gameState, move);
        if (completions > 0) {
            completing.push({ move, completions });
        }
    }

    if (completing.length > 0) {
        completing.sort((a, b) => b.completions - a.completions);
        return completing[0].move;
    }

    // Phase 2: No completions available — must place a non-completing line.
    // Avoid giving away 3-side boxes; if forced, pick the move that gives away
    // the fewest boxes (shortest chain sacrifice).
    const safe = [];
    const dangerous = [];

    for (const move of moves) {
        const { opensThreeSide } = analyzeMove(gameState, move);
        if (opensThreeSide === 0) {
            safe.push(move);
        } else {
            dangerous.push({ move, opensThreeSide, chainLength: countChainLength(gameState, move) });
        }
    }

    if (safe.length > 0) {
        // Among safe moves, pick one at random. (No additional heuristic
        // between different safe moves is applied.)
        return safe[Math.floor(Math.random() * safe.length)];
    }

    // All moves are dangerous — sacrifice the shortest chain
    dangerous.sort((a, b) => a.chainLength - b.chainLength);
    return dangerous[0].move;
}

/**
 * Estimate the chain length opened by a dangerous move.
 * A "chain" is a sequence of 2-side boxes connected adjacently that will
 * become capturable once one of them gains a 3rd side.
 * @param {Object} gameState
 * @param {{r: number, c: number, type: string}} move
 * @returns {number}
 */
function countChainLength(gameState, move) {
    const adjacentBoxes = getAdjacentBoxes(gameState, move);
    let totalChain = 0;

    const rows = gameState.boxes.length;
    const cols = gameState.boxes[0].length;
    const visited = new Set();

    for (const startBox of adjacentBoxes) {
        if (gameState.boxes[startBox.row][startBox.col] !== null) continue;
        const sides = countBoxSides(gameState, startBox.row, startBox.col);
        if (sides !== 2) continue; // only 2-side boxes become 3-side after this move

        // BFS to find connected 2-side (or 3-side) boxes
        const queue = [startBox];
        const key = (r, c) => `${r},${c}`;
        visited.add(key(startBox.row, startBox.col));
        let chainLen = 0;

        while (queue.length > 0) {
            const box = queue.shift();
            chainLen++;

            // Check all 4 neighbors
            const neighbors = [
                { row: box.row - 1, col: box.col },
                { row: box.row + 1, col: box.col },
                { row: box.row, col: box.col - 1 },
                { row: box.row, col: box.col + 1 },
            ];

            for (const nb of neighbors) {
                if (nb.row < 0 || nb.row >= rows || nb.col < 0 || nb.col >= cols) continue;
                if (visited.has(key(nb.row, nb.col))) continue;
                if (gameState.boxes[nb.row][nb.col] !== null) continue;

                const nbSides = countBoxSides(gameState, nb.row, nb.col);
                // Include boxes with 2+ sides (they form part of the chain)
                if (nbSides >= 2) {
                    visited.add(key(nb.row, nb.col));
                    queue.push(nb);
                }
            }
        }

        totalChain += chainLen;
    }

    return totalChain;
}

/**
 * Choose a CPU move based on difficulty level.
 * @param {Object} gameState - The current game state
 * @param {string} difficulty - 'easy' | 'medium' | 'hard'
 * @returns {{r: number, c: number, type: string}|null}
 */
function chooseCPUMove(gameState, difficulty = 'medium') {
    switch (difficulty) {
    case 'easy':
        return chooseEasyMove(gameState);
    case 'hard':
        return chooseHardMove(gameState);
    case 'medium':
    default:
        return chooseMediumMove(gameState);
    }
}

module.exports = {
    chooseCPUMove,
    getValidMoves,
    analyzeMove,
    countBoxSides,
    getAdjacentBoxes,
    countChainLength,
    CPU_NAMES,
    CPU_AVATARS,
    CPU_DELAYS,
};
