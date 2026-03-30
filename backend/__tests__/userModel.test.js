/**
 * backend/__tests__/userModel.test.js
 *
 * TDD tests for the User model (OAuth schema).
 * Tests written FIRST per AUTH-ARCHITECTURE.md Section 11c.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await mongoose.connection.syncIndexes();
});

afterAll(async () => {
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

const validUserData = () => ({
  googleId: 'google-123456',
  email: 'test@example.com',
  displayName: 'Test User',
  username: 'testuser',
});

describe('User Model', () => {
  test('creates user with valid data', async () => {
    const user = await User.create(validUserData());
    expect(user.googleId).toBe('google-123456');
    expect(user.email).toBe('test@example.com');
    expect(user.displayName).toBe('Test User');
    expect(user.username).toBe('testuser');
    expect(user.usernameSetupComplete).toBe(false);
    expect(user.avatar).toBeNull();
    expect(user.migratedFromGuest).toBeNull();
    expect(user.lastLoginAt).toBeDefined();
  });

  test('requires googleId', async () => {
    const data = validUserData();
    delete data.googleId;
    await expect(User.create(data)).rejects.toThrow();
  });

  test('requires email', async () => {
    const data = validUserData();
    delete data.email;
    await expect(User.create(data)).rejects.toThrow();
  });

  test('requires displayName', async () => {
    const data = validUserData();
    delete data.displayName;
    await expect(User.create(data)).rejects.toThrow();
  });

  test('requires username', async () => {
    const data = validUserData();
    delete data.username;
    await expect(User.create(data)).rejects.toThrow();
  });

  test('enforces unique googleId', async () => {
    await User.create(validUserData());
    const dup = validUserData();
    dup.email = 'other@example.com';
    dup.username = 'otheruser';
    await expect(User.create(dup)).rejects.toThrow();
  });

  test('enforces unique email', async () => {
    await User.create(validUserData());
    const dup = validUserData();
    dup.googleId = 'google-999';
    dup.username = 'otheruser';
    await expect(User.create(dup)).rejects.toThrow();
  });

  test('enforces unique username', async () => {
    await User.create(validUserData());
    const dup = validUserData();
    dup.googleId = 'google-999';
    dup.email = 'other@example.com';
    await expect(User.create(dup)).rejects.toThrow();
  });

  test('lowercases email', async () => {
    const data = validUserData();
    data.email = 'TEST@EXAMPLE.COM';
    const user = await User.create(data);
    expect(user.email).toBe('test@example.com');
  });

  test('trims whitespace from string fields', async () => {
    const data = validUserData();
    data.email = '  test@example.com  ';
    data.displayName = '  Test User  ';
    data.username = '  testuser  ';
    const user = await User.create(data);
    expect(user.email).toBe('test@example.com');
    expect(user.displayName).toBe('Test User');
    expect(user.username).toBe('testuser');
  });

  test('rejects username > 16 chars', async () => {
    const data = validUserData();
    data.username = 'a'.repeat(17);
    await expect(User.create(data)).rejects.toThrow();
  });

  test('rejects username < 2 chars', async () => {
    const data = validUserData();
    data.username = 'a';
    await expect(User.create(data)).rejects.toThrow();
  });

  test('rejects username with invalid chars', async () => {
    const data = validUserData();
    data.username = 'bad user!';
    await expect(User.create(data)).rejects.toThrow();
  });

  test('accepts username with underscores and hyphens', async () => {
    const data = validUserData();
    data.username = 'test_user-1';
    const user = await User.create(data);
    expect(user.username).toBe('test_user-1');
  });

  test('defaults usernameSetupComplete to false', async () => {
    const user = await User.create(validUserData());
    expect(user.usernameSetupComplete).toBe(false);
  });

  test('auto-sets createdAt and updatedAt via timestamps', async () => {
    const user = await User.create(validUserData());
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  test('displayName respects maxlength of 30', async () => {
    const data = validUserData();
    data.displayName = 'a'.repeat(31);
    await expect(User.create(data)).rejects.toThrow();
  });

  test('avatar defaults to null', async () => {
    const user = await User.create(validUserData());
    expect(user.avatar).toBeNull();
  });

  test('can set avatar URL', async () => {
    const data = validUserData();
    data.avatar = 'https://lh3.googleusercontent.com/photo.jpg';
    const user = await User.create(data);
    expect(user.avatar).toBe('https://lh3.googleusercontent.com/photo.jpg');
  });
});
