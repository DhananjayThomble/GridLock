const Leaderboard = require('../models/Leaderboard');

const MAX_ELO_UPDATE_RETRIES = 5;

function buildAtomicLeaderboardUpdate({ username, result, newElo, now = new Date(), gameId = null }) {
    const winInc = result === 'win' ? 1 : 0;
    const lossInc = result === 'loss' ? 1 : 0;
    const drawInc = result === 'draw' ? 1 : 0;

    return [
        {
            $set: {
                username,
                elo: newElo,
                lastPlayedAt: now,
                updatedAt: now,
                createdAt: { $ifNull: ['$createdAt', now] },
                gamesPlayed: { $add: [{ $ifNull: ['$gamesPlayed', 0] }, 1] },
                wins: { $add: [{ $ifNull: ['$wins', 0] }, winInc] },
                losses: { $add: [{ $ifNull: ['$losses', 0] }, lossInc] },
                draws: { $add: [{ $ifNull: ['$draws', 0] }, drawInc] },
                currentStreak:
                    result === 'win'
                        ? { $add: [{ $ifNull: ['$currentStreak', 0] }, 1] }
                        : result === 'loss'
                            ? 0
                            : { $ifNull: ['$currentStreak', 0] },
                bestStreak: { $ifNull: ['$bestStreak', 0] },
            },
        },
        {
            // For win updates, keep bestStreak in sync with the incremented currentStreak.
            $set: {
                bestStreak:
                    result === 'win'
                        ? { $max: ['$bestStreak', '$currentStreak'] }
                        : '$bestStreak',
            },
        },
        {
            $set: {
                winRate: {
                    $cond: [
                        { $gt: ['$gamesPlayed', 0] },
                        {
                            $round: [
                                { $multiply: [{ $divide: ['$wins', '$gamesPlayed'] }, 100] },
                                2,
                            ],
                        },
                        0,
                    ],
                },
            },
        },
        {
            $set: {
                eloHistory: {
                    $slice: [
                        { $concatArrays: [
                            { $ifNull: ['$eloHistory', []] },
                            [{ elo: newElo, date: now, gameId: gameId }],
                        ]},
                        -50,
                    ],
                },
            },
        },
    ];
}

function isDuplicateKeyError(error) {
    return !!error && (error.code === 11000 || error.code === 11001);
}

async function updateLeaderboardWithOptimisticElo({
    username,
    result,
    avgOpponentElo,
    fallbackElo = 1000,
    now = new Date(),
    maxRetries = MAX_ELO_UPDATE_RETRIES,
    gameId = null,
}) {
    const eloScore = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const existing = await Leaderboard.findOne({ username }).select('_id elo').lean();
        const currentElo = Number.isFinite(existing?.elo) ? existing.elo : fallbackElo;
        const newElo = Leaderboard.calculateElo(currentElo, avgOpponentElo, eloScore);

        const filter = existing
            ? { _id: existing._id, elo: currentElo }
            : { username, gamesPlayed: { $exists: false } };

        try {
            const updated = await Leaderboard.findOneAndUpdate(
                filter,
                buildAtomicLeaderboardUpdate({ username, result, newElo, now, gameId }),
                { upsert: !existing, new: true, updatePipeline: true }
            ).lean();

            // `updated` is null when optimistic filter misses due to concurrent writes.
            if (updated) return updated;
        } catch (error) {
            // Upsert races on a unique username can briefly throw duplicate key; retry.
            if (isDuplicateKeyError(error)) continue;
            throw error;
        }
    }

    throw new Error(`Failed to update leaderboard for '${username}' after ${maxRetries} retries`);
}

module.exports = {
    buildAtomicLeaderboardUpdate,
    updateLeaderboardWithOptimisticElo,
};
