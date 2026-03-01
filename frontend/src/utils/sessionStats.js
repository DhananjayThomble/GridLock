// src/utils/sessionStats.js
// Manages session game stats in localStorage — no backend needed

const STORAGE_KEY = 'gridlock_session_stats';

const DEFAULT_STATS = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  currentStreak: 0,
  bestStreak: 0,
  bestTerritory: 0,
  totalTerritoryPct: 0,
  history: [], // last 10 games
};

export const getStats = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_STATS, ...JSON.parse(raw) } : { ...DEFAULT_STATS };
  } catch {
    return { ...DEFAULT_STATS };
  }
};

const saveStats = (stats) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // localStorage unavailable — silently fail
  }
};

export const recordGame = (outcome, territoryPct, players, gridSize) => {
  const stats = getStats();

  stats.gamesPlayed += 1;
  if (outcome === 'win') {
    stats.wins += 1;
    stats.currentStreak += 1;
    if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
  } else if (outcome === 'loss') {
    stats.losses += 1;
    stats.currentStreak = 0;
  } else {
    stats.draws += 1;
    stats.currentStreak = 0;
  }

  if (territoryPct > stats.bestTerritory) stats.bestTerritory = territoryPct;
  stats.totalTerritoryPct += territoryPct;

  // Keep last 10 games
  stats.history = [
    { outcome, territoryPct, players, gridSize, timestamp: Date.now() },
    ...stats.history,
  ].slice(0, 10);

  saveStats(stats);
  return stats;
};

export const getWinRate = () => {
  const { gamesPlayed, wins } = getStats();
  if (gamesPlayed === 0) return '0%';
  return `${Math.round((wins / gamesPlayed) * 100)}%`;
};

export const getAvgTerritory = () => {
  const { gamesPlayed, totalTerritoryPct } = getStats();
  if (gamesPlayed === 0) return '0%';
  return `${Math.round(totalTerritoryPct / gamesPlayed)}%`;
};

export const resetStats = () => {
  saveStats({ ...DEFAULT_STATS });
};
