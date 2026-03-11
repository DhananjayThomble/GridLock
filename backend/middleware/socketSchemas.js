// backend/middleware/socketSchemas.js
// Joi validation schemas for all socket event payloads

const Joi = require('joi');

// ─── Shared field schemas ────────────────────────────────────────────────────

const usernameField = Joi.string().trim().min(1).max(30).required();
const avatarField = Joi.string().trim().max(8).allow('', null).optional();
const gameIdField = Joi.string().trim().alphanum().min(4).max(8).required();
const sessionTokenField = Joi.string().trim().hex().length(48).required();
// Max grid size matches frontend GRID_OPTIONS (3–6). Backend game logic supports up to 6.
const gridSizeField = Joi.number().integer().min(2).max(6).required();
const playerCountField = Joi.number().integer().min(2).max(4).optional().default(2);

// ─── Event schemas ───────────────────────────────────────────────────────────

const schemas = {
    create_game: Joi.object({
        gridSize: gridSizeField,
        username: usernameField,
        avatar: avatarField,
        playerCount: playerCountField,
        cpuPlayers: Joi.number().integer().min(0).max(3).optional().default(0),
        cpuDifficulty: Joi.string().valid('easy', 'medium', 'hard').optional().default('medium'),
    }),

    join_game: Joi.object({
        gameId: gameIdField,
        username: usernameField,
        avatar: avatarField,
        sessionToken: Joi.string().trim().hex().length(48).allow('', null).optional(),
        joinMode: Joi.string().valid('player', 'spectator').optional(),
    }),

    make_move: Joi.object({
        gameId: gameIdField,
        playerId: Joi.string().pattern(/^player[1-4]$/).required(),
        sessionToken: sessionTokenField,
        type: Joi.string().valid('horizontal', 'vertical').required(),
        // Max coordinate derived from max grid size (6): lines span 0..gridSize, so max index = 6
        r: Joi.number().integer().min(0).max(6).required(),
        c: Joi.number().integer().min(0).max(6).required(),
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
        gridSize: Joi.number().integer().min(2).max(6).optional().default(3),
    }),

    join_tournament: Joi.object({
        // Tournament IDs are generated as "T" + 5 uppercase hex chars (e.g., "TA3F2B").
        // Using alphanum().length(6) to match — case-insensitive input is uppercased by the handler.
        tournamentId: Joi.string().trim().alphanum().length(6).required(),
        username: usernameField,
        avatar: avatarField,
    }),
};

/**
 * Map Joi validation error types to generic, client-safe messages.
 * Detailed schema information is logged server-side only — never sent to clients.
 */
const GENERIC_VALIDATION_MESSAGES = {
    'any.required':     'A required field is missing.',
    'string.empty':     'A required field is empty.',
    'string.min':       'A field value is too short.',
    'string.max':       'A field value is too long.',
    'string.pattern.base': 'A field has an invalid format.',
    'string.alphanum':  'A field contains invalid characters.',
    'string.hex':       'A field has an invalid format.',
    'string.length':    'A field has an invalid length.',
    'number.base':      'A field must be a number.',
    'number.min':       'A numeric value is too low.',
    'number.max':       'A numeric value is too high.',
    'number.integer':   'A field must be a whole number.',
    'any.only':         'A field has an invalid value.',
    'object.unknown':   'Unexpected fields in payload.',
};

/**
 * Validate a socket event payload against its schema.
 * @param {string} eventName
 * @param {*} payload
 * @returns {{ valid: boolean, value?: object, error?: string, detailedError?: string }}
 */
function validatePayload(eventName, payload) {
    const schema = schemas[eventName];
    if (!schema) return { valid: true, value: payload }; // No schema = pass through

    if (payload === null || payload === undefined || typeof payload !== 'object') {
        return { valid: false, error: `Invalid payload for ${eventName}: expected an object` };
    }

    const { error, value } = schema.validate(payload, {
        abortEarly: true,
        stripUnknown: true, // Remove unexpected fields
        convert: true,       // Allow type coercion (e.g., string "3" → number 3)
    });

    if (error) {
        const detail = error.details[0];
        const joiType = detail?.type || 'unknown';
        // Generic message for clients; detailed error kept for server-side logging
        const clientMessage = GENERIC_VALIDATION_MESSAGES[joiType] || 'Invalid request. Please check your input.';
        const detailedError = detail?.message || 'Validation error';
        return { valid: false, error: clientMessage, detailedError };
    }

    return { valid: true, value };
}

module.exports = { schemas, validatePayload };
