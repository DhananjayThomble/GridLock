// config/authConfig.js

const GOOGLE_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
};

const JWT_CONFIG = {
  get secret() { return process.env.JWT_SECRET; },
  expiresIn: '7d',
};

// Fix #11: Added 'auth' and 'login' to reserved list
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'system', 'gridlock', 'null', 'undefined',
  'root', 'mod', 'moderator', 'support', 'help', 'api', 'www',
  'bot', 'official', 'staff', 'team', 'dev', 'test',
  'auth', 'login',
]);

// Fix #10: Query strings in returnTo are intentionally rejected for security.
// The regex only allows path characters (letters, digits, /, _, -).
// This prevents open-redirect attacks via crafted query parameters (e.g.,
// returnTo=/?redirect=https://evil.com). If the frontend ever needs query
// params in returnTo, add explicit allowlisting for known safe params.
const ALLOWED_PATHS = /^\/[a-zA-Z0-9/_-]*$/;

/**
 * Validate returnTo param — only relative paths allowed.
 * @param {string} path
 * @returns {string} Validated path or '/'
 */
function validateReturnTo(path) {
  if (!path) return '/';
  if (!ALLOWED_PATHS.test(path)) return '/';
  return path;
}

// Fix #8: Shared cookie options used across auth middleware and routes.
// Production sets domain to .gridlock.pro for cross-subdomain cookies.
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
  domain: process.env.NODE_ENV === 'production' ? '.gridlock.pro' : undefined,
};

// For clearCookie, only domain and path matter (other flags are ignored by browsers)
const CLEAR_COOKIE_OPTS = { domain: COOKIE_OPTIONS.domain, path: COOKIE_OPTIONS.path };

module.exports = {
  GOOGLE_CONFIG,
  JWT_CONFIG,
  RESERVED_USERNAMES,
  ALLOWED_PATHS,
  validateReturnTo,
  COOKIE_OPTIONS,
  CLEAR_COOKIE_OPTS,
};
