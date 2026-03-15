/**
 * Check if a request originates from an internal/private IP.
 * Uses X-Real-IP header (set by Nginx from $remote_addr, not spoofable by clients)
 * rather than X-Forwarded-For (client-spoofable).
 *
 * ⚠️  SECURITY NOTE: This middleware is designed to run behind Nginx, which
 * overwrites X-Real-IP with the actual client $remote_addr — making it
 * trustworthy. If Express is accessed directly (bypassing Nginx), a client
 * could spoof the X-Real-IP header. Direct Express access MUST be firewalled
 * in production. See nginx/gridlock.conf for the hardening configuration.
 */

const INTERNAL_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^::1$/,
    /^::ffff:127\./,
    /^::ffff:10\./,
    /^::ffff:192\.168\./,
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
    /^localhost$/,
];

function isInternalRequest(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    // Trust X-Real-IP from Nginx (which sets it from $remote_addr)
    // Do NOT use X-Forwarded-For — it's client-spoofable
    const realIp = req.headers['x-real-ip'] || ip;
    return INTERNAL_PATTERNS.some(p => p.test(realIp));
}

module.exports = { isInternalRequest };
