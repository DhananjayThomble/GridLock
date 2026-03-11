// routes/ranked.js
const express = require('express');
const router = express.Router();
const RankedProfile = require('../models/RankedProfile');
const { getTierFromElo, softResetElo } = require('../models/RankedProfile');
const { sanitizeUsername } = require('../utils/sanitize');

/**
 * GET /api/ranked/profile/:username
 * Returns ranked profile for a specific player.
 */
router.get('/profile/:username', async (req, res) => {
    try {
        const san = sanitizeUsername(req.params.username);
        if (!san.valid) {
            return res.status(400).json({ success: false, error: 'Invalid username' });
        }

        const username = san.value;
        const profile = await RankedProfile.findOne({ username }).lean();

        if (!profile) {
            return res.status(404).json({ success: false, error: 'Ranked profile not found' });
        }

        // Compute rank
        const rank = await RankedProfile.countDocuments({ elo: { $gt: profile.elo } });

        const tierInfo = getTierFromElo(profile.elo);

        res.json({
            success: true,
            profile: {
                rank: rank + 1,
                username: profile.username,
                elo: profile.elo,
                tier: tierInfo.name,
                tierIcon: tierInfo.icon,
                season: profile.season,
                wins: profile.wins,
                losses: profile.losses,
                gamesPlayed: profile.wins + profile.losses,
                winRate: (profile.wins + profile.losses) > 0
                    ? parseFloat(((profile.wins / (profile.wins + profile.losses)) * 100).toFixed(2))
                    : 0,
                placementGames: profile.placementGames || [],
                isInPlacement: (profile.placementGames || []).length < 5,
                cooldownUntil: profile.cooldownUntil,
                isOnCooldown: profile.cooldownUntil ? new Date() < new Date(profile.cooldownUntil) : false,
                lastPlayedAt: profile.lastPlayedAt,
                memberSince: profile.createdAt,
            },
        });
    } catch (error) {
        console.error('[Ranked] GET profile error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch ranked profile' });
    }
});

/**
 * GET /api/ranked/leaderboard
 * Returns top ranked players sorted by ELO (desc).
 */
router.get('/leaderboard', async (req, res) => {
    try {
        const parsedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;

        const players = await RankedProfile.find({})
            .sort({ elo: -1, wins: -1 })
            .limit(limit)
            .select('username elo tier tierIcon season wins losses placementGames lastPlayedAt createdAt')
            .lean();

        const leaderboard = players.map((player, index) => {
            const tierInfo = getTierFromElo(player.elo);
            const gamesPlayed = player.wins + player.losses;
            return {
                rank: index + 1,
                username: player.username,
                elo: player.elo,
                tier: tierInfo.name,
                tierIcon: tierInfo.icon,
                season: player.season,
                wins: player.wins,
                losses: player.losses,
                gamesPlayed,
                winRate: gamesPlayed > 0
                    ? parseFloat(((player.wins / gamesPlayed) * 100).toFixed(2))
                    : 0,
                isInPlacement: (player.placementGames || []).length < 5,
                lastPlayedAt: player.lastPlayedAt,
                memberSince: player.createdAt,
            };
        });

        res.json({ success: true, count: leaderboard.length, leaderboard });
    } catch (error) {
        console.error('[Ranked] GET leaderboard error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch ranked leaderboard' });
    }
});

/**
 * POST /api/ranked/season-reset
 * Trigger a seasonal soft reset for all ranked profiles.
 * Compresses ELO toward 1200 by 50%, increments season, clears placement.
 */
router.post('/season-reset', async (req, res) => {
    try {
        const profiles = await RankedProfile.find({});
        let resetCount = 0;

        for (const profile of profiles) {
            const newElo = softResetElo(profile.elo);
            const tierInfo = getTierFromElo(newElo);

            profile.elo = newElo;
            profile.tier = tierInfo.name;
            profile.tierIcon = tierInfo.icon;
            profile.season += 1;
            profile.placementGames = [];
            profile.wins = 0;
            profile.losses = 0;
            profile.cooldownUntil = null;

            await profile.save();
            resetCount++;
        }

        res.json({
            success: true,
            message: `Season reset complete. ${resetCount} profiles updated.`,
            resetCount,
        });
    } catch (error) {
        console.error('[Ranked] Season reset error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to perform season reset' });
    }
});

module.exports = router;
