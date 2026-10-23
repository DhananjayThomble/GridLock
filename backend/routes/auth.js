// routes/auth.js
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const User = require('../models/User');
const Leaderboard = require('../models/Leaderboard');
const RankedProfile = require('../models/RankedProfile');
const GameHistory = require('../models/GameHistory');
const DailyResult = require('../models/DailyResult');
const { optionalAuth, requireAuth, csrfHeader } = require('../middleware/auth');
const { GOOGLE_CONFIG, JWT_CONFIG, RESERVED_USERNAMES, validateReturnTo, COOKIE_OPTIONS, CLEAR_COOKIE_OPTS } = require('../config/authConfig');
const log = require('../utils/logger');

const router = express.Router();
const oauthClient = new OAuth2Client(
  GOOGLE_CONFIG.clientId,
  GOOGLE_CONFIG.clientSecret,
  GOOGLE_CONFIG.redirectUri
);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// Skip rate limiting in test environment to prevent test interference
const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;

// ── Rate limiters ─────────────────────────────────────────────────────────
const oauthInitLimiter = rateLimit({
  skip: () => isTest,
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { success: false, error: 'Too many requests, please try again later' },
});

const oauthCallbackLimiter = rateLimit({
  skip: () => isTest,
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { success: false, error: 'Too many requests, please try again later' },
});

const setupUsernameLimiter = rateLimit({
  skip: () => isTest,
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  message: { success: false, error: 'Too many requests, please try again later' },
});

const deleteAccountLimiter = rateLimit({
  skip: () => isTest,
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  message: { success: false, error: 'Too many requests, please try again later' },
});

const migrateGuestLimiter = rateLimit({
  skip: () => isTest,
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  message: { success: false, error: 'Too many requests, please try again later' },
});

// Cookie helper — spreads shared COOKIE_OPTIONS with optional maxAge override
function cookieOpts(maxAge) {
  // Spread shared COOKIE_OPTIONS, then restate the security-critical flags
  // explicitly at the call site. httpOnly is always true (blocks JS access to
  // the auth cookie); secure follows COOKIE_OPTIONS (enabled in production,
  // disabled for local http dev). Behaviour is identical to COOKIE_OPTIONS.
  const opts = {
    ...COOKIE_OPTIONS,
    httpOnly: true,
    secure: COOKIE_OPTIONS.secure,
    sameSite: COOKIE_OPTIONS.sameSite || 'lax',
  };
  if (maxAge !== undefined) {
    opts.maxAge = maxAge;
  }
  return opts;
}
function signJwt(userId) {
  return jwt.sign({ sub: userId.toString() }, JWT_CONFIG.secret, {
    expiresIn: JWT_CONFIG.expiresIn,
  });
}

// ── GET /api/auth/google — OAuth initiation ──
router.get('/google', oauthInitLimiter, (req, res) => {
  const returnTo = validateReturnTo(req.query.returnTo);
  const csrf = crypto.randomBytes(32).toString('hex');

  const state = Buffer.from(JSON.stringify({ csrf, returnTo })).toString('base64url');

  // Store CSRF in httpOnly cookie for verification on callback
  res.cookie('oauth_csrf', csrf, cookieOpts(10 * 60 * 1000)); // 10 min

  const authUrl = oauthClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });

  log.info('[Auth] OAuth initiation', { returnTo });
  res.redirect(authUrl);
});

