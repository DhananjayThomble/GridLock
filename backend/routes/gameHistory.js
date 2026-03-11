// backend/routes/gameHistory.js
// API endpoint for player game history with pagination, filters, and stats

const express = require('express');
const router = express.Router();
const GameHistory = require('../models/GameHistory');
const { sanitizeUsername } = require('../utils/sanitize');

/**
 * GET /api/games/history
 * Query params:
 *   player   - username (required)
 *   page     - page number (default 1)
 *   limit    - items per page (default 20, max 50)
 *   result   - filter: 'win' | 'loss' | 'draw'
 *   playerCount - filter: 2 | 3 | 4
 *   gridSize - filter: 2-10
 */
router.get('/', async (req, res) => {
    try {
        const { player, result, playerCount, gridSize } = req.query;

        if (!player || typeof player !== 'string') {
            return res.status(400).json({ success: false, error: 'player query parameter is required' });
        }

        const san = sanitizeUsername(player);
        if (!san.valid) {
            return res.status(400).json({ success: false, error: san.error || 'Invalid username' });
        }
        const username = san.value;

        // Pagination
        const parsedPage = Number.parseInt(req.query.page, 10);
        const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

        const parsedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;

        // Build filter query
        const query = { username };

        if (result && ['win', 'loss', 'draw'].includes(result)) {
            query.result = result;
        }

        const parsedPlayerCount = Number.parseInt(playerCount, 10);
        if (Number.isFinite(parsedPlayerCount) && parsedPlayerCount >= 2 && parsedPlayerCount <= 4) {
            query.playerCount = parsedPlayerCount;
        }

        const parsedGridSize = Number.parseInt(gridSize, 10);
        if (Number.isFinite(parsedGridSize) && parsedGridSize >= 2 && parsedGridSize <= 10) {
            query.gridSize = parsedGridSize;
        }

        const skip = (page - 1) * limit;

        // Run count and find in parallel
        const [totalCount, games] = await Promise.all([
            GameHistory.countDocuments(query),
            GameHistory.find(query)
                .sort({ playedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ]);

        const totalPages = Math.ceil(totalCount / limit) || 1;

        // Build stats summary (unfiltered, for the player)
        const statsQuery = { username };
        const [allGames, statsAgg] = await Promise.all([
            GameHistory.countDocuments(statsQuery),
            GameHistory.aggregate([
                { $match: statsQuery },
                {
                    $group: {
                        _id: null,
                        wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                        losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
                        draws: { $sum: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
                        avgDuration: { $avg: '$duration' },
                    },
                },
            ]),
        ]);

        const stats = statsAgg[0] || { wins: 0, losses: 0, draws: 0, avgDuration: 0 };
        const winRate = allGames > 0 ? Math.round((stats.wins / allGames) * 100) : 0;

        // Calculate current streak from most recent games
        let currentStreak = { type: null, count: 0 };
        if (allGames > 0) {
            const recentGames = await GameHistory.find(statsQuery)
                .sort({ playedAt: -1 })
                .limit(50)
                .select('result')
                .lean();

            if (recentGames.length > 0) {
                const streakType = recentGames[0].result;
                let streakCount = 0;
                for (const g of recentGames) {
                    if (g.result === streakType) {
                        streakCount++;
                    } else {
                        break;
                    }
                }
                currentStreak = { type: streakType, count: streakCount };
            }
        }

        // Format game entries
        const history = games.map((g) => ({
            gameId: g.gameId,
            opponents: g.opponents || [],
            playerCount: g.playerCount,
            gridSize: g.gridSize,
            result: g.result,
            scores: g.scores || { player: 0, opponent: 0 },
            eloBefore: g.eloBefore,
            eloAfter: g.eloAfter,
            eloDelta: g.eloAfter != null && g.eloBefore != null ? g.eloAfter - g.eloBefore : null,
            duration: g.duration,
            playedAt: g.playedAt,
        }));

        res.json({
            success: true,
            history,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
            },
            stats: {
                totalGames: allGames,
                wins: stats.wins,
                losses: stats.losses,
                draws: stats.draws,
                winRate,
                avgDuration: stats.avgDuration ? Math.round(stats.avgDuration) : null,
                currentStreak,
            },
        });
    } catch (error) {
        console.error('[GameHistory] GET error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch game history' });
    }
});

module.exports = router;
