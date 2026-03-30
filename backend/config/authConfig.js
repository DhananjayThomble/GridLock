// config/authConfig.js

const GOOGLE_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
};

const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  expiresIn: '7d',
};

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'system', 'gridlock', 'null', 'undefined',
  'root', 'mod', 'moderator', 'support', 'help', 'api', 'www',
  'bot', 'official', 'staff', 'team', 'dev', 'test',
]);

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

module.exports = {
  GOOGLE_CONFIG,
  JWT_CONFIG,
  RESERVED_USERNAMES,
  ALLOWED_PATHS,
  validateReturnTo,
};
