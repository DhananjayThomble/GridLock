// backend/utils/sanitize.js
// Input sanitization utilities to prevent XSS

const validator = require('validator');

/**
 * Sanitize a username string.
 * - Trim whitespace
 * - Remove low/control characters and HTML-escape dangerous chars
 * - Strip null bytes and unicode control characters
 * - Limit length
 * - Reject empty after sanitization
 *
 * @param {string} input - Raw username
 * @returns {{ valid: boolean, value: string, error?: string }}
 */
function sanitizeUsername(input) {
    if (!input || typeof input !== 'string') {
        return { valid: false, value: '', error: 'Username is required' };
    }

    let cleaned = input.trim();

    // Remove null bytes (potential bypass)
    cleaned = cleaned.replace(/\0/g, '');

    // Remove unicode control characters (C0, C1, and other categories)
    // eslint-disable-next-line no-control-regex
    cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');

    // Remove control characters and HTML-escape dangerous symbols
    cleaned = validator.stripLow(cleaned, /* keep_newlines */ false);
    cleaned = validator.escape(cleaned); // escape &, <, >, ", '

    // Length check
    if (cleaned.length === 0) {
        return { valid: false, value: '', error: 'Username cannot be empty' };
    }
    if (cleaned.length > 20) {
        cleaned = cleaned.substring(0, 20);
    }

    return { valid: true, value: cleaned };
}

/**
 * Sanitize avatar string.
 * - Must be a single emoji or short string
 * - Max 8 chars (accounts for multi-byte emoji)
 * - Strips HTML tags, control chars, and null bytes
 *
 * @param {string} input - Raw avatar
 * @returns {string} Sanitized avatar or default
 */
function sanitizeAvatar(input) {
    if (!input || typeof input !== 'string') return '👦';

    let cleaned = input.trim();

    // Remove null bytes
    cleaned = cleaned.replace(/\0/g, '');

    cleaned = validator.stripLow(cleaned, false);

    // Remove any HTML-like content
    cleaned = cleaned.replace(/<[^>]*>/g, '');

    // Remove script-style event attributes (belt and suspenders)
    cleaned = cleaned.replace(/on\w+\s*=/gi, '');

    if (cleaned.length === 0 || cleaned.length > 8) return '👦';
    return cleaned;
}

/**
 * Sanitize game ID.
 * - Must be alphanumeric uppercase, 4-8 chars
 *
 * @param {string} input - Raw game ID
 * @returns {{ valid: boolean, value: string, error?: string }}
 */
function sanitizeGameId(input) {
    if (!input || typeof input !== 'string') {
        return { valid: false, value: '', error: 'Game ID is required' };
    }

    const cleaned = input.trim().toUpperCase();

    if (!/^[A-Z0-9]{4,8}$/.test(cleaned)) {
        return { valid: false, value: '', error: 'Invalid Game ID format' };
    }

    return { valid: true, value: cleaned };
}

/**
 * Validate numeric input within range.
 *
 * @param {*} input - Raw input
 * @param {number} min
 * @param {number} max
 * @param {string} name - Field name for error messages
 * @returns {{ valid: boolean, value: number, error?: string }}
 */
function validateNumber(input, min, max, name) {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < min || num > max) {
        return { valid: false, value: 0, error: `${name} must be between ${min} and ${max}` };
    }
    return { valid: true, value: num };
}

/**
 * Sanitize a generic text string for safe display.
 * Escapes HTML entities and removes control characters.
 *
 * @param {string} input - Raw text
 * @param {number} [maxLength=200] - Maximum allowed length
 * @returns {string} Sanitized text
 */
function sanitizeText(input, maxLength = 200) {
    if (!input || typeof input !== 'string') return '';

    let cleaned = input.trim();
    cleaned = cleaned.replace(/\0/g, '');
    // eslint-disable-next-line no-control-regex
    cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
    cleaned = validator.stripLow(cleaned, false);
    cleaned = validator.escape(cleaned);

    if (cleaned.length > maxLength) {
        cleaned = cleaned.substring(0, maxLength);
    }

    return cleaned;
}

module.exports = {
    sanitizeUsername,
    sanitizeAvatar,
    sanitizeGameId,
    validateNumber,
    sanitizeText,
};
