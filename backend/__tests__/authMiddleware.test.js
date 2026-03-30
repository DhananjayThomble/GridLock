/**
 * backend/__tests__/authMiddleware.test.js
 *
 * TDD tests for auth middleware: optionalAuth, requireAuth, csrfHeader.
 * Per AUTH-ARCHITECTURE.md Section 11b.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

let mongoServer;

const JWT_SECRET = 'test-jwt-secret-for-middleware-tests';

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await mongoose.connection.syncIndexes();
});

afterAll(async () => {
  delete process.env.JWT_SECRET;
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

const User = require('../models/User');
const { optionalAuth, requireAuth, csrfHeader } = require('../middleware/auth');

function createMockReqRes(opts = {}) {
  const req = {
    cookies: opts.cookies || {},
    headers: opts.headers || {},
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    clearCookie: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

async function createTestUser() {
  return User.create({
    googleId: 'google-test-123',
    email: 'test@example.com',
    displayName: 'Test User',
    username: 'testuser',
  });
}

function signToken(userId, secret = JWT_SECRET, expiresIn = '7d') {
  return jwt.sign({ sub: userId.toString() }, secret, { expiresIn });
}

describe('optionalAuth Middleware', () => {
  test('sets req.user when valid token present', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const { req, res, next } = createMockReqRes({ cookies: { gridlock_token: token } });

    await optionalAuth(req, res, next);

    expect(req.user).toBeDefined();
    expect(req.user._id.toString()).toBe(user._id.toString());
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes through when no cookie', async () => {
    const { req, res, next } = createMockReqRes();

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes through when invalid token (clears cookie)', async () => {
    const { req, res, next } = createMockReqRes({
      cookies: { gridlock_token: 'invalid-token' },
    });

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(res.clearCookie).toHaveBeenCalledWith('gridlock_token', expect.any(Object));
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes through when user deleted (clears cookie)', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    await User.deleteOne({ _id: user._id });

    const { req, res, next } = createMockReqRes({ cookies: { gridlock_token: token } });

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(res.clearCookie).toHaveBeenCalledWith('gridlock_token', expect.any(Object));
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('does not call next() twice', async () => {
    const { req, res, next } = createMockReqRes();

    await optionalAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('requireAuth Middleware', () => {
  test('sets req.user when valid token present', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    const { req, res, next } = createMockReqRes({ cookies: { gridlock_token: token } });

    await requireAuth(req, res, next);

    expect(req.user).toBeDefined();
    expect(req.user._id.toString()).toBe(user._id.toString());
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 401 when no cookie', async () => {
    const { req, res, next } = createMockReqRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Authentication required',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when invalid token', async () => {
    const { req, res, next } = createMockReqRes({
      cookies: { gridlock_token: 'bad-token' },
    });

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when user deleted', async () => {
    const user = await createTestUser();
    const token = signToken(user._id);
    await User.deleteOne({ _id: user._id });

    const { req, res, next } = createMockReqRes({ cookies: { gridlock_token: token } });

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Account not found',
    }));
    expect(res.clearCookie).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('clears stale cookies on auth failure', async () => {
    const expired = jwt.sign({ sub: 'fakeid' }, JWT_SECRET, { expiresIn: '-1s' });
    const { req, res, next } = createMockReqRes({
      cookies: { gridlock_token: expired },
    });

    await requireAuth(req, res, next);

    expect(res.clearCookie).toHaveBeenCalledWith('gridlock_token', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('csrfHeader Middleware', () => {
  test('passes when X-Requested-With: XMLHttpRequest present', () => {
    const { req, res, next } = createMockReqRes({
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });

    csrfHeader(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns 403 when header missing', () => {
    const { req, res, next } = createMockReqRes();

    csrfHeader(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Missing required header',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 when header has wrong value', () => {
    const { req, res, next } = createMockReqRes({
      headers: { 'x-requested-with': 'WrongValue' },
    });

    csrfHeader(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
