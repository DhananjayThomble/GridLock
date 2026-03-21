// tests/fixtures/seed-data.js — Seed beta DB with test data for nightly runs
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gridlock_beta';

async function seed() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();

  // Create test leaderboard entries (matches Leaderboard schema)
  const testEntries = [];
  for (let i = 0; i < 20; i++) {
    const gamesPlayed = 10 + Math.floor(Math.random() * 90);
    const wins = Math.floor(gamesPlayed * (0.2 + Math.random() * 0.6));
    const losses = gamesPlayed - wins;
    testEntries.push({
      username: `nightly_test_${i}`,
      gamesPlayed,
      wins,
      losses,
      draws: 0,
      winRate: parseFloat(((wins / gamesPlayed) * 100).toFixed(2)),
      bestStreak: Math.floor(Math.random() * 10),
      currentStreak: 0,
      elo: 800 + Math.floor(Math.random() * 800),
      lastPlayedAt: new Date(),
      eloHistory: [],
      _testData: true, // Flag for cleanup
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Upsert leaderboard entries
  const leaderboardOps = testEntries.map(entry => ({
    updateOne: {
      filter: { username: entry.username },
      update: { $set: entry },
      upsert: true,
    },
  }));

  const result = await db.collection('leaderboards').bulkWrite(leaderboardOps);
  console.log(`✅ Seeded ${testEntries.length} leaderboard entries (upserted: ${result.upsertedCount}, modified: ${result.modifiedCount})`);

  await client.close();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