// ── GET /api/auth/google/callback — Token exchange ──
router.get('/google/callback', oauthCallbackLimiter, async (req, res) => {
  try {
    // Handle user denial
    if (req.query.error) {
      log.info('[Auth] OAuth cancelled by user');
      return res.redirect(`${FRONTEND_URL}/?auth=cancelled`);
    }

    const { code, state } = req.query;
    if (!code || !state) {
      log.warn('[Auth] OAuth callback missing code or state');
      return res.redirect(`${FRONTEND_URL}/?auth=error`);
    }

    // Decode and verify state
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      log.warn('[Auth] OAuth callback invalid state encoding');
      return res.redirect(`${FRONTEND_URL}/?auth=error`);
    }

    // CSRF verification
    const csrfCookie = req.cookies?.oauth_csrf;
    if (!csrfCookie || csrfCookie !== decoded.csrf) {
      log.warn('[Auth] OAuth CSRF mismatch');
      return res.redirect(`${FRONTEND_URL}/?auth=error`);
    }

    // Clear CSRF cookie
    res.clearCookie('oauth_csrf', CLEAR_COOKIE_OPTS);

    const returnTo = validateReturnTo(decoded.returnTo);

    // Exchange code for tokens
    const { tokens } = await oauthClient.getToken(code);

    // Verify ID token
    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CONFIG.clientId,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await User.findOne({ googleId });
    let isNewUser = false;

    if (user) {
      // Update last login, profile info, and access token
      user.lastLoginAt = new Date();
      user.displayName = name;
      user.avatar = picture;
      user.googleAccessToken = tokens.access_token;
      await user.save();
      log.info('[Auth] User logged in', { userId: user._id, email });
    } else {
      // Create new user with temporary username
      isNewUser = true;
      const tempUsername = `u_${crypto.randomBytes(5).toString('hex')}`;
      user = await User.create({
        googleId,
        email,
        displayName: name,
        username: tempUsername,
        avatar: picture,
        usernameSetupComplete: false,
        googleAccessToken: tokens.access_token,
      });
      log.info('[Auth] New user created', { userId: user._id, email });
    }

    // Sign JWT and set cookie
    const token = signJwt(user._id);
    res.cookie('gridlock_token', token, cookieOpts(7 * 24 * 60 * 60 * 1000));

    // Redirect
    if (isNewUser || !user.usernameSetupComplete) {
      return res.redirect(`${FRONTEND_URL}/auth/setup`);
    }
    return res.redirect(`${FRONTEND_URL}${returnTo}`);
  } catch (err) {
    log.error('[Auth] OAuth callback error', err.stack || err);
    return res.redirect(`${FRONTEND_URL}/?auth=error`);
  }
});

// ── GET /api/auth/me — Current user info ──
router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) {
    return res.json({ success: true, user: null });
  }
  res.json({
    success: true,
    user: {
      id: req.user._id.toString(),
      username: req.user.username,
      displayName: req.user.displayName,
      email: req.user.email,
      avatar: req.user.avatar,
      usernameSetupComplete: req.user.usernameSetupComplete,
      createdAt: req.user.createdAt,
    },
  });
});

// ── POST /api/auth/logout — Clear cookie ──
router.post('/logout', csrfHeader, requireAuth, (req, res) => {
  log.info('[Auth] User logout', { userId: req.user._id });
  res.clearCookie('gridlock_token', CLEAR_COOKIE_OPTS);
  res.json({ success: true });
});

// ── POST /api/auth/setup-username — Pick username after first sign-in ──
router.post('/setup-username', setupUsernameLimiter, csrfHeader, requireAuth, async (req, res) => {
  const { username } = req.body;

  // Validation
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ success: false, error: 'Username is required' });
  }

  const trimmed = username.trim();

  if (trimmed.length < 2 || trimmed.length > 16) {
    return res.status(400).json({ success: false, error: 'Username must be 2-16 characters' });
  }

  if (!USERNAME_REGEX.test(trimmed)) {
    return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' });
  }

  if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
    return res.status(400).json({ success: false, error: 'Username is reserved' });
  }

  // Check if setup already done (re-fetch non-lean user)
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Account not found' });
  }
  if (user.usernameSetupComplete) {
    return res.status(400).json({ success: false, error: 'Username already set up' });
  }

  // Attempt to set username — unique index handles race condition
  try {
    user.username = trimmed;
    user.usernameSetupComplete = true;
    await user.save();

    log.info('[Auth] Username set up', { userId: user._id, username: trimmed });

    res.json({
      success: true,
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        avatar: user.avatar,
        usernameSetupComplete: user.usernameSetupComplete,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: 'Username already taken' });
    }
    throw err;
  }
});

