/**
 * backend/__tests__/auth.test.js
 *
 * Comprehensive TDD tests for auth routes.
 * Per AUTH-ARCHITECTURE.md Section 11a.
 *
 * Google OAuth is fully mocked — no real Google calls.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Mock google-auth-library before requiring routes
jest.mock('google-auth-library', () => {
  const mockVerifyIdToken = jest.fn();
  const mockGetToken = jest.fn();
  const mockGenerateAuthUrl = jest.fn(({ state, scope }) => {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: Array.isArray(scope) ? scope.join(' ') : scope,
      state,
      prompt: 'select_account',
      access_type: 'online',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  });
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: mockVerifyIdToken,
      getToken: mockGetToken,
      generateAuthUrl: mockGenerateAuthUrl,
    })),
    __mockVerifyIdToken: mockVerifyIdToken,
    __mockGetToken: mockGetToken,
    __mockGenerateAuthUrl: mockGenerateAuthUrl,
  };
});

const { __mockVerifyIdToken, __mockGetToken } = require('google-auth-library');

const JWT_SECRET = 'test-jwt-secret-for-auth-routes';
const GOOGLE_CLIENT_ID = 'test-client-id';
const GOOGLE_CLIENT_SECRET = 'test-client-secret';
const FRONTEND_URL = 'http://localhost:5173';

let mongoServer;

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/auth/google/callback';
  process.env.FRONTEND_URL = FRONTEND_URL;

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await mongoose.connection.syncIndexes();
});

afterAll(async () => {
  delete process.env.JWT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.FRONTEND_URL;
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  jest.clearAllMocks();
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

const User = require('../models/User');
const Leaderboard = require('../models/Leaderboard');
const RankedProfile = require('../models/RankedProfile');
const GameHistory = require('../models/GameHistory');
const DailyResult = require('../models/DailyResult');
const authRoutes = require('../routes/auth');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}

async function createTestUser(overrides = {}) {
  return User.create({
    googleId: 'google-test-123',
    email: 'test@example.com',
    displayName: 'Test User',
    username: 'testuser',
    usernameSetupComplete: true,
    ...overrides,
  });
}

function signToken(userId) {
  return jwt.sign({ sub: userId.toString() }, JWT_SECRET, { expiresIn: '7d' });
}

function makeState(csrf, returnTo = '/') {
  return Buffer.from(JSON.stringify({ csrf, returnTo })).toString('base64url');
}

// ── GET /api/auth/google ──────────────────────────────────────────────────
describe('GET /api/auth/google', () => {
  test('redirects to Google with correct params', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/google');

    expect(res.status).toBe(302);
    const location = res.headers.location;
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('client_id=' + GOOGLE_CLIENT_ID);
    expect(location).toContain('response_type=code');
    expect(location).toContain('scope=');
    expect(location).toContain('openid');
  });

  test('encodes returnTo + CSRF in state parameter', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/google?returnTo=/settings');

    const location = new URL(res.headers.location);
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    expect(decoded.csrf).toBeTruthy();
    expect(decoded.returnTo).toBe('/settings');
  });

  test('uses prompt=select_account and access_type=online', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/google');

    const location = res.headers.location;
    expect(location).toContain('prompt=select_account');
    expect(location).toContain('access_type=online');
  });

  test('validates returnTo param (rejects absolute URLs)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/google?returnTo=https://evil.com');

    const location = new URL(res.headers.location);
    const state = location.searchParams.get('state');
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    expect(decoded.returnTo).toBe('/');
  });
});

// ── GET /api/auth/google/callback ─────────────────────────────────────────
describe('GET /api/auth/google/callback', () => {
  function mockGoogleSuccess(googleId = 'google-new-123', email = 'new@example.com', name = 'New User', picture = 'https://photo.url') {
    __mockGetToken.mockResolvedValue({
      tokens: { id_token: 'mock-id-token', access_token: 'mock-access-token' },
    });
    __mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: googleId,
        email,
        name,
        picture,
      }),
    });
  }

  test('creates new user on first sign-in (usernameSetupComplete: false)', async () => {
    mockGoogleSuccess();
    const csrf = crypto.randomBytes(32).toString('hex');
    const state = makeState(csrf, '/');
    const app = createApp();

    const res = await request(app)
      .get(`/api/auth/google/callback?code=auth-code&state=${state}`)
      .set('Cookie', `oauth_csrf=${csrf}`);

    expect(res.status).toBe(302);
    const user = await User.findOne({ googleId: 'google-new-123' });
    expect(user).toBeTruthy();
    expect(user.usernameSetupComplete).toBe(false);
    expect(user.email).toBe('new@example.com');
  });

  test('finds existing user on repeat sign-in', async () => {
    const existing = await createTestUser({ googleId: 'google-existing' });
    mockGoogleSuccess('google-existing', 'test@example.com', 'Test User');

    const csrf = crypto.randomBytes(32).toString('hex');
    const state = makeState(csrf, '/');
    const app = createApp();

    const res = await request(app)
      .get(`/api/auth/google/callback?code=auth-code&state=${state}`)
      .set('Cookie', `oauth_csrf=${csrf}`);

    expect(res.status).toBe(302);
    // Should not create a new user
    const count = await User.countDocuments({ googleId: 'google-existing' });
    expect(count).toBe(1);
  });

  test('sets JWT cookie on success', async () => {
    mockGoogleSuccess();
    const csrf = crypto.randomBytes(32).toString('hex');
    const state = makeState(csrf, '/');
    const app = createApp();

    const res = await request(app)
      .get(`/api/auth/google/callback?code=auth-code&state=${state}`)
      .set('Cookie', `oauth_csrf=${csrf}`);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const tokenCookie = cookies.find(c => c.startsWith('gridlock_token='));
    expect(tokenCookie).toBeTruthy();
    expect(tokenCookie).toContain('HttpOnly');
  });

  test('redirects to /auth/setup for new users', async () => {
    mockGoogleSuccess();
    const csrf = crypto.randomBytes(32).toString('hex');
    const state = makeState(csrf, '/settings');
    const app = createApp();

    const res = await request(app)
      .get(`/api/auth/google/callback?code=auth-code&state=${state}`)
      .set('Cookie', `oauth_csrf=${csrf}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/setup');
  });

  test('redirects to returnTo for existing users', async () => {
    await createTestUser({ googleId: 'google-ret-123' });
    mockGoogleSuccess('google-ret-123', 'test@example.com', 'Test User');

    const csrf = crypto.randomBytes(32).toString('hex');
    const state = makeState(csrf, '/settings');
    const app = createApp();

    const res = await request(app)
      .get(`/api/auth/google/callback?code=auth-code&state=${state}`)
      .set('Cookie', `oauth_csrf=${csrf}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/settings');
  });

  test('handles Google error (user denied)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/auth/google/callback?error=access_denied');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth=cancelled');
  });

  test('rejects invalid state (CSRF mismatch)', async () => {
    mockGoogleSuccess();
    const state = makeState('wrong-csrf', '/');
    const app = createApp();

    const res = await request(app)
      .get(`/api/auth/google/callback?code=auth-code&state=${state}`)
      .set('Cookie', `oauth_csrf=different-csrf`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth=error');
  });

  test('handles token exchange failure', async () => {
    __mockGetToken.mockRejectedValue(new Error('Token exchange failed'));
    const csrf = crypto.randomBytes(32).toString('hex');
    const state = makeState(csrf, '/');
    const app = createApp();

    const res = await request(app)
      .get(`/api/auth/google/callback?code=bad-code&state=${state}`)
      .set('Cookie', `oauth_csrf=${csrf}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth=error');
  });

  test('updates lastLoginAt on existing user', async () => {
    const pastDate = new Date('2025-01-01');
    const user = await createTestUser({ googleId: 'google-login-test', lastLoginAt: pastDate });
    mockGoogleSuccess('google-login-test', 'test@example.com', 'Test User');

    const csrf = crypto.randomBytes(32).toString('hex');
    const state = makeState(csrf, '/');
    const app = createApp();

    await request(app)
      .get(`/api/auth/google/callback?code=auth-code&state=${state}`)
      .set('Cookie', `oauth_csrf=${csrf}`);

    const updated = await User.findById(user._id);
    expect(updated.lastLoginAt.getTime()).toBeGreaterThan(pastDate.getTime());
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  test('returns user object when authenticated', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `gridlock_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(user._id.toString());
    expect(res.body.user.username).toBe('testuser');
    expect(res.body.user.email).toBe('test@example.com');
  });

  test('returns { user: null } when no cookie', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toBeNull();
  });

  test('returns { user: null } when expired token', async () => {
    const token = jwt.sign({ sub: 'fakeid' }, JWT_SECRET, { expiresIn: '-1s' });
    const app = createApp();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `gridlock_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  test('returns { user: null } when user deleted', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    await User.deleteOne({ _id: user._id });
    const app = createApp();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `gridlock_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  test('never returns 401', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'gridlock_token=totally-invalid');

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  test('clears JWT cookie', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    // Cookie should be cleared (empty or expired)
    const tokenCookie = cookies.find(c => c.startsWith('gridlock_token='));
    expect(tokenCookie).toBeTruthy();
  });

  test('returns 401 when not authenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(401);
  });

  test('returns 403 when X-Requested-With header missing', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `gridlock_token=${token}`);

    expect(res.status).toBe(403);
  });
});

// ── POST /api/auth/setup-username ─────────────────────────────────────────
describe('POST /api/auth/setup-username', () => {
  test('sets username and usernameSetupComplete: true', async () => {
    const user = await createTestUser({ usernameSetupComplete: false, username: 'temp_abc123' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'chosen_name' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe('chosen_name');
    expect(res.body.user.usernameSetupComplete).toBe(true);
  });

  test('catches MongoDB 11000 error → returns 409', async () => {
    // Create existing user with that username
    await createTestUser({ googleId: 'google-existing-1', email: 'existing@example.com', username: 'taken_name' });

    const user = await createTestUser({
      googleId: 'google-new-1',
      email: 'new@example.com',
      username: 'temp_xyz',
      usernameSetupComplete: false,
    });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'taken_name' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already taken');
  });

  test('rejects reserved words', async () => {
    const user = await createTestUser({ usernameSetupComplete: false, username: 'temp_123' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('reserved');
  });

  test('rejects invalid characters', async () => {
    const user = await createTestUser({ usernameSetupComplete: false, username: 'temp_456' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'bad name!' });

    expect(res.status).toBe(400);
  });

  test('rejects too short (< 2 chars)', async () => {
    const user = await createTestUser({ usernameSetupComplete: false, username: 'temp_789' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'a' });

    expect(res.status).toBe(400);
  });

  test('rejects too long (> 16 chars)', async () => {
    const user = await createTestUser({ usernameSetupComplete: false, username: 'temp_101' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'a'.repeat(17) });

    expect(res.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'newname' });

    expect(res.status).toBe(401);
  });

  test('rejects if usernameSetupComplete already true', async () => {
    const user = await createTestUser({ usernameSetupComplete: true });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'newname' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already set');
  });

  test('returns 403 when X-Requested-With header missing', async () => {
    const user = await createTestUser({ usernameSetupComplete: false, username: 'temp_csrf' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('Cookie', `gridlock_token=${token}`)
      .send({ username: 'newname' });

    expect(res.status).toBe(403);
  });
});

// ── POST /api/auth/migrate-guest ──────────────────────────────────────────
describe('POST /api/auth/migrate-guest', () => {
  test('migrates leaderboard data', async () => {
    const user = await createTestUser();
    await Leaderboard.create({ username: 'guestplayer', gamesPlayed: 10, wins: 5 });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'guestplayer' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const lb = await Leaderboard.findOne({ username: 'guestplayer' });
    expect(lb.userId.toString()).toBe(user._id.toString());
  });

  test('migrates ranked profile data', async () => {
    const user = await createTestUser();
    await RankedProfile.create({ username: 'guestranked' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'guestranked' });

    expect(res.status).toBe(200);
    const rp = await RankedProfile.findOne({ username: 'guestranked' });
    expect(rp.userId.toString()).toBe(user._id.toString());
  });

  test('migrates game history data', async () => {
    const user = await createTestUser();
    await GameHistory.create({
      gameId: 'game-1',
      username: 'guesthistory',
      opponents: ['opp1'],
      playerCount: 2,
      gridSize: 3,
      result: 'win',
    });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'guesthistory' });

    expect(res.status).toBe(200);
    const gh = await GameHistory.findOne({ username: 'guesthistory' });
    expect(gh.userId.toString()).toBe(user._id.toString());
  });

  test('migrates daily result data', async () => {
    const user = await createTestUser();
    await DailyResult.create({
      date: '2026-03-30',
      username: 'guestdaily',
      score: 5,
      moves: 10,
      duration: 30,
    });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'guestdaily' });

    expect(res.status).toBe(200);
    const dr = await DailyResult.findOne({ username: 'guestdaily' });
    expect(dr.userId.toString()).toBe(user._id.toString());
  });

  test('only migrates records with userId: null', async () => {
    const user = await createTestUser();
    const otherId = new mongoose.Types.ObjectId();
    await Leaderboard.create({ username: 'claimed', gamesPlayed: 5, wins: 2, userId: otherId });
    const token = signToken(user._id);
    const app = createApp();

    await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'claimed' });

    const lb = await Leaderboard.findOne({ username: 'claimed' });
    // Should NOT have been overwritten
    expect(lb.userId.toString()).toBe(otherId.toString());
  });

  test('rejects if already migrated', async () => {
    const user = await createTestUser({ migratedFromGuest: 'oldguest' });
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'someguest' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already migrated');
  });

  test('rejects invalid guest username', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'bad name!' });

    expect(res.status).toBe(400);
  });

  test('returns 401 when not authenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'guest' });

    expect(res.status).toBe(401);
  });

  test('returns 403 when X-Requested-With header missing', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('Cookie', `gridlock_token=${token}`)
      .send({ guestUsername: 'guest' });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/auth/account ──────────────────────────────────────────────
describe('DELETE /api/auth/account', () => {
  test('deletes user document', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const deleted = await User.findById(user._id);
    expect(deleted).toBeNull();
  });

  test('nullifies userId on associated records', async () => {
    const user = await createTestUser();
    await Leaderboard.create({ username: 'testuser', gamesPlayed: 5, wins: 2, userId: user._id });
    await RankedProfile.create({ username: 'testuser', userId: user._id });
    await GameHistory.create({
      gameId: 'game-del',
      username: 'testuser',
      opponents: ['opp1'],
      playerCount: 2,
      gridSize: 3,
      result: 'win',
      userId: user._id,
    });
    await DailyResult.create({
      date: '2026-03-30',
      username: 'testuser',
      score: 5,
      moves: 10,
      duration: 30,
      userId: user._id,
    });

    const token = signToken(user._id);
    const app = createApp();

    await request(app)
      .delete('/api/auth/account')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    const lb = await Leaderboard.findOne({ username: 'testuser' });
    expect(lb.userId).toBeNull();
    const rp = await RankedProfile.findOne({ username: 'testuser' });
    expect(rp.userId).toBeNull();
    const gh = await GameHistory.findOne({ gameId: 'game-del' });
    expect(gh.userId).toBeNull();
    const dr = await DailyResult.findOne({ date: '2026-03-30', username: 'testuser' });
    expect(dr.userId).toBeNull();
  });

  test('clears JWT cookie', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', `gridlock_token=${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const tokenCookie = cookies.find(c => c.startsWith('gridlock_token='));
    expect(tokenCookie).toBeTruthy();
  });

  test('returns 401 when not authenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .delete('/api/auth/account')
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(401);
  });

  test('returns 403 when X-Requested-With header missing', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const app = createApp();

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', `gridlock_token=${token}`);

    expect(res.status).toBe(403);
  });
});
