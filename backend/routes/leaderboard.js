// routes/leaderboard.js
const express = require('express');
const router = express.Router();
const Leaderboard = require('../models/Leaderboard');
const { sanitizeUsername } = require('../utils/sanitize');
const log = require('../utils/logger');
const {
    buildAtomicLeaderboardUpdate,
    updateLeaderboardWithOptimisticElo,
} = require('../services/leaderboardUpdateService');

/**
 * GET /api/leaderboard
 * Returns top players sorted by wins (desc), then winRate (desc), then elo (desc).
 */
router.get('/', async (req, res) => {
    try {
        const parsedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 10;

        const players = await Leaderboard.find({})
            .sort({ wins: -1, winRate: -1, elo: -1 })
            .limit(limit)
            .select('username gamesPlayed wins losses draws winRate bestStreak currentStreak elo lastPlayedAt createdAt')
            .lean();

        const leaderboard = players.map((player, index) => ({
            rank: index + 1,
            username: player.username,
            gamesPlayed: player.gamesPlayed,
            wins: player.wins,
            losses: player.losses,
            draws: player.draws,
            winRate: player.winRate,
            bestStreak: player.bestStreak,
            currentStreak: player.currentStreak,
            elo: player.elo,
            lastPlayedAt: player.lastPlayedAt,
            memberSince: player.createdAt,
        }));

        res.json({ success: true, count: leaderboard.length, leaderboard });
    } catch (error) {
        log.error('[Leaderboard] GET error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
    }
});

/**
 * GET /api/leaderboard/:username
 * Returns stats for a specific player.
 */
router.get('/:username', async (req, res) => {
    try {
        const san = sanitizeUsername(req.params.username);
        if (!san.valid) {
            return res.status(400).json({ success: false, error: 'Invalid username' });
        }

        const username = san.value;
        const player = await Leaderboard.findOne({ username }).lean();
        if (!player) {
            return res.status(404).json({ success: false, error: 'Player not found' });
        }

        // Compute rank by same sort precedence: wins > winRate > elo
        const rank = await Leaderboard.countDocuments({
            $or: [
                { wins: { $gt: player.wins } },
                { wins: player.wins, winRate: { $gt: player.winRate } },
                { wins: player.wins, winRate: player.winRate, elo: { $gt: player.elo } },
            ],
        });

        res.json({
            success: true,
            player: {
                rank: rank + 1,
                username: player.username,
                gamesPlayed: player.gamesPlayed,
                wins: player.wins,
                losses: player.losses,
                draws: player.draws,
                winRate: player.winRate,
                bestStreak: player.bestStreak,
                currentStreak: player.currentStreak,
                elo: player.elo,
                lastPlayedAt: player.lastPlayedAt,
                memberSince: player.createdAt,
            },
        });
    } catch (error) {
        log.error('[Leaderboard] GET /:username error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch player stats' });
    }
});

/**
 * POST /api/leaderboard
 * Submit/update player score after a game.
 *
 * NOTE: by product decision this endpoint is username-based (no auth) for now.
 */
router.post('/', async (req, res) => {
    try {
        const { username, result, opponentElo, opponentUsernames } = req.body;

        if (username === undefined || username === null) {
            return res.status(400).json({ success: false, error: 'username is required' });
        }

        const san = sanitizeUsername(username);
        if (!san.valid) {
            return res.status(400).json({ success: false, error: san.error || 'invalid username' });
        }
        const cleanUsername = san.value;

        const validResults = ['win', 'loss', 'draw'];
        if (!result || !validResults.includes(result)) {
            return res.status(400).json({
                success: false,
                error: `result must be one of: ${validResults.join(', ')}`,
            });
        }

        // Determine opponent ELO for calculation.
        let avgOpponentElo = 1000;
        const parsedOpponentElo = Number(opponentElo);
        if (Number.isFinite(parsedOpponentElo) && parsedOpponentElo >= 0) {
            avgOpponentElo = parsedOpponentElo;
        }

        if (Array.isArray(opponentUsernames)) {
            // Normalize, dedupe, and exclude self.
            const cleanedOpponentUsernames = Array.from(
                new Set(
                    opponentUsernames
                        .filter((u) => typeof u === 'string')
                        .map((u) => sanitizeUsername(u))
                        .filter((s) => s.valid)
                        .map((s) => s.value)
                        .filter((u) => u && u !== cleanUsername)
                )
            ).slice(0, 50);

            if (cleanedOpponentUsernames.length > 0) {
                try {
                    const opponents = await Leaderboard.find({ username: { $in: cleanedOpponentUsernames } })
                        .select('elo')
                        .lean();
                    if (opponents.length > 0) {
                        avgOpponentElo = Math.round(
                            opponents.reduce((sum, o) => sum + (Number.isFinite(o.elo) ? o.elo : 1000), 0) /
                            opponents.length
                        );
                    }
                } catch (_) {
                    // Fall back to default if lookup fails.
                }
            }
        }

        const updatedPlayer = await updateLeaderboardWithOptimisticElo({
            username: cleanUsername,
            result,
            avgOpponentElo,
        });

        res.status(200).json({
            success: true,
            message: 'Player stats updated',
            player: {
                username: updatedPlayer.username,
                gamesPlayed: updatedPlayer.gamesPlayed,
                wins: updatedPlayer.wins,
                losses: updatedPlayer.losses,
                draws: updatedPlayer.draws,
                winRate: updatedPlayer.winRate,
                bestStreak: updatedPlayer.bestStreak,
                currentStreak: updatedPlayer.currentStreak,
                elo: updatedPlayer.elo,
                lastPlayedAt: updatedPlayer.lastPlayedAt,
            },
        });
    } catch (error) {
        log.error('[Leaderboard] POST error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update player stats' });
    }
});

module.exports = router;
module.exports.buildAtomicLeaderboardUpdate = buildAtomicLeaderboardUpdate;
module.exports.updateLeaderboardWithOptimisticElo = updateLeaderboardWithOptimisticElo;
