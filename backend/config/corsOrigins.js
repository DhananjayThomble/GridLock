/**
 * Shared CORS origin allowlist.
 * Used by server.js and CORS tests to avoid duplication.
 */
const DEFAULT_ORIGINS = [
    'https://gridlock.pro',
    'https://www.gridlock.pro',
    'https://beta.gridlock.pro',
    'http://localhost:5173',    // Vite dev
    'http://localhost:4173',    // Vite preview
    'http://localhost:4175',    // E2E local test
];

function getAllowedOrigins() {
    return process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
        : DEFAULT_ORIGINS;
}

module.exports = { DEFAULT_ORIGINS, getAllowedOrigins };
