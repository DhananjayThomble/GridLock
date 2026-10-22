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

    // Remove control characters
    cleaned = validator.stripLow(cleaned, /* keep_newlines */ false);

    // Check empty after trim + stripLow (pure whitespace/control chars)
    if (cleaned.length === 0) {
        return { valid: false, value: '', error: 'Username cannot be empty' };
    }

    // Strip ALL HTML tags BEFORE escaping — reject script/img/etc. entirely
    cleaned = cleaned.replace(/<[^>]*>/g, '');

    // Nested input such as "<scr<b>ipt>" can leave a tag behind after one pass; reject any leftover angle bracket
    if (/[<>]/.test(cleaned)) {
        return { valid: false, value: '', error: 'Username contains invalid characters' };
    }

    // If stripping tags left nothing, the input was purely malicious
    if (cleaned.length === 0) {
        return { valid: false, value: '', error: 'Username contains invalid characters' };
    }

    // Allowlist: unicode letters, numbers, combining marks, spaces, hyphens, underscores, emoji
    // \p{M} covers combining marks (vowel signs, viramas, tone marks) for Devanagari, Thai, Arabic, etc.
    // Uses Emoji_Presentation only (not \p{Emoji} which also matches #, *, ©, ® etc.)
    const allowlistPattern = /^[\p{L}\p{N}\p{M}\p{Emoji_Presentation}\s\-_]+$/u;
    if (!allowlistPattern.test(cleaned)) {
        return { valid: false, value: '', error: 'Username contains invalid characters' };
    }

    // Length check (truncate BEFORE escape to avoid splitting HTML entities)
    if (cleaned.length > 20) {
        cleaned = cleaned.substring(0, 20);
    }

    // Defense-in-depth: escape any remaining dangerous chars
    cleaned = validator.escape(cleaned);

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

    // Nested input can leave a tag behind after one pass; fall back to the default avatar
    if (/[<>]/.test(cleaned)) return '👦';

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
