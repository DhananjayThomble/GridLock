// backend/routes/replay.js
// API endpoint for game replay data + OG meta tags for social sharing

const express = require('express');
const router = express.Router();
const Game = require('../models/Game');

// Escape user-supplied strings for safe interpolation into HTML
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


/**
 * GET /api/games/:gameId/og
 * Returns an HTML page with OG meta tags for social media link previews.
 */
router.get('/:gameId/og', async (req, res) => {
    try {
        const { gameId } = req.params;
        if (!gameId || typeof gameId !== 'string' || gameId.length > 12) {
            return res.status(400).send('Invalid game ID');
        }
        const cleanGameId = gameId.trim().toUpperCase();
        const game = await Game.findOne({ gameId: cleanGameId }).lean();

        const siteUrl = process.env.SITE_URL || 'https://gridlock.pro';
        const replayUrl = `${siteUrl}/replay/${cleanGameId}`;

        if (!game) {
            return res.redirect(302, replayUrl);
        }

        const rawPlayers = game.players instanceof Map
            ? Object.fromEntries(game.players)
            : (game.players || {});

        const playerNames = Object.values(rawPlayers)
            .filter(p => p && p.username)
            .map(p => escapeHtml(p.username))
            .join(' vs ');

        const winner = game.gameState?.winner;
        const winnerName = winner && winner !== 'draw' && rawPlayers[winner]
            ? escapeHtml(rawPlayers[winner].username)
            : null;

        const title = winnerName
            ? `${winnerName} wins! — GridLock Replay`
            : winner === 'draw'
                ? `It&#39;s a draw! — GridLock Replay`
                : `GridLock Replay — ${playerNames || cleanGameId}`;

        const description = `Watch the ${escapeHtml(String(game.gridSize))}×${escapeHtml(String(game.gridSize))} GridLock game replay: ${playerNames}`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${replayUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GridLock">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta http-equiv="refresh" content="0;url=${replayUrl}">
</head>
<body>
<p>Redirecting to <a href="${replayUrl}">GridLock Replay</a>...</p>
</body>
</html>`;

        res.set('Content-Type', 'text/html').send(html);
    } catch (err) {
        console.error('OG meta endpoint error:', err.message);
        res.status(500).send('Server error');
    }
});

/**
 * GET /api/games/:gameId/replay
 * Returns move history + metadata for replaying a finished (or abandoned) game.
 */
router.get('/:gameId/replay', async (req, res) => {
    try {
        const { gameId } = req.params;

        if (!gameId || typeof gameId !== 'string' || gameId.length > 12) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        const cleanGameId = gameId.trim().toUpperCase();

        const game = await Game.findOne({ gameId: cleanGameId }).lean();

        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }

        // Build player metadata
        const players = {};
        const rawPlayers = game.players instanceof Map
            ? Object.fromEntries(game.players)
            : (game.players || {});

        for (const [slot, player] of Object.entries(rawPlayers)) {
            if (player) {
                players[slot] = {
                    username: player.username,
                    avatar: player.avatar || '👤',
                    color: player.color,
                    isCPU: !!player.isCPU,
                };
            }
        }

        const moveHistory = (game.moveHistory || []).map((m) => ({
            player: m.player,
            row: m.row,
            col: m.col,
            type: m.type,
            timestamp: m.timestamp,
        }));

        const scores = game.gameState?.scores || {};
        const winner = game.gameState?.winner || null;

        res.json({
            gameId: game.gameId,
            gridSize: game.gridSize,
            playerCount: game.playerCount,
            players,
            moveHistory,
            scores,
            winner,
            status: game.status,
            createdAt: game.createdAt,
            finishedAt: game.finishedAt,
        });
    } catch (err) {
        console.error('Replay API error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
