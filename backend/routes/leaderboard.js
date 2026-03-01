// routes/leaderboard.js
const express = require('express');
const router = express.Router();
const Leaderboard = require('../models/Leaderboard');

/**
 * GET /api/leaderboard
 * Returns top 10 players sorted by wins (desc), then winRate (desc), then elo (desc).
 */
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);

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

        res.json({
            success: true,
            count: leaderboard.length,
            leaderboard,
        });
    } catch (error) {
        console.error('[Leaderboard] GET error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
    }
});

/**
 * GET /api/leaderboard/:username
 * Returns stats for a specific player.
 */
router.get('/:username', async (req, res) => {
    try {
        const { username } = req.params;
        if (!username || username.length > 30) {
            return res.status(400).json({ success: false, error: 'Invalid username' });
        }

        const player = await Leaderboard.findOne({ username }).lean();
        if (!player) {
            return res.status(404).json({ success: false, error: 'Player not found' });
        }

        // Compute rank
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
        console.error('[Leaderboard] GET /:username error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch player stats' });
    }
});

/**
 * POST /api/leaderboard
 * Submit/update player score after a game.
 *
 * Body:
 *   - username {string} required
 *   - result {string} 'win' | 'loss' | 'draw'  required
 *   - opponentElo {number} optional (for ELO calculation; defaults to 1000)
 *   - opponentUsernames {string[]} optional (list of opponent names for multi-player ELO avg)
 */
router.post('/', async (req, res) => {
    try {
        const { username, result, opponentElo, opponentUsernames } = req.body;

        // --- Validation ---
        if (!username || typeof username !== 'string' || username.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'username is required' });
        }
        const cleanUsername = username.trim().substring(0, 30);

        const validResults = ['win', 'loss', 'draw'];
        if (!result || !validResults.includes(result)) {
            return res.status(400).json({
                success: false,
                error: `result must be one of: ${validResults.join(', ')}`,
            });
        }

        // --- Fetch or create player record ---
        let player = await Leaderboard.findOne({ username: cleanUsername });
        if (!player) {
            player = new Leaderboard({ username: cleanUsername });
        }

        // --- Determine opponent ELO for ELO calculation ---
        let avgOpponentElo = opponentElo != null ? Number(opponentElo) : 1000;
        if (opponentUsernames && Array.isArray(opponentUsernames) && opponentUsernames.length > 0) {
            try {
                const opponents = await Leaderboard.find({
                    username: { $in: opponentUsernames.map((u) => u.trim()) },
                }).select('elo').lean();
                if (opponents.length > 0) {
                    avgOpponentElo = Math.round(
                        opponents.reduce((sum, o) => sum + o.elo, 0) / opponents.length
                    );
                }
            } catch (_) {
                // Fall back to default if lookup fails
            }
        }

        // --- Update stats ---
        player.gamesPlayed += 1;
        player.lastPlayedAt = new Date();

        const eloScore = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
        const newElo = Leaderboard.calculateElo(player.elo, avgOpponentElo, eloScore);
        player.elo = newElo;

        if (result === 'win') {
            player.wins += 1;
            player.currentStreak += 1;
            if (player.currentStreak > player.bestStreak) {
                player.bestStreak = player.currentStreak;
            }
        } else if (result === 'loss') {
            player.losses += 1;
            player.currentStreak = 0;
        } else {
            // draw
            player.draws += 1;
            // streak is maintained on draws
        }

        // winRate is recalculated in the pre-save hook
        await player.save();

        res.status(200).json({
            success: true,
            message: 'Player stats updated',
            player: {
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
            },
        });
    } catch (error) {
        if (error.code === 11000) {
            // Rare race condition on unique index — retry once
            return res.status(409).json({ success: false, error: 'Concurrent update conflict; please retry' });
        }
        console.error('[Leaderboard] POST error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to update player stats' });
    }
});

module.exports = router;
