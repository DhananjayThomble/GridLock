// backend/middleware/payloadValidator.js
// Joi-based payload validation schemas for all socket events

const Joi = require('joi');

// ─── Shared field schemas ────────────────────────────────────────────────────

const usernameField = Joi.string().trim().min(1).max(30).required()
    .messages({ 'string.empty': 'Username is required', 'any.required': 'Username is required' });

const avatarField = Joi.string().trim().max(8).optional().default('👦');

const gameIdField = Joi.string().trim().pattern(/^[A-Za-z0-9]{4,8}$/).required()
    .messages({ 'string.pattern.base': 'Invalid Game ID format', 'any.required': 'Game ID is required' });

const sessionTokenField = Joi.string().trim().min(1).required()
    .messages({ 'any.required': 'Session token is required' });

const gridSizeField = Joi.number().integer().min(2).max(10).required()
    .messages({ 'number.min': 'Grid size must be between 2 and 10', 'number.max': 'Grid size must be between 2 and 10' });

const playerCountField = Joi.number().integer().min(2).max(4).required()
    .messages({ 'number.min': 'Player count must be between 2 and 4', 'number.max': 'Player count must be between 2 and 4' });

// ─── Event-specific schemas ──────────────────────────────────────────────────

/** @type {Record<string, Joi.ObjectSchema>} */
const schemas = {
    create_game: Joi.object({
        gridSize: gridSizeField,
        username: usernameField,
        avatar: avatarField,
        playerCount: playerCountField.optional().default(2),
        cpuPlayers: Joi.number().integer().min(0).max(3).optional().default(0),
        cpuDifficulty: Joi.string().valid('easy', 'medium', 'hard').optional().default('medium'),
    }),

    join_game: Joi.object({
        gameId: gameIdField,
        username: usernameField,
        avatar: avatarField,
        sessionToken: Joi.string().trim().allow('', null).optional(),
        joinMode: Joi.string().valid('player', 'spectator').optional(),
    }),

    make_move: Joi.object({
        gameId: gameIdField,
        playerId: Joi.string().pattern(/^player[1-4]$/).required()
            .messages({ 'string.pattern.base': 'Invalid player ID' }),
        sessionToken: sessionTokenField,
        type: Joi.string().valid('horizontal', 'vertical').required()
            .messages({ 'any.only': 'Move type must be horizontal or vertical' }),
        r: Joi.number().integer().min(0).max(20).required(),
        c: Joi.number().integer().min(0).max(20).required(),
    }),

    request_rematch: Joi.object({
        gameId: gameIdField,
        sessionToken: sessionTokenField,
    }),

    rematch_cancel: Joi.object({
        gameId: gameIdField,
        sessionToken: sessionTokenField,
    }),

    queue_join: Joi.object({
        username: usernameField,
        avatar: avatarField,
        gridSize: gridSizeField,
        playerCount: playerCountField,
    }),

    create_tournament: Joi.object({
        username: usernameField,
        avatar: avatarField,
        tournamentSize: Joi.number().integer().valid(4, 8).optional().default(4),
        gridSize: gridSizeField.optional().default(3),
    }),

    join_tournament: Joi.object({
        tournamentId: Joi.string().trim().pattern(/^T[A-Z0-9]{5}$/).required()
            .messages({ 'string.pattern.base': 'Invalid tournament ID format' }),
        username: usernameField,
        avatar: avatarField,
    }),
};

/**
 * Validate a socket event payload against its schema.
 * Returns { valid: true, value } on success or { valid: false, error } on failure.
 *
 * @param {string} eventName - Socket event name
 * @param {*} payload - Raw payload from client
 * @returns {{ valid: boolean, value?: object, error?: string }}
 */
function validatePayload(eventName, payload) {
    const schema = schemas[eventName];
    if (!schema) return { valid: true, value: payload || {} };

    if (!payload || typeof payload !== 'object') {
        return { valid: false, error: 'Invalid payload: expected an object' };
    }

    const { error, value } = schema.validate(payload, {
        abortEarly: true,
        stripUnknown: true,
        convert: true,
    });

    if (error) {
        return { valid: false, error: error.details[0]?.message || 'Invalid payload' };
    }

    return { valid: true, value };
}

module.exports = {
    schemas,
    validatePayload,
};
