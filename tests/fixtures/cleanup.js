// tests/fixtures/cleanup.js — Remove all test data created by nightly/weekly test suites
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock_beta';

// Comprehensive list of test username patterns used across all test files.
// Covers: seed-data (nightly_test_*), test-helpers defaults (NightlyAlice, NightlyBob, NightlyCPU),
// nightly specs, weekly specs, and k6 load tests.
const TEST_USERNAME_PATTERNS = [
  /^nightly_test_/,       // seed-data.js
  /^Nightly/,             // NightlyAlice, NightlyBob, NightlyCPU, NightlyP1/P2, NightlySolo, NightlyScore, NightlySpec1/2, NightlyWatcher, NightlyReplay, Nightly3G
  /^Lat[A-Z]/,            // LatP1, LatP2
  /^Perf/,                // PerfStart, PerfMove
  /^Simul[A-Z]/,          // SimulP1, SimulP2
  /^Disco[A-Z]/,          // DiscoP1, DiscoP2
  /^Leave[A-Z]/,          // LeaveP1, LeaveP2
  /^Chat[A-Z]/,           // ChatP1, ChatP2
  /^Mobile/,              // MobileIphone
  /^Pixel/,               // PixelHost, PixelJoin
  /^Tablet/,              // TabletPlayer
  /^Drop[A-Z]/,           // DropP1, DropP2
  /^RapidDisco/,          // RapidDiscoP1
  /^RapidP2_/,            // RapidP2_0, RapidP2_1, ...
  /^ChaosBaseline$/,      // redis-latency.spec.js
  /^VisualBoard$/,        // visual-regression.spec.js
  /^k6_load_/,            // load-test.k6.js
];

// Build a single regex that matches any of the patterns
const TEST_USERNAME_REGEX = new RegExp(
  TEST_USERNAME_PATTERNS.map(r => r.source).join('|')
);

async function cleanup() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();

  // Remove seeded leaderboard entries
  const lbResult = await db.collection('leaderboards').deleteMany({ _testData: true });
  console.log(`🧹 Removed ${lbResult.deletedCount} test leaderboard entries`);

  // Remove games created by test users.
  // Game.players is a Map keyed by player1, player2, etc. — each value has a username field.
  // MongoDB stores Map fields as objects, so we query across all possible player slots.
  const gameResult = await db.collection('games').deleteMany({
    $or: [
      { 'players.player1.username': { $regex: TEST_USERNAME_REGEX } },
      { 'players.player2.username': { $regex: TEST_USERNAME_REGEX } },
      { 'players.player3.username': { $regex: TEST_USERNAME_REGEX } },
      { 'players.player4.username': { $regex: TEST_USERNAME_REGEX } },
    ],
  });
  console.log(`🧹 Removed ${gameResult.deletedCount} test games`);

  // Remove game history created by test users.
  // GameHistory has `username` at top level (not nested under players).
  const histResult = await db.collection('gamehistories').deleteMany({
    username: { $regex: TEST_USERNAME_REGEX },
  });
  console.log(`🧹 Removed ${histResult.deletedCount} test game histories`);

  // Remove daily results from test users
  const dailyResult = await db.collection('dailyresults').deleteMany({
    username: { $regex: TEST_USERNAME_REGEX },
  });
  console.log(`🧹 Removed ${dailyResult.deletedCount} test daily results`);

  await client.close();
  console.log('✅ Cleanup complete');
}

cleanup().catch(err => {
  console.error('❌ Cleanup failed:', err.message);
  process.exit(1);
});
