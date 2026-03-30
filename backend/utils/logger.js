/**
 * Structured logger — centralised logging with levels + timestamps.
 *
 * Usage:
 *   const log = require('./utils/logger');   // from routes/controllers
 *   const log = require('../utils/logger');   // adjust path as needed
 *   log.error('[Context] message', error);
 *
 * Set LOG_LEVEL env var to DEBUG | INFO | WARN | ERROR (default: DEBUG).
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LOG_LEVEL = (process.env.LOG_LEVEL || 'DEBUG').toUpperCase();
const currentLevel = LOG_LEVELS[LOG_LEVEL] ?? 0;

const log = {
  debug: (...args) => currentLevel <= 0 && console.log('[DEBUG]', new Date().toISOString(), ...args),
  info:  (...args) => currentLevel <= 1 && console.log('[INFO]',  new Date().toISOString(), ...args),
  warn:  (...args) => currentLevel <= 2 && console.warn('[WARN]', new Date().toISOString(), ...args),
  error: (...args) => currentLevel <= 3 && console.error('[ERROR]', new Date().toISOString(), ...args),
};

module.exports = log;
