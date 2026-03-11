// routes/healthcheck.js — Deep health check for post-deploy verification
const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const Leaderboard = require('../models/Leaderboard');

const router = express.Router();

// Stricter rate limiter for deep health checks (expensive DB queries)
const deepHealthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5,                   // 5 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many deep health check requests, please try again later.' },
});

/**
 * Sanitize error messages to avoid leaking internals in production.
 * Returns the full message in development/test, generic string otherwise.
 */
function sanitizeError(err) {
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return err.message;
  }
  return 'check failed';
}

/**
 * GET /health/deep
 *
 * Unlike the lightweight /health (for load balancers), this endpoint actually
 * verifies the system works: MongoDB connectivity, read capability, and
 * Socket.IO server status. Returns 200 if all pass, 503 if any fail.
 *
 * Designed to be called by deploy scripts to catch issues like the 2026-03-11
 * incident where /health returned ok while mongoose was completely broken.
 */
router.get('/deep', deepHealthLimiter, async (req, res) => {
  const checks = {};
  let allPassed = true;
  const start = Date.now();

  // 1. MongoDB ping — verifies the connection is alive
  try {
    const pingStart = Date.now();
    await mongoose.connection.db.admin().ping();
    checks.mongoPing = { status: 'pass', latencyMs: Date.now() - pingStart };
  } catch (err) {
    checks.mongoPing = { status: 'fail', error: sanitizeError(err) };
    allPassed = false;
  }

  // 2. MongoDB read — verifies we can actually query a collection
  try {
    const readStart = Date.now();
    await Leaderboard.findOne().lean().maxTimeMS(2000);
    checks.mongoRead = { status: 'pass', latencyMs: Date.now() - readStart };
  } catch (err) {
    checks.mongoRead = { status: 'fail', error: sanitizeError(err) };
    allPassed = false;
  }

  // 3. Socket.IO server status — verifies the WS server is attached and running
  try {
    const io = req.app.locals.io;
    if (!io) {
      throw new Error('Socket.IO server not attached to app');
    }
    // Verify engine exists and is functional
    if (!io.engine) {
      throw new Error('Socket.IO engine not initialized');
    }
    checks.socketIO = {
      status: 'pass',
      connectedClients: io.engine.clientsCount || 0,
    };
  } catch (err) {
    checks.socketIO = { status: 'fail', error: sanitizeError(err) };
    allPassed = false;
  }

  const status = allPassed ? 200 : 503;
  res.status(status).json({
    status: allPassed ? 'ok' : 'degraded',
    checks,
    totalLatencyMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
