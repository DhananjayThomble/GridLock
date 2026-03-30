// routes/daily.js
// Daily challenge API endpoints
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const DailyChallenge = require('../models/DailyChallenge');
const DailyResult = require('../models/DailyResult');
const { sanitizeUsername } = require('../utils/sanitize');
const log = require('../utils/logger');
const {
  LAUNCH_DATE,
  DEFAULT_GRID_SIZE,
  getTodayDateStr,
  getDayNumber,
  seededRng,
  dateSeed,
  generateBoardFromSeed,
} = require('../utils/dailyHelpers');

// ── Rate limiters ────────────────────────────────────────────────────────────

// Issue #6: rate limit result submission — max 5 per minute per IP
const resultRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get or create today's challenge document.
 * Uses findOneAndUpdate + upsert to avoid race conditions (Issue #4).
 * @param {string} [dateStr] - Optional date override
 * @returns {Promise<Object>}
 */
async function getOrCreateChallenge(dateStr) {
  const date = dateStr || getTodayDateStr();
  const dayNumber = getDayNumber(date);

  // Issue #4: atomic upsert — no race condition on concurrent requests
  const challenge = await DailyChallenge.findOneAndUpdate(
    { date },
    { $setOnInsert: { seed: date, gridSize: DEFAULT_GRID_SIZE, dayNumber } },
    { upsert: true, new: true }
  );
  return challenge;
}

// ── Joi Schemas ──────────────────────────────────────────────────────────────

const resultSchema = Joi.object({
  username: Joi.string().trim().min(2).max(20).required(),
  score: Joi.number().integer().min(0).required(),
  moves: Joi.number().integer().min(0).required(),
  duration: Joi.number().min(0).required(),
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
});

const leaderboardQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  username: Joi.string().trim().min(2).max(20).optional(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/daily/today
 * Returns today's challenge info + whether the user already played.
 * Query param: ?username=xxx
 * Issue #5: seed is NOT returned to the client.
 */
router.get('/today', async (req, res) => {
  try {
    const challenge = await getOrCreateChallenge();
    const board = generateBoardFromSeed(challenge.date, challenge.gridSize);

    let alreadyPlayed = false;
    let existingResult = null;
    if (req.query.username) {
      const san = sanitizeUsername(req.query.username);
      if (san.valid) {
        existingResult = await DailyResult.findOne({
          date: challenge.date,
          username: san.value,
        }).lean();
        alreadyPlayed = !!existingResult;
      }
    }

    // Calculate countdown to next midnight UTC
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const nextPuzzleIn = tomorrow - now; // ms

    res.json({
      success: true,
      challenge: {
        date: challenge.date,
        dayNumber: challenge.dayNumber,
        gridSize: challenge.gridSize,
        // Issue #5: seed removed — only send board, date, dayNumber, gridSize
        board,
      },
      alreadyPlayed,
      existingResult: existingResult
        ? {
            score: existingResult.score,
            moves: existingResult.moves,
            duration: existingResult.duration,
            completedAt: existingResult.completedAt,
          }
        : null,
      nextPuzzleIn,
    });
  } catch (error) {
    log.error('[Daily] GET /today error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch daily challenge' });
  }
});

/**
 * GET /api/daily/leaderboard
 * Top-10 mini-leaderboard for a given date (defaults to today).
 * Query params: ?date=YYYY-MM-DD&username=xxx
 * Returns: { date, totalPlayers, leaderboard: [...], userResult?: {...} }
 * Issue #277: daily challenge leaderboard with player count and personal result.
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const dateStr = req.query.date || getTodayDateStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const filter = { date: dateStr };
    const totalPlayers = await DailyResult.countDocuments(filter);

    const results = await DailyResult.find(filter)
      .sort({ score: -1, moves: 1, duration: 1 })
      .limit(10)
      .lean();

    const leaderboard = results.map((r, i) => ({
      rank: i + 1,
      username: r.username,
      score: r.score,
      moves: r.moves,
      duration: r.duration,
      completedAt: r.completedAt,
    }));

    let userResult = null;
    if (req.query.username) {
      const san = sanitizeUsername(req.query.username);
      if (san.valid) {
        const result = await DailyResult.findOne({
          date: dateStr,
          username: san.value,
        }).lean();
        if (result) {
          const rank = await DailyResult.countDocuments({
            date: dateStr,
            $or: [
              { score: { $gt: result.score } },
              { score: result.score, moves: { $lt: result.moves } },
              { score: result.score, moves: result.moves, duration: { $lt: result.duration } },
            ],
          });
          userResult = {
            rank: rank + 1,
            username: result.username,
            score: result.score,
            moves: result.moves,
            duration: result.duration,
            completedAt: result.completedAt,
          };
        }
      }
    }

    res.json({
      success: true,
      date: dateStr,
      totalPlayers,
      leaderboard,
      userResult,
    });
  } catch (error) {
    log.error('[Daily] GET /leaderboard error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
  }
});

/**
 * GET /api/daily/leaderboard/:date
 * Paginated leaderboard for a specific date.
 * Issue #7: fixed percentile calculation for single player.
 */
router.get('/leaderboard/:date', async (req, res) => {
  try {
    const dateStr = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const { error: qErr, value: query } = leaderboardQuerySchema.validate(req.query);
    if (qErr) {
      return res.status(400).json({ success: false, error: qErr.details[0].message });
    }

    const { page, limit, username: searchUser } = query;
    const skip = (page - 1) * limit;

    const filter = { date: dateStr };
    const results = await DailyResult.find(filter)
      .sort({ score: -1, moves: 1, duration: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await DailyResult.countDocuments(filter);

    const leaderboard = results.map((r, i) => ({
      rank: skip + i + 1,
      username: r.username,
      score: r.score,
      moves: r.moves,
      duration: r.duration,
      completedAt: r.completedAt,
    }));

    // If searching for a specific user's position
    let userPosition = null;
    if (searchUser) {
      const san = sanitizeUsername(searchUser);
      if (san.valid) {
        const userResult = await DailyResult.findOne({
          date: dateStr,
          username: san.value,
        }).lean();
        if (userResult) {
          const rank = await DailyResult.countDocuments({
            date: dateStr,
            $or: [
              { score: { $gt: userResult.score } },
              { score: userResult.score, moves: { $lt: userResult.moves } },
              { score: userResult.score, moves: userResult.moves, duration: { $lt: userResult.duration } },
            ],
          });
          // Issue #7: fixed percentile for single player — Top 1% not Top 100%
          // Clamp to 100 to prevent exceeding 100% for top players in small pools
          const percentile = total > 1
            ? Math.min(100, Math.round(((total - rank) / (total - 1)) * 100))
            : 100;
          userPosition = {
            rank: rank + 1,
            username: userResult.username,
            score: userResult.score,
            moves: userResult.moves,
            duration: userResult.duration,
            percentile,
          };
        }
      }
    }

    res.json({
      success: true,
      date: dateStr,
      total,
      page,
      limit,
      leaderboard,
      userPosition,
    });
  } catch (error) {
    log.error('[Daily] GET /leaderboard error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
  }
});

/**
 * POST /api/daily/result — REMOVED
 * Result submission is now handled exclusively server-side via
 * submitDailyChallengeResult() in socketHandlers on game_over.
 * Removing this endpoint prevents client-side score manipulation.
 */

/**
 * GET /api/daily/streak/:username
 * Returns current streak, best streak, and badges.
 * Issue #9: safety cap of 400 on streak query.
 */
router.get('/streak/:username', async (req, res) => {
  try {
    const san = sanitizeUsername(req.params.username);
    if (!san.valid) {
      return res.status(400).json({ success: false, error: san.error || 'Invalid username' });
    }

    const username = san.value;
    // Issue #9: limit query to 400 results to prevent fetching unbounded data
    const results = await DailyResult.find({ username })
      .sort({ date: -1 })
      .limit(400)
      .select('date')
      .lean();

    if (results.length === 0) {
      return res.json({
        success: true,
        streak: {
          current: 0,
          best: 0,
          totalPlayed: 0,
          badges: [],
        },
      });
    }

    // Calculate current streak (consecutive days ending at today or yesterday)
    const today = getTodayDateStr();
    const playedDates = new Set(results.map((r) => r.date));

    let currentStreak = 0;
    let checkDate = today;
    // Allow streak to include today or start from yesterday
    if (!playedDates.has(today)) {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      checkDate = yesterday.toISOString().slice(0, 10);
    }

    while (playedDates.has(checkDate)) {
      currentStreak++;
      const prev = new Date(checkDate + 'T00:00:00Z');
      prev.setUTCDate(prev.getUTCDate() - 1);
      checkDate = prev.toISOString().slice(0, 10);
    }

    // Calculate best streak
    const sortedDates = [...playedDates].sort();
    let bestStreak = 0;
    let streak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1] + 'T00:00:00Z');
      const curr = new Date(sortedDates[i] + 'T00:00:00Z');
      const diffDays = (curr - prev) / (24 * 60 * 60 * 1000);
      if (diffDays === 1) {
        streak++;
      } else {
        bestStreak = Math.max(bestStreak, streak);
        streak = 1;
      }
    }
    bestStreak = Math.max(bestStreak, streak, currentStreak);

    // Badges
    const badges = [];
    if (bestStreak >= 7 || currentStreak >= 7) badges.push({ name: '🔥7', label: '7-Day Streak' });
    if (bestStreak >= 30 || currentStreak >= 30) badges.push({ name: '🔥30', label: '30-Day Streak' });
    if (bestStreak >= 100 || currentStreak >= 100) badges.push({ name: '🔥100', label: '100-Day Streak' });

    res.json({
      success: true,
      streak: {
        current: currentStreak,
        best: bestStreak,
        totalPlayed: results.length,
        badges,
      },
    });
  } catch (error) {
    log.error('[Daily] GET /streak error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch streak' });
  }
});

// Issue #8: clean module.exports — router as default, helpers under _test
module.exports = router;
module.exports._test = {
  getDayNumber,
  seededRng,
  dateSeed,
  generateBoardFromSeed,
  getOrCreateChallenge,
  getTodayDateStr,
  LAUNCH_DATE,
  DEFAULT_GRID_SIZE,
};
