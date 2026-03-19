const {
    chooseCPUMove,
    getValidMoves,
    analyzeMove,
    countBoxSides,
    getAdjacentBoxes,
    countChainLength,
    CPU_NAMES,
    CPU_AVATARS,
    CPU_DELAYS,
} = require('../services/cpuPlayer');
const { initializeGameState, calculateNewState } = require('../utils/gameLogic');

describe('cpuPlayer constants', () => {
    test('has at least 6 CPU names and avatars', () => {
        expect(CPU_NAMES.length).toBeGreaterThanOrEqual(6);
        expect(CPU_AVATARS.length).toBeGreaterThanOrEqual(6);
    });

    test('has delays for all difficulty levels', () => {
        expect(CPU_DELAYS.easy).toBe(800);
        expect(CPU_DELAYS.medium).toBe(1200);
        expect(CPU_DELAYS.hard).toBe(1500);
    });
});

describe('getValidMoves', () => {
    test('returns all possible moves on empty 2x2 grid', () => {
        const state = initializeGameState(2, 2);
        const moves = getValidMoves(state);
        // 2x2 grid: horizontal lines = 3 rows × 2 cols = 6, vertical = 2 rows × 3 cols = 6
        expect(moves).toHaveLength(12);
    });

    test('returns all possible moves on empty 3x3 grid', () => {
        const state = initializeGameState(3, 2);
        const moves = getValidMoves(state);
        // 3x3: horizontal = 4 × 3 = 12, vertical = 3 × 4 = 12 → 24
        expect(moves).toHaveLength(24);
    });

    test('decreases after moves are made', () => {
        let state = initializeGameState(2, 2);
        const before = getValidMoves(state).length;
        state = calculateNewState(state, 2, 0, 0, 'horizontal');
        const after = getValidMoves(state).length;
        expect(after).toBe(before - 1);
    });
});

describe('countBoxSides', () => {
    test('returns 0 for empty grid', () => {
        const state = initializeGameState(3, 2);
        expect(countBoxSides(state, 0, 0)).toBe(0);
    });

    test('increments correctly after placing lines', () => {
        let state = initializeGameState(3, 2);
        state = calculateNewState(state, 3, 0, 0, 'horizontal'); // top of box(0,0)
        expect(countBoxSides(state, 0, 0)).toBe(1);
    });
});

describe('getAdjacentBoxes', () => {
    test('horizontal line at top edge has 1 adjacent box', () => {
        const state = initializeGameState(3, 2);
        const boxes = getAdjacentBoxes(state, { r: 0, c: 0, type: 'horizontal' });
        expect(boxes).toHaveLength(1);
        expect(boxes[0]).toEqual({ row: 0, col: 0 });
    });

    test('horizontal line in middle has 2 adjacent boxes', () => {
        const state = initializeGameState(3, 2);
        const boxes = getAdjacentBoxes(state, { r: 1, c: 1, type: 'horizontal' });
        expect(boxes).toHaveLength(2);
    });

    test('vertical line at left edge has 1 adjacent box', () => {
        const state = initializeGameState(3, 2);
        const boxes = getAdjacentBoxes(state, { r: 0, c: 0, type: 'vertical' });
        expect(boxes).toHaveLength(1);
        expect(boxes[0]).toEqual({ row: 0, col: 0 });
    });

    test('vertical line in middle has 2 adjacent boxes', () => {
        const state = initializeGameState(3, 2);
        const boxes = getAdjacentBoxes(state, { r: 1, c: 1, type: 'vertical' });
        expect(boxes).toHaveLength(2);
    });
});

describe('analyzeMove', () => {
    test('detects completion when box has 3 sides', () => {
        let state = initializeGameState(2, 2);
        // Build 3 sides of box (0,0)
        state = calculateNewState(state, 2, 0, 0, 'horizontal'); // top
        state = calculateNewState(state, 2, 1, 0, 'horizontal'); // bottom (switches player)
        state = calculateNewState(state, 2, 0, 0, 'vertical');   // left

        // The 4th side should complete the box
        const analysis = analyzeMove(state, { r: 0, c: 1, type: 'vertical' });
        expect(analysis.completions).toBe(1);
    });

    test('detects dangerous move creating 3rd side', () => {
        let state = initializeGameState(2, 2);
        // Build 2 sides of box (0,0)
        state = calculateNewState(state, 2, 0, 0, 'horizontal'); // top
        state = calculateNewState(state, 2, 0, 0, 'vertical');   // left (switches to p2 then back since p1 didn't complete)

        // Adding 3rd side to box(0,0)
        const analysis = analyzeMove(state, { r: 1, c: 0, type: 'horizontal' });
        expect(analysis.opensThreeSide).toBeGreaterThanOrEqual(1);
    });
});

