/**
 * Lightweight frontend logger with level filtering.
 *
 * - In production builds (`import.meta.env.PROD`): only warn + error are emitted.
 * - In dev builds: all levels are emitted (debug, info, warn, error).
 * - All messages are prefixed with [GridLock] for easy DevTools filtering.
 *
 * Usage:
 *   import log from '@/lib/logger';   // or relative path
 *   log.info('socket:connected', { transport: 'websocket' });
 *   log.warn('liveness:timeout', { elapsed: 5000 });
 *   log.error('reconnect:failed', { attempts: 20 });
 *   log.debug('freeze:detected', { elapsed: 30000 });
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Production: suppress debug/info (noisy lifecycle logs leak internal state in DevTools).
// Development: show everything.
const minLevel = import.meta.env.PROD ? LOG_LEVELS.warn : LOG_LEVELS.debug;

function emit(level, method, tag, data) {
  if (LOG_LEVELS[level] < minLevel) return;
  if (data !== undefined) {
    method(`[GridLock] ${tag}`, data);
  } else {
    method(`[GridLock] ${tag}`);
  }
}

const log = {
  debug: (tag, data) => emit('debug', console.log, tag, data),
  info:  (tag, data) => emit('info',  console.log, tag, data),
  warn:  (tag, data) => emit('warn',  console.warn, tag, data),
  error: (tag, data) => emit('error', console.error, tag, data),
};

export default log;
