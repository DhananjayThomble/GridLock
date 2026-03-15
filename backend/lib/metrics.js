/**
 * lib/metrics.js — Prometheus metrics for GridLock backend
 *
 * Uses prom-client to expose default Node.js metrics (CPU, memory, event loop lag, GC)
 * plus custom application-level gauges, counters, and histograms.
 *
 * Usage:
 *   const { metricsMiddleware, metricsEndpoint, metrics } = require('./lib/metrics');
 *   app.use(metricsMiddleware);          // track HTTP request metrics
 *   app.get('/metrics', metricsEndpoint); // expose Prometheus scrape endpoint
 *   metrics.activeGames.set(n);          // update custom gauges
 */
const client = require('prom-client');

// Collect default metrics (CPU, memory, event loop lag, GC, open handles, etc.)
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ── Custom metrics ──────────────────────────────────────────────────────────

const activeGames = new client.Gauge({
  name: 'gridlock_active_games',
  help: 'Number of active games currently in progress',
  registers: [register],
});

const connectedSockets = new client.Gauge({
  name: 'gridlock_connected_sockets',
  help: 'Number of currently connected Socket.IO clients',
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'gridlock_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const gameDurationSeconds = new client.Histogram({
  name: 'gridlock_game_duration_seconds',
  help: 'Duration of completed games in seconds',
  buckets: [10, 30, 60, 120, 300, 600, 1800],
  registers: [register],
});

const gamesCompletedTotal = new client.Counter({
  name: 'gridlock_games_completed_total',
  help: 'Total number of completed games',
  registers: [register],
});

// ── HTTP request tracking middleware ────────────────────────────────────────

/**
 * Express middleware that increments gridlock_http_requests_total on every response.
 * Path is normalized to avoid high-cardinality labels (e.g. /api/games/:id → /api/games/:id).
 */
function metricsMiddleware(req, res, next) {
  // Use the matched route pattern if available (lower cardinality), otherwise the raw path
  res.on('finish', () => {
    const route = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path}`
      : normalizePath(req.path);
    httpRequestsTotal.inc({
      method: req.method,
      path: route,
      status: res.statusCode,
    });
  });
  next();
}

/**
 * Normalize paths to prevent label explosion (e.g. /api/games/abc123 → /api/games/:id).
 * Strips query strings, replaces all ID-like segments (UUIDs, hex, numbers) regardless
 * of position, and buckets unrecognized paths as /other to prevent cardinality explosion.
 */
const KNOWN_PATH_PREFIXES = ['/api/', '/health', '/metrics', '/socket.io'];

function normalizePath(p) {
  // Strip query strings before normalization
  const path = p.split('?')[0];

  const normalized = path
    // Replace UUID-like segments (8-4-4-4-12 hex)
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    // Replace hex segments (6+ chars) at any position
    .replace(/\/[a-f0-9]{6,}/gi, '/:id')
    // Replace pure numeric segments at any position
    .replace(/\/\d+/g, '/:id');

  // Catch-all: bucket unrecognized paths to prevent unique label leaks
  if (!KNOWN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix)) && normalized !== '/') {
    return '/other';
  }

  return normalized;
}

// ── Metrics endpoint handler ────────────────────────────────────────────────

async function metricsEndpoint(_req, res) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
}

module.exports = {
  register,
  metricsMiddleware,
  metricsEndpoint,
  metrics: {
    activeGames,
    connectedSockets,
    gameDurationSeconds,
    gamesCompletedTotal,
    httpRequestsTotal,
  },
};
