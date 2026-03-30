/**
 * backend/__tests__/authIntegration.test.js
 *
 * Integration tests verifying auth routes are mounted and accessible.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Mock google-auth-library
jest.mock('google-auth-library', () => {
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({
      verifyIdToken: jest.fn(),
      getToken: jest.fn(),
      generateAuthUrl: jest.fn(() => 'https://accounts.google.com/mock'),
    })),
  };
});

let mongoServer;

beforeAll(async () => {
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.FRONTEND_URL = 'http://localhost:5173';

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  delete process.env.JWT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.FRONTEND_URL;
  await mongoose.disconnect();
  await mongoServer.stop();
});

const authRoutes = require('../routes/auth');

describe('Auth Integration', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);
  });

  test('GET /api/auth/me returns { user: null } for guests', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, user: null });
  });

  test('GET /api/auth/google redirects to Google', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);
  });

  test('POST /api/auth/logout returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(401);
  });

  test('DELETE /api/auth/account returns 401 without auth', async () => {
    const res = await request(app)
      .delete('/api/auth/account')
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/setup-username returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/auth/setup-username')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: 'test' });
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/migrate-guest returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/auth/migrate-guest')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ guestUsername: 'test' });
    expect(res.status).toBe(401);
  });
});
