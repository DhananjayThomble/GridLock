// tests/fixtures/cleanup.js — Remove all test data flagged with _testData: true
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock_beta';

async function cleanup() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();

  // Remove seeded leaderboard entries
  const lbResult = await db.collection('leaderboards').deleteMany({ _testData: true });
  console.log(`🧹 Removed ${lbResult.deletedCount} test leaderboard entries`);

  // Remove games created by nightly_test_* users
  const gameResult = await db.collection('games').deleteMany({
    'players.player1.username': { $regex: /^nightly_test_/ },
  });
  console.log(`🧹 Removed ${gameResult.deletedCount} test games`);

  // Remove game history created by nightly_test_* users
  const histResult = await db.collection('gamehistories').deleteMany({
    'players.username': { $regex: /^nightly_test_/ },
  });
  console.log(`🧹 Removed ${histResult.deletedCount} test game histories`);

  await client.close();
  console.log('✅ Cleanup complete');
}

cleanup().catch(err => {
  console.error('❌ Cleanup failed:', err.message);
  process.exit(1);
});
