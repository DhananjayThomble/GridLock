// backend/routes/gameHistory.js
// API endpoint for player game history with pagination, filters, and stats

const express = require('express');
const router = express.Router();
const GameHistory = require('../models/GameHistory');
const { sanitizeUsername } = require('../utils/sanitize');

/**
 * GET /api/games/history
 * Query params:
 *   player      - username (required)
 *   page        - page number (default 1)
 *   limit       - items per page (default 20, max 50)
 *   result      - filter: 'win' | 'loss' | 'draw'
 *   playerCount - filter: 2 | 3 | 4
 *   gridSize    - filter: 2-10
 *   skipStats   - if 'true', omit stats from response (for page > 1 navigations)
 *
 * Performance note: Filtered queries (result, playerCount, gridSize) use the
 * { username, playedAt } compound index for sorting but may scan extra docs
 * when filtering on other fields. At scale, consider adding these compound indexes:
 *   { username: 1, result: 1, playedAt: -1 }
 *   { username: 1, playerCount: 1, playedAt: -1 }
 *   { username: 1, gridSize: 1, playedAt: -1 }
 */
router.get('/', async (req, res) => {
    try {
        const { player, result, playerCount, gridSize, skipStats } = req.query;

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
        const shouldSkipStats = skipStats === 'true';

        // Projection — only select fields we need (#3)
        const projection = 'gameId opponents playerCount gridSize result scores eloBefore eloAfter duration playedAt';

        // Build parallel queries: count + find always; stats aggregate only when needed (#1, #2)
        const queries = [
            GameHistory.countDocuments(query),
            GameHistory.find(query)
                .select(projection)
                .sort({ playedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ];

        // Stats aggregate: unfiltered for the player, includes streak computation
        // Only compute on first page load (skipStats=false) (#2)
        if (!shouldSkipStats) {
            const statsQuery = { username };
            queries.push(
                GameHistory.aggregate([
                    { $match: statsQuery },
                    { $sort: { playedAt: -1 } },
                    {
                        $group: {
                            _id: null,
                            wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
                            losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
                            draws: { $sum: { $cond: [{ $eq: ['$result', 'draw'] }, 1, 0] } },
                            avgDuration: { $avg: '$duration' },
                            // Collect recent results (sorted desc) for streak calculation
                            recentResults: { $push: '$result' },
                        },
                    },
                ])
            );
        }

        const results = await Promise.all(queries);
        const totalCount = results[0];
        const games = results[1];
        const totalPages = Math.ceil(totalCount / limit) || 1;

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

        // Build response
        const response = {
            success: true,
            history,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
            },
        };

        // Attach stats only when computed (#1, #2)
        if (!shouldSkipStats) {
            const statsAgg = results[2];
            const agg = statsAgg[0] || { wins: 0, losses: 0, draws: 0, avgDuration: 0, recentResults: [] };

            // totalGames derived from aggregate — no extra countDocuments needed (#1)
            const totalGames = agg.wins + agg.losses + agg.draws;
            const winRate = totalGames > 0 ? Math.round((agg.wins / totalGames) * 100) : 0;

            // Compute streak from recentResults (already sorted by playedAt desc via $sort before $group)
            let currentStreak = { type: null, count: 0 };
            const recent = agg.recentResults || [];
            if (recent.length > 0) {
                const streakType = recent[0];
                let streakCount = 0;
                for (const r of recent) {
                    if (r === streakType) {
                        streakCount++;
                    } else {
                        break;
                    }
                }
                currentStreak = { type: streakType, count: streakCount };
            }

            response.stats = {
                totalGames,
                wins: agg.wins,
                losses: agg.losses,
                draws: agg.draws,
                winRate,
                avgDuration: agg.avgDuration ? Math.round(agg.avgDuration) : null,
                currentStreak,
            };
        }

        res.json(response);
    } catch (error) {
        console.error('[GameHistory] GET error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch game history' });
    }
});

module.exports = router;
