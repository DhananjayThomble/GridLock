const express = require('express');
const router = express.Router();
const Leaderboard = require('../models/Leaderboard');
const GameHistory = require('../models/GameHistory');
const { sanitizeUsername } = require('../utils/sanitize');

router.get('/:username', async (req, res) => {
  try {
    const san = sanitizeUsername(req.params.username);
    if (!san.valid) return res.status(400).json({ success: false, error: 'Invalid username' });

    const username = san.value;
    const [player, recentMatches] = await Promise.all([
      Leaderboard.findOne({ username }).lean(),
      GameHistory.find({ username })
        .sort({ playedAt: -1 })
        .limit(20)
        .lean(),
    ]);

    if (!player) return res.status(404).json({ success: false, error: 'Player not found' });

    // Compute rank using same sort order as leaderboard
    const rank = await Leaderboard.countDocuments({
      $or: [
        { wins: { $gt: player.wins } },
        { wins: player.wins, winRate: { $gt: player.winRate } },
        { wins: player.wins, winRate: player.winRate, elo: { $gt: player.elo } },
      ],
    });

    // Compute derived stats from recent matches
    const gridSizeCounts = {};
    let totalDuration = 0;
    let durationCount = 0;
    const opponentCounts = {};

    for (const match of recentMatches) {
      gridSizeCounts[match.gridSize] = (gridSizeCounts[match.gridSize] || 0) + 1;
      if (match.duration) {
        totalDuration += match.duration;
        durationCount++;
      }
      for (const opp of (match.opponents || [])) {
        opponentCounts[opp] = (opponentCounts[opp] || 0) + 1;
      }
    }

    const favoriteGridSizeEntry = Object.entries(gridSizeCounts).sort((a, b) => b[1] - a[1])[0];
    const favoriteGridSize = favoriteGridSizeEntry ? Number(favoriteGridSizeEntry[0]) : null;
    const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : null;
    const mostPlayedOpponent = Object.entries(opponentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    res.json({
      success: true,
      profile: {
        rank: rank + 1,
        username: player.username,
        gamesPlayed: player.gamesPlayed,
        wins: player.wins,
        losses: player.losses,
        draws: player.draws,
        winRate: player.winRate,
        elo: player.elo,
        bestStreak: player.bestStreak,
        currentStreak: player.currentStreak,
        memberSince: player.createdAt,
        lastPlayedAt: player.lastPlayedAt,
        eloHistory: player.eloHistory || [],
        recentMatches,
        computed: { favoriteGridSize, avgDuration, mostPlayedOpponent },
      },
    });
  } catch (error) {
    console.error('[Profile] GET error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

module.exports = router;
