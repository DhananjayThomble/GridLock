// src/components/PostGameStatsCard.jsx
// Extracted post-game stats card with real ELO fetching and draw support

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '')
);

// ─── Player config (mirrors Board.jsx) ──────────────────────────────────────
const PLAYER_CONFIG = {
  player1: { colorVar: '--player1-color', bgVar: '--player1-bg', label: 'P1' },
  player2: { colorVar: '--player2-color', bgVar: '--player2-bg', label: 'P2' },
  player3: { colorVar: '--player3-color', bgVar: '--player3-bg', label: 'P3' },
  player4: { colorVar: '--player4-color', bgVar: '--player4-bg', label: 'P4' },
};

const getConfig = (playerId) => PLAYER_CONFIG[playerId] || PLAYER_CONFIG.player1;

// ─── Utility functions ──────────────────────────────────────────────────────
export const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

/**
 * Count total placed lines in a game state.
 * Extracted as module-level utility to avoid recreation on every render.
 */
export const countLines = (state) => {
  let total = 0;
  if (state?.horizontalLines) state.horizontalLines.forEach(row => row.forEach(v => { if (v) total++; }));
  if (state?.verticalLines) state.verticalLines.forEach(row => row.forEach(v => { if (v) total++; }));
  return total;
};

/**
 * Calculate ELO change with proper draw support.
 * @param {number} playerElo
 * @param {number} opponentElo
 * @param {'win'|'draw'|'loss'} outcome
 * @returns {number} ELO delta (rounded)
 */
export const calcEloChange = (playerElo, opponentElo, outcome) => {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const actual = outcome === 'win' ? 1.0 : outcome === 'draw' ? 0.5 : 0.0;
  return Math.round(K * (actual - expected));
};

/**
 * Fetch a player's ELO from the profile API.
 * Returns null on failure (caller should show N/A).
 */
const fetchElo = async (username) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `${API_BASE}/api/profile/${encodeURIComponent(username)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.profile?.elo ?? null;
  } catch {
    return null;
  }
};

// ─── Component ──────────────────────────────────────────────────────────────
const PostGameStatsCard = ({
  gameState,
  scores,
  playerIds,
  gridSize,
  moveCount,
  gameDuration,
  role,
  winnerData,
}) => {
  const totalBoxes = (gridSize || 3) * (gridSize || 3);
  const playerCount = playerIds.length;
  const is1v1 = playerCount === 2;

  // Determine if both players are human (for ELO display in 1v1)
  const bothHuman = is1v1 &&
    !gameState?.[`${playerIds[0]}IsCPU`] &&
    !gameState?.[`${playerIds[1]}IsCPU`];

  // ELO state
  const [eloData, setEloData] = useState(null);
  const [eloLoading, setEloLoading] = useState(false);

  // Fetch real ELO for human players in 1v1 games
  useEffect(() => {
    if (!bothHuman || !gameState) return;

    let cancelled = false;
    setEloLoading(true);

    const loadElos = async () => {
      const results = {};
      await Promise.all(
        playerIds.map(async (pid) => {
          const name = gameState[`${pid}Name`];
          if (name && !gameState[`${pid}IsCPU`]) {
            results[pid] = await fetchElo(name);
          }
        })
      );
      if (!cancelled) {
        setEloData(results);
        setEloLoading(false);
      }
    };

    loadElos();
    return () => { cancelled = true; };
  }, [bothHuman, gameState, playerIds]);

  const renderEloSection = () => {
    if (!is1v1) {
      return (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⚡ ELO</span>
          <span className="text-xs italic" style={{ color: 'var(--text-muted)' }} data-testid="elo-1v1-note">
            1v1 games only
          </span>
        </div>
      );
    }

    if (!bothHuman) return null;

    if (!role || role === 'spectator') {
      return (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⚡ ELO Δ</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }} data-testid="elo-change">—</span>
        </div>
      );
    }

    if (eloLoading) {
      return (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⚡ ELO Δ</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }} data-testid="elo-change">loading…</span>
        </div>
      );
    }

    const myElo = eloData?.[role];
    const opponentId = playerIds.find(pid => pid !== role);
    const oppElo = eloData?.[opponentId];

    if (myElo == null || oppElo == null) {
      return (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⚡ ELO Δ</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }} data-testid="elo-change">N/A</span>
        </div>
      );
    }

    const outcome = winnerData?.isDraw ? 'draw' : winnerData?.winner === role ? 'win' : 'loss';
    const delta = calcEloChange(myElo, oppElo, outcome);

    return (
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⚡ ELO Δ</span>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }} data-testid="elo-change">
          {delta >= 0 ? `+${delta}` : `${delta}`}
        </span>
      </div>
    );
  };

  return (
    <div
      className="stats-card-fade-in rounded-xl p-3 mb-4 w-full"
      data-testid="post-game-stats"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
      }}
    >
      <h3
        className="text-xs font-bold uppercase tracking-wider mb-2 text-center"
        style={{ color: 'var(--text-muted)' }}
      >
        📊 Game Stats
      </h3>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {playerIds.map((pid) => {
          const name = gameState?.[`${pid}Name`] || `P${pid.slice(6)}`;
          const score = scores?.[pid] ?? 0;
          const pct = totalBoxes > 0 ? Math.round((score / totalBoxes) * 100) : 0;
          const cfg = getConfig(pid);
          return (
            <div key={`terr-${pid}`} className="flex items-center justify-between">
              <span className="text-xs font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{name}</span>
              <span className="text-xs font-bold" style={{ color: `var(${cfg.colorVar})` }} data-testid={`territory-pct-${pid}`}>{pct}%</span>
            </div>
          );
        })}

        <div className="col-span-2 border-t my-1" style={{ borderColor: 'var(--border-color)' }} />

        {playerIds.map((pid) => {
          const name = gameState?.[`${pid}Name`] || `P${pid.slice(6)}`;
          const moves = moveCount?.[pid] ?? 0;
          return (
            <div key={`moves-${pid}`} className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{name} moves</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }} data-testid={`move-count-${pid}`}>{moves}</span>
            </div>
          );
        })}

        <div className="col-span-2 border-t my-1" style={{ borderColor: 'var(--border-color)' }} />

        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⏱ Duration</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }} data-testid="game-duration">{formatDuration(gameDuration)}</span>
        </div>

        {renderEloSection()}
      </div>

      <div className="flex justify-center gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        {playerIds.map((pid) => {
          const name = gameState?.[`${pid}Name`] || `P${pid.slice(6)}`;
          const isCPU = !!gameState?.[`${pid}IsCPU`];
          if (isCPU) return null;
          return (
            <Link key={`profile-${pid}`} to={`/profile/${encodeURIComponent(name)}`} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }} data-testid={`profile-link-${pid}`}>
              👤 {name}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default PostGameStatsCard;
