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
 * Requires `x-admin-key` header matching ADMIN_API_KEY env var.
 */
router.post('/season-reset', async (req, res) => {
    // Authentication: require admin API key (Fix #2)
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
        return res.status(503).json({ success: false, error: 'Admin API key not configured on server' });
    }
    const providedKey = req.headers['x-admin-key'];
    if (!providedKey || providedKey !== adminKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized — invalid or missing admin key' });
    }

    try {
        // Use bulk updateMany for efficiency — no OOM risk (Fix #7)
        const currentSeason = await RankedProfile.findOne({}).sort({ season: -1 }).select('season').lean();
        const newSeasonNumber = (currentSeason?.season || 1) + 1;

        const result = await RankedProfile.updateMany({}, [
            {
                $set: {
                    elo: {
                        $max: [
                            0,
                            { $round: [{ $add: [{ $multiply: [{ $subtract: ['$elo', 1200] }, 0.5] }, 1200] }, 0] },
                        ],
                    },
                    season: newSeasonNumber,
                    placementGames: [],
                    wins: 0,
                    losses: 0,
                    cooldownUntil: null,
                },
            },
        ], { updatePipeline: true });

        // Update tier fields in bulk (tier is derived from elo via pre-save hook,
        // but updateMany bypasses hooks — so we update tiers with a second bulk op)
        const tierUpdates = [
            { filter: { elo: { $gte: 1700 } }, update: { $set: { tier: 'Diamond', tierIcon: '💎' } } },
            { filter: { elo: { $gte: 1500, $lt: 1700 } }, update: { $set: { tier: 'Platinum', tierIcon: '🏆' } } },
            { filter: { elo: { $gte: 1300, $lt: 1500 } }, update: { $set: { tier: 'Gold', tierIcon: '🥇' } } },
            { filter: { elo: { $gte: 1000, $lt: 1300 } }, update: { $set: { tier: 'Silver', tierIcon: '🥈' } } },
            { filter: { elo: { $lt: 1000 } }, update: { $set: { tier: 'Bronze', tierIcon: '🥉' } } },
        ];
        for (const { filter, update } of tierUpdates) {
            await RankedProfile.updateMany(filter, update);
        }

        res.json({
            success: true,
            message: `Season reset complete. ${result.modifiedCount} profiles updated to season ${newSeasonNumber}.`,
            resetCount: result.modifiedCount,
            newSeason: newSeasonNumber,
        });
    } catch (error) {
        console.error('[Ranked] Season reset error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to perform season reset' });
    }
});

module.exports = router;
