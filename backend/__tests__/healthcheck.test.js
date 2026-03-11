/**
 * backend/__tests__/healthcheck.test.js
 *
 * Tests for the deep health check endpoint (GET /health/deep).
 */

const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const request = require('supertest');
const Leaderboard = require('../models/Leaderboard');
const healthcheckRoutes = require('../routes/healthcheck');

let app, server, io;

beforeAll(async () => {
  // Connect to test DB
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock-test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  app = express();
  server = http.createServer(app);
  io = new Server(server);
  app.locals.io = io;
  app.use('/health', healthcheckRoutes);

  await new Promise((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  io.close();
  server.close();
  await mongoose.connection.close();
});

describe('GET /health/deep', () => {
  test('returns 200 with all checks passing', async () => {
    const res = await request(app).get('/health/deep');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.mongoPing.status).toBe('pass');
    expect(res.body.checks.mongoRead.status).toBe('pass');
    expect(res.body.checks.socketIO.status).toBe('pass');
    expect(typeof res.body.checks.mongoPing.latencyMs).toBe('number');
    expect(typeof res.body.checks.mongoRead.latencyMs).toBe('number');
    expect(typeof res.body.checks.socketIO.connectedClients).toBe('number');
    expect(typeof res.body.totalLatencyMs).toBe('number');
    expect(res.body.timestamp).toBeDefined();
  });

  test('returns 503 when Socket.IO is missing', async () => {
    // Temporarily remove io
    const originalIo = app.locals.io;
    app.locals.io = null;

    const res = await request(app).get('/health/deep');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.socketIO.status).toBe('fail');
    // Mongo checks should still pass
    expect(res.body.checks.mongoPing.status).toBe('pass');
    expect(res.body.checks.mongoRead.status).toBe('pass');

    // Restore
    app.locals.io = originalIo;
  });

  test('returns individual check details even on partial failure', async () => {
    const originalIo = app.locals.io;
    app.locals.io = null;

    const res = await request(app).get('/health/deep');

    // All three checks should be present regardless
    expect(res.body.checks).toHaveProperty('mongoPing');
    expect(res.body.checks).toHaveProperty('mongoRead');
    expect(res.body.checks).toHaveProperty('socketIO');

    app.locals.io = originalIo;
  });

  test('returns 503 when MongoDB is down', async () => {
    // Simulate a full MongoDB failure:
    // - Mock admin().ping() to reject (connection broken)
    // - Spy on Leaderboard.findOne to also reject (queries fail)
    // This mirrors the 2026-03-11 incident where /health returned 200 while mongo was broken
    const originalDb = mongoose.connection.db;
    const mockAdmin = { ping: jest.fn().mockRejectedValue(new Error('MongoNetworkError: connection timed out')) };
    mongoose.connection.db = { admin: () => mockAdmin };

    const findOneSpy = jest
      .spyOn(Leaderboard, 'findOne')
      .mockImplementation(() => {
        throw new Error('MongoNetworkError: connection timed out');
      });

    const res = await request(app).get('/health/deep');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.mongoPing.status).toBe('fail');
    expect(res.body.checks.mongoPing.error).toBeDefined();
    expect(res.body.checks.mongoRead.status).toBe('fail');
    expect(res.body.checks.mongoRead.error).toBeDefined();
    // Socket.IO should still pass independently
    expect(res.body.checks.socketIO.status).toBe('pass');

    // Restore
    mongoose.connection.db = originalDb;
    findOneSpy.mockRestore();
  });
});
