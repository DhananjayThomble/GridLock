const express = require('express');
const Joi = require('joi');
const { calculateNewState, initializeGameState } = require('../utils/gameLogic');
const { chooseCPUMove, getValidMoves } = require('../services/cpuPlayer');

const router = express.Router();
const GRID_SIZE = 3;

// Keep the opening, edge order and bot behavior of v1 stable for old links.
const initialState = initializeGameState(GRID_SIZE);
// Each of the 24 edges is encoded as one digit, horizontal edges first.
const edges = getValidMoves(initialState);
const openEdges = new Set('567bdehjln');
for (const [index, { type, r, c }] of edges.entries()) {
    if (!openEdges.has(index.toString(24))) initialState[`${type}Lines`][r][c] = 'preset';
}

const moveHistory = Joi.string().pattern(/^[0-9a-n]+$/).max(openEdges.size);
const requestSchema = Joi.object({
    moves: moveHistory.allow('').required(),
    referralMoves: moveHistory,
});

function applyMove(state, { type, r, c }) {
    return calculateNewState(state, GRID_SIZE, r, c, type);
}

function replay(moves) {
    let state = initialState;
    for (const edge of moves) {
        if (state.winner) return null;
        state = applyMove(state, edges[parseInt(edge, 24)]);
        if (state.error) return null;

        while (!state.winner && state.currentPlayer === 'player2') {
            state = applyMove(state, chooseCPUMove(state, 'hard', () => 0));
        }
    }
    return state;
}

// Only player moves travel over the wire. The server reconstructs the board and
// scores on every request, so links work without accounts or saved sessions.
router.post('/v1', (req, res) => {
    const { value, error } = requestSchema.required().validate(req.body);
    if (error) return res.status(400).json({ error: 'Invalid challenge moves' });

    const state = replay(value.moves);
    if (!state) return res.status(400).json({ error: 'Invalid challenge moves' });

    const referral = value.referralMoves ? replay(value.referralMoves) : null;
    return res.json({
        state,
        targetScore: referral?.winner ? referral.scores.player1 : null,
    });
});

module.exports = router;
