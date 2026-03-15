/**
 * lib/sentry.js — Sentry error tracking for GridLock backend
 *
 * Initializes Sentry only when SENTRY_DSN is set, so the app starts fine without it.
 * Must be required early in server.js (before other imports that Sentry needs to patch).
 *
 * Usage:
 *   const sentry = require('./lib/sentry');
 *   // ... define routes ...
 *   app.use(sentry.errorHandler());  // after all routes
 */
const Sentry = require('@sentry/node');
// Intentional: version from package.json is used for Sentry release tracking.
// This allows correlating errors with specific deployed versions in the Sentry dashboard.
const { version } = require('../package.json');

let initialized = false;

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: `gridlock-backend@${version}`,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Don't send PII by default
    sendDefaultPii: false,
  });
  initialized = true;
  // Intentional console.log: Sentry must initialize before the app logger (which Sentry patches),
  // so the structured logger is not available here.
  console.log('[Sentry] Initialized (env:', process.env.NODE_ENV || 'development', ')');
} else {
  // See note above — console.log is intentional at this init stage.
  console.log('[Sentry] SENTRY_DSN not set — error tracking disabled');
}

// Capture unhandled rejections and exceptions via Sentry (if initialized)
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
  if (initialized) Sentry.captureException(reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  if (initialized) {
    Sentry.captureException(err);
    // Intentional: process.exit(1) is called here instead of deferring to gracefulShutdown
    // because sentry.js is loaded before server.js, so the graceful shutdown handler
    // (which depends on server/io/redis/mongo instances) is not available at this point.
    // After an uncaught exception, the process state is unreliable — the safest action
    // is to flush Sentry events and exit immediately. PM2/systemd will restart the process.
    Sentry.close(2000).finally(() => process.exit(1));
  }
});

/**
 * Express error-handling middleware.
 * Place after all routes: app.use(sentry.errorHandler())
 */
function errorHandler() {
  if (initialized) {
    return Sentry.setupExpressErrorHandler
      ? (err, req, res, next) => {
          Sentry.captureException(err);
          next(err);
        }
      : (err, _req, _res, next) => next(err);
  }
  // No-op middleware when Sentry is not initialized
  return (err, _req, _res, next) => next(err);
}

module.exports = {
  Sentry,
  initialized,
  errorHandler,
};
