// middleware/auth.js

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { COOKIE_OPTIONS } = require('../config/authConfig');

// For clearCookie, only domain and path matter
const CLEAR_COOKIE_OPTS = { domain: COOKIE_OPTIONS.domain, path: COOKIE_OPTIONS.path };

/**
 * Attaches req.user if a valid JWT cookie is present.
 * Does NOT reject unauthenticated requests — passes through.
 */
async function optionalAuth(req, res, next) {
  const token = req.cookies?.gridlock_token;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).lean();
    if (user) {
      req.user = user;
    } else {
      // Fix #5: User deleted — clear stale cookie to avoid repeated
      // JWT verify -> DB lookup -> find nothing on every request until expiry
      res.clearCookie('gridlock_token', CLEAR_COOKIE_OPTS);
    }
  } catch (err) {
    // Invalid/expired token — treat as guest, clear stale cookie
    res.clearCookie('gridlock_token', CLEAR_COOKIE_OPTS);
  }
  next();
}

/**
 * Requires authentication. Returns 401 if no valid token.
 */
async function requireAuth(req, res, next) {
  const token = req.cookies?.gridlock_token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).lean();
    if (!user) {
      res.clearCookie('gridlock_token', CLEAR_COOKIE_OPTS);
      return res.status(401).json({ success: false, error: 'Account not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.clearCookie('gridlock_token', CLEAR_COOKIE_OPTS);
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * CSRF header check for state-changing endpoints.
 * Requires X-Requested-With: XMLHttpRequest header.
 */
function csrfHeader(req, res, next) {
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ success: false, error: 'Missing required header' });
  }
  next();
}

module.exports = { optionalAuth, requireAuth, csrfHeader };
