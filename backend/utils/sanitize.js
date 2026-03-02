// backend/utils/sanitize.js
// Input sanitization utilities to prevent XSS

const validator = require('validator');

/**
 * Sanitize a username string
 * - Trim whitespace
 * - Remove low/control characters and HTML-escape dangerous chars
 * - Limit length
 * - Reject empty after sanitization
 * @param {string} input - Raw username
 * @returns {{ valid: boolean, value: string, error?: string }}
 */
function sanitizeUsername(input) {
    if (!input || typeof input !== 'string') {
        return { valid: false, value: '', error: 'Username is required' };
    }

    let cleaned = input.trim();

    // Remove control characters and HTML-escape dangerous symbols
    cleaned = validator.stripLow(cleaned, /* keep_newlines */ false);
    cleaned = validator.escape(cleaned); // escape &, <, >, ", '

    // Unescape safe chars back (emoji, unicode letters are fine after escape)
    // Actually, we want the escaped version stored server-side.
    // The frontend should render escaped text safely.

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
 * Sanitize avatar string
 * - Must be a single emoji or short string
 * - Max 8 chars (accounts for multi-byte emoji)
 * @param {string} input - Raw avatar
 * @returns {string} Sanitized avatar or default
 */
function sanitizeAvatar(input) {
    if (!input || typeof input !== 'string') return '👦';
    
    let cleaned = input.trim();
    cleaned = validator.stripLow(cleaned, false);
    
    // Remove any HTML-like content
    cleaned = cleaned.replace(/<[^>]*>/g, '');
    
    if (cleaned.length === 0 || cleaned.length > 8) return '👦';
    return cleaned;
}

/**
 * Sanitize game ID
 * - Must be alphanumeric uppercase, 4-8 chars
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
 * Validate numeric input within range
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

module.exports = {
    sanitizeUsername,
    sanitizeAvatar,
    sanitizeGameId,
    validateNumber,
};