describe('chooseCPUMove', () => {
    test('easy returns a valid move', () => {
        const state = initializeGameState(3, 2);
        const move = chooseCPUMove(state, 'easy');
        expect(move).toBeDefined();
        expect(move).toHaveProperty('r');
        expect(move).toHaveProperty('c');
        expect(move).toHaveProperty('type');
        expect(['horizontal', 'vertical']).toContain(move.type);
    });

    test('medium returns a valid move', () => {
        const state = initializeGameState(3, 2);
        const move = chooseCPUMove(state, 'medium');
        expect(move).toBeDefined();
        expect(['horizontal', 'vertical']).toContain(move.type);
    });

    test('hard returns a valid move', () => {
        const state = initializeGameState(3, 2);
        const move = chooseCPUMove(state, 'hard');
        expect(move).toBeDefined();
        expect(['horizontal', 'vertical']).toContain(move.type);
    });

    test('defaults to medium if invalid difficulty', () => {
        const state = initializeGameState(3, 2);
        const move = chooseCPUMove(state, 'invalid');
        expect(move).toBeDefined();
    });

    test('returns null when no moves available', () => {
        // Create a fully completed game state
        let state = initializeGameState(2, 2);
        const moves = getValidMoves(state);
        // Play all moves
        for (const m of moves) {
            const newState = calculateNewState(state, 2, m.r, m.c, m.type);
            if (!newState.error) state = newState;
        }
        const result = chooseCPUMove(state, 'easy');
        expect(result).toBeNull();
    });

    test('medium/hard prioritizes completing a box', () => {
        let state = initializeGameState(2, 2);
        // Build 3 sides of box (0,0): top, left, bottom
        state = calculateNewState(state, 2, 0, 0, 'horizontal');
        state = calculateNewState(state, 2, 0, 0, 'vertical');
        state = calculateNewState(state, 2, 1, 0, 'horizontal');

        // Current player should have a box-completing move available
        for (const difficulty of ['medium', 'hard']) {
            const move = chooseCPUMove(state, difficulty);
            expect(move).toBeDefined();
            // The completing move is vertical at (0,1)
            expect(move.r).toBe(0);
            expect(move.c).toBe(1);
            expect(move.type).toBe('vertical');
        }
    });

    test('works with 3-player games', () => {
        const state = initializeGameState(3, 3);
        const move = chooseCPUMove(state, 'hard');
        expect(move).toBeDefined();
    });

    test('works with 4-player games', () => {
        const state = initializeGameState(4, 4);
        const move = chooseCPUMove(state, 'medium');
        expect(move).toBeDefined();
    });
});

describe('countChainLength', () => {
    test('returns 0 for a move with no 2-side adjacent boxes', () => {
        const state = initializeGameState(3, 2);
        const length = countChainLength(state, { r: 0, c: 0, type: 'horizontal' });
        expect(length).toBe(0);
    });

    test('counts chain of connected 2-side boxes', () => {
        let state = initializeGameState(2, 2);
        // Create a 2-side box at (0,0): top + left
        state = calculateNewState(state, 2, 0, 0, 'horizontal'); // top
        state = calculateNewState(state, 2, 0, 0, 'vertical');   // left

        // Adding bottom would make it 3 sides — the chain length from this move
        const length = countChainLength(state, { r: 1, c: 0, type: 'horizontal' });
        expect(length).toBeGreaterThanOrEqual(1);
    });
});

describe('CPU move produces valid game state transitions', () => {
    test('CPU move can be applied via calculateNewState', () => {
        const state = initializeGameState(3, 2);
        const move = chooseCPUMove(state, 'hard');
        expect(move).toBeDefined();

        const newState = calculateNewState(state, 3, move.r, move.c, move.type);
        expect(newState.error).toBeUndefined();
        expect(newState.horizontalLines).toBeDefined();
        expect(newState.verticalLines).toBeDefined();
    });

    test('multiple CPU moves in sequence produce valid states', () => {
        let state = initializeGameState(3, 2);
        for (let i = 0; i < 10; i++) {
            const move = chooseCPUMove(state, 'medium');
            if (!move) break;
            const newState = calculateNewState(state, 3, move.r, move.c, move.type);
            expect(newState.error).toBeUndefined();
            state = newState;
        }
    });

    test('full game simulation with hard CPU', () => {
        let state = initializeGameState(3, 2);
        let moveCount = 0;
        const maxMoves = 100; // safety limit

        while (!state.winner && moveCount < maxMoves) {
            const move = chooseCPUMove(state, 'hard');
            if (!move) break;
            const newState = calculateNewState(state, 3, move.r, move.c, move.type);
            expect(newState.error).toBeUndefined();
            state = newState;
            moveCount++;
        }

        // Game should finish (3x3 = 24 total lines)
        expect(state.winner).toBeDefined();
        expect(state.winner).not.toBeNull();
    });
});
