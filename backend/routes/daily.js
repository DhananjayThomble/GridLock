// routes/daily.js
// Daily challenge API endpoints
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const DailyChallenge = require('../models/DailyChallenge');
const DailyResult = require('../models/DailyResult');
const { sanitizeUsername } = require('../utils/sanitize');

// ── Constants ────────────────────────────────────────────────────────────────
const LAUNCH_DATE = '2026-03-01'; // Day 1 of daily challenges
const DEFAULT_GRID_SIZE = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get today's date string in YYYY-MM-DD (UTC).
 */
function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calculate day number from launch date.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {number} Day number (1-indexed)
 */
function getDayNumber(dateStr) {
  const launch = new Date(LAUNCH_DATE + 'T00:00:00Z');
  const target = new Date(dateStr + 'T00:00:00Z');
  const diffMs = target - launch;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic: same seed → same sequence.
 * @param {number} seed
 * @returns {function} Returns float in [0,1)
 */
function seededRng(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a date string to a numeric seed.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {number}
 */
function dateSeed(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Generate a deterministic board layout from a seed.
 * Returns arrays of pre-drawn horizontal and vertical lines.
 * Same seed always produces the same board.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} gridSize
 * @returns {{ predrawnH: number[][], predrawnV: number[][] }}
 */
function generateBoardFromSeed(dateStr, gridSize) {
  const rng = seededRng(dateSeed(dateStr));
  const rows = gridSize;
  const cols = gridSize;

  // Total possible lines
  const totalH = (rows + 1) * cols;
  const totalV = rows * (cols + 1);
  const totalLines = totalH + totalV;

  // Pre-draw ~15-25% of lines to create an interesting starting position
  const predrawnCount = Math.floor(totalLines * (0.15 + rng() * 0.10));

  // Build flat array of all line indices, shuffle, pick first N
  const allIndices = Array.from({ length: totalLines }, (_, i) => i);
  // Fisher-Yates shuffle with seeded RNG
  for (let i = allIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
  }
  const predrawnSet = new Set(allIndices.slice(0, predrawnCount));

  // Map back to grid positions
  const predrawnH = Array(rows + 1)
    .fill(null)
    .map(() => Array(cols).fill(0));
  const predrawnV = Array(rows)
    .fill(null)
    .map(() => Array(cols + 1).fill(0));

  let idx = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (predrawnSet.has(idx)) predrawnH[r][c] = 1;
      idx++;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (predrawnSet.has(idx)) predrawnV[r][c] = 1;
      idx++;
    }
  }

  // Post-process: remove any pre-drawn lines that would complete a box
  // (we want pre-drawn lines to set up the board, not score points)
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sides = [
          predrawnH[r][c],
          predrawnH[r + 1][c],
          predrawnV[r][c],
          predrawnV[r][c + 1],
        ];
        if (sides.every((s) => s === 1)) {
          // Box is complete — remove a random side
          const sideIdx = Math.floor(rng() * 4);
          if (sideIdx === 0) predrawnH[r][c] = 0;
          else if (sideIdx === 1) predrawnH[r + 1][c] = 0;
          else if (sideIdx === 2) predrawnV[r][c] = 0;
          else predrawnV[r][c + 1] = 0;
          changed = true;
        }
      }
    }
  }

  return { predrawnH, predrawnV };
}

/**
 * Get or create today's challenge document.
 * @param {string} [dateStr] - Optional date override
 * @returns {Promise<Object>}
 */
async function getOrCreateChallenge(dateStr) {
  const date = dateStr || getTodayDateStr();
  const dayNumber = getDayNumber(date);

  let challenge = await DailyChallenge.findOne({ date });
  if (!challenge) {
    const seed = date; // Use date string as the canonical seed
    challenge = await DailyChallenge.create({
      date,
      seed,
      gridSize: DEFAULT_GRID_SIZE,
      dayNumber,
    });
  }
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
        seed: challenge.seed,
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
    console.error('[Daily] GET /today error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch daily challenge' });
  }
});

/**
 * GET /api/daily/leaderboard/:date
 * Paginated leaderboard for a specific date.
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
          userPosition = {
            rank: rank + 1,
            username: userResult.username,
            score: userResult.score,
            moves: userResult.moves,
            duration: userResult.duration,
            percentile: total > 0 ? Math.round(((total - rank) / total) * 100) : 100,
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
    console.error('[Daily] GET /leaderboard error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
  }
});

/**
 * POST /api/daily/result
 * Submit a daily challenge result.
 * Validates: not already submitted, date matches today.
 */
router.post('/result', async (req, res) => {
  try {
    const { error: vErr, value } = resultSchema.validate(req.body);
    if (vErr) {
      return res.status(400).json({ success: false, error: vErr.details[0].message });
    }

    const { username, score, moves, duration, date } = value;
    const san = sanitizeUsername(username);
    if (!san.valid) {
      return res.status(400).json({ success: false, error: san.error || 'Invalid username' });
    }

    const today = getTodayDateStr();
    if (date !== today) {
      return res.status(400).json({
        success: false,
        error: 'Can only submit results for today\'s challenge',
      });
    }

    // Check if already submitted
    const existing = await DailyResult.findOne({ date, username: san.value });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'You have already completed today\'s challenge',
      });
    }

    const result = await DailyResult.create({
      date,
      username: san.value,
      score,
      moves,
      duration,
      completedAt: new Date(),
    });

    // Calculate rank
    const rank = await DailyResult.countDocuments({
      date,
      $or: [
        { score: { $gt: score } },
        { score, moves: { $lt: moves } },
        { score, moves, duration: { $lt: duration } },
      ],
    });
    const total = await DailyResult.countDocuments({ date });
    const percentile = total > 0 ? Math.round(((total - rank) / total) * 100) : 100;

    // Get challenge info for day number
    const challenge = await getOrCreateChallenge(date);

    res.status(201).json({
      success: true,
      result: {
        date: result.date,
        username: result.username,
        score: result.score,
        moves: result.moves,
        duration: result.duration,
        completedAt: result.completedAt,
        rank: rank + 1,
        total,
        percentile,
        dayNumber: challenge.dayNumber,
      },
    });
  } catch (error) {
    // Duplicate key (race condition)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'You have already completed today\'s challenge',
      });
    }
    console.error('[Daily] POST /result error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to submit result' });
  }
});

/**
 * GET /api/daily/streak/:username
 * Returns current streak, best streak, and badges.
 */
router.get('/streak/:username', async (req, res) => {
  try {
    const san = sanitizeUsername(req.params.username);
    if (!san.valid) {
      return res.status(400).json({ success: false, error: san.error || 'Invalid username' });
    }

    const username = san.value;
    const results = await DailyResult.find({ username })
      .sort({ date: -1 })
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
    console.error('[Daily] GET /streak error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch streak' });
  }
});

// Export helpers for testing
module.exports = router;
module.exports.getDayNumber = getDayNumber;
module.exports.seededRng = seededRng;
module.exports.dateSeed = dateSeed;
module.exports.generateBoardFromSeed = generateBoardFromSeed;
module.exports.getOrCreateChallenge = getOrCreateChallenge;
module.exports.getTodayDateStr = getTodayDateStr;
module.exports.LAUNCH_DATE = LAUNCH_DATE;
