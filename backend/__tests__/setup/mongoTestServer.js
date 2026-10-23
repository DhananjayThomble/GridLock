/**
 * Test replacement for `mongodb-memory-server`.
 *
 * Many suites call `MongoMemoryServer.create()` in `beforeAll` and then
 * `mongoose.connect(server.getUri())`. On CI we already provide a real
 * `mongo:7` service container (reachable via MONGO_URI), and downloading +
 * spawning a separate in-memory mongod per suite is slow enough to blow Jest's
 * 5s hook timeout under `--runInBand` (13 suites were timing out in beforeAll).
 *
 * This module is substituted for `mongodb-memory-server` via `moduleNameMapper`
 * in jest.config.js, so every suite gets it with no per-file changes.
 *
 * Behaviour:
 *   - When MONGO_URI is set (CI, or a dev who opts in), `create()` returns a
 *     lightweight stub that hands out a unique database on that server via
 *     getUri(); stop()/cleanup() are no-ops (the shared server isn't ours to
 *     shut down). No binary download, no spawn — connection is instant.
 *   - When MONGO_URI is NOT set (default local dev), it delegates to the real
 *     mongodb-memory-server, preserving the original isolated-DB behaviour.
 *
 * Suites keep calling `MongoMemoryServer.create()`, `.getUri()` and `.stop()`
 * exactly as before.
 */

/* eslint-disable global-require */

// Load the real implementation lazily and only when needed (no MONGO_URI),
// so CI never pays the import cost of the real package.
let realModule = null;
function getReal() {
  if (!realModule) {
    // `jest.requireActual('mongodb-memory-server')` is still rewritten by this
    // file's own moduleNameMapper entry, which would return this stub again and
    // recurse infinitely. The package's entry simply re-exports
    // `mongodb-memory-server-core`, which the mapper (anchored on the exact
    // name) does not match — so requiring core directly loads the genuine
    // implementation without the mapper or any recursion.
    realModule = require('mongodb-memory-server-core');
  }
  return realModule;
}

let dbCounter = 0;

function baseUriFromEnv() {
  const raw = process.env.MONGO_URI;
  if (!raw) return null;
  // Strip any existing path/db segment so we can append our own db name.
  // Handles mongodb:// and mongodb+srv:// with optional query string.
  const match = raw.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/[^?]*)?(\?.*)?$/);
  if (!match) return null;
  return { host: match[1], query: match[2] || '' };
}

function makeStubServer() {
  const parsed = baseUriFromEnv();
  const dbName = `gltest_${process.pid}_${dbCounter++}`;
  const uri = `${parsed.host}/${dbName}${parsed.query}`;
  return {
    getUri: () => uri,
    getDbName: () => dbName,
    stop: async () => true,
    cleanup: async () => true,
    ensureInstance: async () => ({ port: 27017 }),
  };
}

class MongoMemoryServer {
  static async create(...args) {
    if (baseUriFromEnv()) {
      return makeStubServer();
    }
    return getReal().MongoMemoryServer.create(...args);
  }
}

// Mirror the real module's named exports so `require(...)` destructuring works
// regardless of which symbol a suite pulls in.
module.exports = new Proxy(
  { MongoMemoryServer },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Fall through to the real module for any other export (only loads the
      // real package in the local-dev / no-MONGO_URI path).
      return getReal()[prop];
    },
  }
);
