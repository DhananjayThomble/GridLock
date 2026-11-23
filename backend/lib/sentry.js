// Load runtime settings before instrumenting Express, HTTP and MongoDB.
require('dotenv').config({ quiet: true });

const Sentry = require('@sentry/node');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');
const { productionDsn } = require('../../config/sentry.json');

const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
const dsn = process.env.SENTRY_DSN ?? (environment === 'production' ? productionDsn : '');
const initialized = Boolean(dsn) && process.env.NODE_ENV !== 'test';

function release() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
    }).trim();
    return `gridlock@${commit}`;
  } catch {
    return `gridlock-backend@${version}`;
  }
}

function traceRate(value, fallback) {
  const rate = Number(value);
  return value?.trim() && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
}

if (initialized) {
  Sentry.init({
    dsn,
    environment,
    release: release(),
    tracesSampleRate: traceRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
    sendDefaultPii: false,
    enableLogs: true,
    ignoreSpans: [/\/(health|metrics)(?:\/|$|\?)/],
    // App logs are sent explicitly. Console breadcrumbs may contain request data.
    integrations: (defaults) => [
      ...defaults.filter(({ name }) =>
        !['Console', 'ContextLines', 'LocalVariables', 'NodeRuntimeMetrics'].includes(name)),
      Sentry.nodeRuntimeMetricsIntegration(),
    ],
    beforeSend(event) {
      if (event.request) event.request = { method: event.request.method };
      delete event.user;
      delete event.extra;
      delete event.breadcrumbs;
      if (event.tags?.operation) {
        for (const exception of event.exception?.values || []) {
          exception.value = `Unexpected failure in ${event.tags.operation}`;
        }
      }
      return event;
    },
    beforeSendSpan(span) {
      const { attributes = {} } = span;
      for (const key of Object.keys(attributes)) {
        if (/^(?:db\.|url\.|http\.(?:url|target|request\.header|response\.header)|client\.|user\.)/.test(key)
            && !['db.system', 'db.system.name', 'db.operation.name'].includes(key)) {
          delete attributes[key];
        }
      }
      if (/^db\./.test(attributes['sentry.op'] || '')) {
        span.name = attributes['db.operation.name'] || 'Database operation';
      } else if (/\bhttps?:\/\//.test(span.name)) {
        span.name = attributes['http.request.method'] || 'HTTP request';
      } else {
        span.name = span.name?.split('?')[0];
      }
      return span;
    },
  });
}

function registerExpressErrorHandler(app) {
  if (initialized) Sentry.setupExpressErrorHandler(app);
}

function operationalLog(level, message, attributes) {
  if (initialized) Sentry.logger[level](message, attributes);
}

function captureOperationalFailure(error, operation) {
  if (!initialized) return;
  Sentry.captureException(error, { tags: { operation }, level: 'error' });
  operationalLog('error', 'Application operation failed', { operation, failure_type: error.name });
}

module.exports = { Sentry, initialized, operationalLog, captureOperationalFailure, registerExpressErrorHandler };