// ── POST /api/auth/migrate-guest — Transfer guest data to account ──
router.post('/migrate-guest', migrateGuestLimiter, csrfHeader, requireAuth, async (req, res) => {
  const { guestUsername } = req.body;

  // Validate guest username
  if (!guestUsername || typeof guestUsername !== 'string') {
    return res.status(400).json({ success: false, error: 'Guest username is required' });
  }

  const trimmed = guestUsername.trim();
  if (!USERNAME_REGEX.test(trimmed) || trimmed.length < 2 || trimmed.length > 16) {
    return res.status(400).json({ success: false, error: 'Invalid guest username' });
  }

  // Check if already migrated (re-fetch non-lean user)
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Account not found' });
  }
  if (user.migratedFromGuest) {
    return res.status(400).json({ success: false, error: 'Data already migrated' });
  }

  const userId = user._id;

  // Use transaction for atomicity (if replica set available)
  // Operations are idempotent (filter on userId: null) so safe without transaction
  const session = await mongoose.startSession();
  let totalMigrated = 0;
  try {
    const runMigration = async (sess) => {
      const opt = sess ? { session: sess } : {};
      const lbResult = await Leaderboard.updateMany(
        { username: trimmed, userId: null },
        { $set: { userId } },
        opt
      );
      const rpResult = await RankedProfile.updateMany(
        { username: trimmed, userId: null },
        { $set: { userId } },
        opt
      );
      const ghResult = await GameHistory.updateMany(
        { username: trimmed, userId: null },
        { $set: { userId } },
        opt
      );
      const drResult = await DailyResult.updateMany(
        { username: trimmed, userId: null },
        { $set: { userId } },
        opt
      );
      await User.updateOne(
        { _id: userId },
        { $set: { migratedFromGuest: trimmed } },
        opt
      );
      return (lbResult.modifiedCount || 0) +
        (rpResult.modifiedCount || 0) +
        (ghResult.modifiedCount || 0) +
        (drResult.modifiedCount || 0);
    };

    try {
      await session.withTransaction(async () => {
        totalMigrated = await runMigration(session);
      });
    } catch (txnErr) {
      // Transaction not supported (standalone server) — run without transaction
      // Operations are idempotent due to userId: null filter
      totalMigrated = await runMigration(null);
    }
  } finally {
    session.endSession();
  }

  // Fix #9: Warn when 0 records found across all collections
  if (totalMigrated === 0) {
    log.warn('[Auth] Migration found 0 guest records', { userId, guestUsername: trimmed });
    return res.json({
      success: true,
      warning: 'No guest data found for that username',
      migrated: 0,
    });
  }

  log.info('[Auth] Guest data migrated', { userId, guestUsername: trimmed, migrated: totalMigrated });
  res.json({
    success: true,
    message: `Guest data from "${trimmed}" migrated successfully`,
    migrated: totalMigrated,
  });
});

// ── DELETE /api/auth/account — Delete account and disassociate data ──
router.delete('/account', deleteAccountLimiter, csrfHeader, requireAuth, async (req, res) => {
  const userId = req.user._id;

  // Revoke Google OAuth consent (best-effort — don't block deletion on failure)
  const userWithToken = await User.findById(userId).select('+googleAccessToken');
  if (userWithToken && userWithToken.googleAccessToken) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${userWithToken.googleAccessToken}`,
      });
      log.info('[Auth] Google consent revoked', { userId });
    } catch (revokeErr) {
      log.warn('[Auth] Google consent revoke failed (continuing with deletion)', {
        userId,
        error: revokeErr.message,
      });
    }
  }

  // Wrap in a MongoDB transaction for atomicity; fall back to non-transactional
  // on standalone servers (MongoMemoryServer in tests, single-node Atlas dev cluster).
  const session = await mongoose.startSession();
  try {
    const runDeletion = async (sess) => {
      const opt = sess ? { session: sess } : {};
      // Nullify userId on associated records (data becomes anonymous/guest again)
      await Leaderboard.updateMany({ userId }, { $set: { userId: null } }, opt);
      await RankedProfile.updateMany({ userId }, { $set: { userId: null } }, opt);
      await GameHistory.updateMany({ userId }, { $set: { userId: null } }, opt);
      await DailyResult.updateMany({ userId }, { $set: { userId: null } }, opt);
      // Delete user document
      await User.deleteOne({ _id: userId }, opt);
    };

    try {
      await session.withTransaction(async () => {
        await runDeletion(session);
      });
    } catch (txnErr) {
      // Transaction not supported (standalone server) — run without transaction
      await runDeletion(null);
    }
  } finally {
    session.endSession();
  }

  log.info('[Auth] Account deleted', { userId });

  // Clear cookie
  res.clearCookie('gridlock_token', CLEAR_COOKIE_OPTS);
  res.json({ success: true, message: 'Account and all associated data deleted' });
});

module.exports = router;
