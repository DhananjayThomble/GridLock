/**
 * Check if a request originates from an internal/private IP.
 *
 * Security model:
 * - X-Real-IP is only trusted when the direct TCP connection (socket.remoteAddress)
 *   comes from an internal IP (i.e., Nginx on localhost). This prevents spoofing
 *   if Express is accidentally exposed directly to the internet.
 * - X-Forwarded-For is never used (client-spoofable even behind a proxy).
 *
 * ⚠️  This middleware is designed to run behind Nginx, which overwrites X-Real-IP
 * with the actual client $remote_addr. Direct Express access MUST be firewalled
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

function isInternal(ip) {
    return INTERNAL_PATTERNS.some(p => p.test(ip));
}

function isInternalRequest(req) {
    const socketIp = req.socket?.remoteAddress || req.ip || '';

    // Only trust X-Real-IP if the direct connection is from an internal source
    // (i.e., the request came through Nginx on localhost, not directly from the internet)
    if (isInternal(socketIp) && req.headers['x-real-ip']) {
        return isInternal(req.headers['x-real-ip']);
    }

    return isInternal(socketIp);
}

module.exports = { isInternalRequest };
