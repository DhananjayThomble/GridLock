// src/themes/gridThemes.js
// Grid visual theme definitions — affects VISUALS only, not layout/sizing math.
// Each theme defines dot appearance, line style, board background, and player colors.
// Note: dotSize and lineGlowIntensity were removed — unused by rendering code.
// visualDotSize is the only dot sizing property consumed by components.

export const GRID_THEMES = {
  clean: {
    id: 'clean',
    name: 'Clean',
    description: 'Modern and minimal with bold rounded lines',
    visualDotSize: 5,
    lineThickness: 6,
    dotColor: '#52525b',
    emptyLineColor: '#27272a',
    boardBg: null, // use default theme bg
    boardBorder: null,
    dotStyle: { borderRadius: '50%' },
    lineStyle: { borderRadius: '3px' },
    players: {
      p1: { lineColor: '#6366f1', lineGlow: 'none', boxBg: 'rgba(99,102,241,0.12)' },
      p2: { lineColor: '#f59e0b', lineGlow: 'none', boxBg: 'rgba(245,158,11,0.12)' },
      p3: { lineColor: '#10b981', lineGlow: 'none', boxBg: 'rgba(16,185,129,0.12)' },
      p4: { lineColor: '#a78bfa', lineGlow: 'none', boxBg: 'rgba(167,139,250,0.12)' },
    },
  },

  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'The original GridLock look — large dots, bold lines',
    visualDotSize: 22,
    lineThickness: 8,
    dotColor: '#8ba4c4',
    emptyLineColor: '#3d444d',
    boardBg: null,
    boardBorder: null,
    dotStyle: { borderRadius: '50%' },
    lineStyle: { borderRadius: '4px' },
    players: {
      p1: { lineColor: '#58a6ff', lineGlow: 'none', boxBg: 'rgba(88,166,255,0.12)' },
      p2: { lineColor: '#f0883e', lineGlow: 'none', boxBg: 'rgba(240,136,62,0.12)' },
      p3: { lineColor: '#3fb950', lineGlow: 'none', boxBg: 'rgba(63,185,80,0.12)' },
      p4: { lineColor: '#bc8cff', lineGlow: 'none', boxBg: 'rgba(188,140,255,0.12)' },
    },
  },

  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Tiny dots, thin lines — distraction-free',
    visualDotSize: 8,
    lineThickness: 4,
    dotColor: '#4b5563',
    emptyLineColor: '#1f2937',
    boardBg: null,
    boardBorder: null,
    dotStyle: { borderRadius: '50%' },
    lineStyle: { borderRadius: '2px' },
    players: {
      p1: { lineColor: '#6366f1', lineGlow: 'none', boxBg: 'rgba(99,102,241,0.08)' },
      p2: { lineColor: '#f59e0b', lineGlow: 'none', boxBg: 'rgba(245,158,11,0.08)' },
      p3: { lineColor: '#10b981', lineGlow: 'none', boxBg: 'rgba(16,185,129,0.08)' },
      p4: { lineColor: '#8b5cf6', lineGlow: 'none', boxBg: 'rgba(139,92,246,0.08)' },
    },
  },

  neon: {
    id: 'neon',
    name: 'Neon Glow',
    description: 'Glowing dots and electric lines',
    visualDotSize: 10,
    lineThickness: 3,
    dotColor: '#a78bfa',
    emptyLineColor: '#1e1b4b',
    boardBg: '#0f0a1a',
    boardBorder: '1px solid rgba(167,139,250,0.2)',
    dotStyle: { borderRadius: '50%', boxShadow: '0 0 6px #a78bfa, 0 0 12px rgba(167,139,250,0.4)' },
    lineStyle: { borderRadius: '2px' },
    players: {
      p1: { lineColor: '#22d3ee', lineGlow: '0 0 8px #22d3ee, 0 0 16px rgba(34,211,238,0.3)', boxBg: 'rgba(34,211,238,0.1)' },
      p2: { lineColor: '#f472b6', lineGlow: '0 0 8px #f472b6, 0 0 16px rgba(244,114,182,0.3)', boxBg: 'rgba(244,114,182,0.1)' },
      p3: { lineColor: '#4ade80', lineGlow: '0 0 8px #4ade80, 0 0 16px rgba(74,222,128,0.3)', boxBg: 'rgba(74,222,128,0.1)' },
      p4: { lineColor: '#c084fc', lineGlow: '0 0 8px #c084fc, 0 0 16px rgba(192,132,252,0.3)', boxBg: 'rgba(192,132,252,0.1)' },
    },
  },

  glass: {
    id: 'glass',
    name: 'Glassmorphism',
    description: 'Frosted glass with gradient lines',
    visualDotSize: 12,
    lineThickness: 5,
    dotColor: '#818cf8',
    emptyLineColor: 'rgba(99,102,241,0.15)',
    boardBg: 'rgba(30,27,75,0.6)',
    boardBorder: '1px solid rgba(129,140,248,0.2)',
    dotStyle: { borderRadius: '50%', boxShadow: '0 0 4px rgba(129,140,248,0.3)' },
    lineStyle: { borderRadius: '3px' },
    players: {
      p1: { lineColor: '#818cf8', lineGlow: '0 0 6px rgba(129,140,248,0.3)', boxBg: 'rgba(129,140,248,0.1)' },
      p2: { lineColor: '#fb923c', lineGlow: '0 0 6px rgba(251,146,60,0.3)', boxBg: 'rgba(251,146,60,0.1)' },
      p3: { lineColor: '#34d399', lineGlow: '0 0 6px rgba(52,211,153,0.3)', boxBg: 'rgba(52,211,153,0.1)' },
      p4: { lineColor: '#f0abfc', lineGlow: '0 0 6px rgba(240,171,252,0.3)', boxBg: 'rgba(240,171,252,0.1)' },
    },
  },
};

/** Map player role (player1..player4) to theme player key (p1..p4) */
export const playerKeyFromRole = (role) => {
  if (!role) return 'p1';
  const num = role.replace('player', '');
  return `p${num}`;
};

/** Default lineStyle fallback for themes missing borderRadius */
const LINE_STYLE_DEFAULTS = { borderRadius: '2px' };

/** Get theme by id, fallback to clean. Ensures lineStyle always has borderRadius. */
export const getGridTheme = (id) => {
  const theme = GRID_THEMES[id] || GRID_THEMES.clean;
  if (theme.lineStyle && theme.lineStyle.borderRadius) return theme;
  return { ...theme, lineStyle: { ...LINE_STYLE_DEFAULTS, ...theme.lineStyle } };
};

/** All theme ids */
export const THEME_IDS = Object.keys(GRID_THEMES);

/** Unlock conditions */
export const UNLOCK_CONDITIONS = {
  clean: { unlocked: true, label: 'Free' },
  classic: { unlocked: true, label: 'Free' },
  minimal: { winsRequired: 10, label: 'Win 10 games' },
  neon: { winsRequired: 25, label: 'Win 25 games' },
  glass: { tournamentWin: true, label: 'Win a tournament' },
};

/** Check if a theme should be unlocked based on stats */
export const checkUnlockCondition = (themeId, stats) => {
  const condition = UNLOCK_CONDITIONS[themeId];
  if (!condition) return false;
  if (condition.unlocked) return true;
  if (condition.winsRequired && stats.wins >= condition.winsRequired) return true;
  if (condition.tournamentWin && stats.tournamentWins > 0) return true;
  return false;
};
