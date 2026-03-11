// models/RankedProfile.js
const mongoose = require('mongoose');

/**
 * Tier thresholds for ranked play.
 * Bronze (0-999) → Silver (1000-1299) → Gold (1300-1499) → Platinum (1500-1699) → Diamond (1700+)
 */
const TIER_THRESHOLDS = [
    { name: 'Diamond',  icon: '💎', minElo: 1700 },
    { name: 'Platinum', icon: '🏆', minElo: 1500 },
    { name: 'Gold',     icon: '🥇', minElo: 1300 },
    { name: 'Silver',   icon: '🥈', minElo: 1000 },
    { name: 'Bronze',   icon: '🥉', minElo: 0 },
];

/**
 * Derive tier from ELO rating.
 * @param {number} elo
 * @returns {{ name: string, icon: string }}
 */
function getTierFromElo(elo) {
    const safeElo = Number.isFinite(elo) ? elo : 1200;
    for (const tier of TIER_THRESHOLDS) {
        if (safeElo >= tier.minElo) return { name: tier.name, icon: tier.icon };
    }
    return { name: 'Bronze', icon: '🥉' };
}

/**
 * Calculate ranked ELO change.
 * K-factor: 32 during placement (first 5 games), 16 after.
 * Weighted by tier difference between players.
 *
 * @param {number} playerElo
 * @param {number} opponentElo
 * @param {number} score - 1 for win, 0 for loss (no draws in ranked)
 * @param {boolean} isPlacement - whether the player is still in placement
 * @returns {number} New ELO rating
 */
function calculateRankedElo(playerElo, opponentElo, score, isPlacement = false) {
    const safePlayer = Number.isFinite(playerElo) ? playerElo : 1200;
    const safeOpponent = Number.isFinite(opponentElo) ? opponentElo : 1200;

    const kFactor = isPlacement ? 32 : 16;

    // Weight by tier difference: larger K when fighting higher-tier opponents
    const eloDiff = safeOpponent - safePlayer;
    const tierWeight = 1 + Math.max(0, eloDiff) / 400; // up to 2x for 400+ ELO gap

    const expectedScore = 1 / (1 + Math.pow(10, (safeOpponent - safePlayer) / 400));
    const adjustedK = kFactor * tierWeight;
    const newElo = Math.round(safePlayer + adjustedK * (score - expectedScore));
    return Math.max(0, newElo);
}

/**
 * Perform a soft season reset: compress ELO toward 1200 by 50%.
 * @param {number} currentElo
 * @returns {number}
 */
function softResetElo(currentElo) {
    const safeElo = Number.isFinite(currentElo) ? currentElo : 1200;
    return Math.round(1200 + (safeElo - 1200) * 0.5);
}

const PLACEMENT_GAMES_REQUIRED = 5;
const COOLDOWN_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const RankedProfileSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        elo: {
            type: Number,
            default: 1200,
            min: 0,
        },
        tier: {
            type: String,
            default: 'Bronze',
            enum: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'],
        },
        tierIcon: {
            type: String,
            default: '🥉',
        },
        season: {
            type: Number,
            default: 1,
            min: 1,
        },
        placementGames: {
            type: [
                {
                    result: { type: String, enum: ['win', 'loss'] },
                    opponentElo: { type: Number },
                    eloAfter: { type: Number },
                    playedAt: { type: Date, default: Date.now },
                    _id: false,
                },
            ],
            default: [],
        },
        wins: {
            type: Number,
            default: 0,
            min: 0,
        },
        losses: {
            type: Number,
            default: 0,
            min: 0,
        },
        cooldownUntil: {
            type: Date,
            default: null,
        },
        lastPlayedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Index for ranked leaderboard sorting
RankedProfileSchema.index({ elo: -1, wins: -1 });

/**
 * Update tier based on current ELO before saving.
 */
RankedProfileSchema.pre('save', function () {
    const tierInfo = getTierFromElo(this.elo);
    this.tier = tierInfo.name;
    this.tierIcon = tierInfo.icon;
});

/**
 * Check if player is still in placement.
 */
RankedProfileSchema.methods.isInPlacement = function () {
    return this.placementGames.length < PLACEMENT_GAMES_REQUIRED;
};

/**
 * Check if player is currently on cooldown.
 */
RankedProfileSchema.methods.isOnCooldown = function () {
    if (!this.cooldownUntil) return false;
    return new Date() < this.cooldownUntil;
};

const RankedProfile = mongoose.model('RankedProfile', RankedProfileSchema);

module.exports = RankedProfile;
module.exports.getTierFromElo = getTierFromElo;
module.exports.calculateRankedElo = calculateRankedElo;
module.exports.softResetElo = softResetElo;
module.exports.PLACEMENT_GAMES_REQUIRED = PLACEMENT_GAMES_REQUIRED;
module.exports.COOLDOWN_DURATION_MS = COOLDOWN_DURATION_MS;
module.exports.TIER_THRESHOLDS = TIER_THRESHOLDS;
