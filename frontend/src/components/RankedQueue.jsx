// src/components/RankedQueue.jsx
// Ranked matchmaking queue overlay — shows ELO, tier, queue status, and cooldown
import React, { useState, useEffect } from 'react';
import RankBadge from './RankBadge';

const RankedQueue = ({ elo, tier, tierIcon, queueSize, placementProgress, cooldownUntil, onCancel, profile }) => {
  const [elapsed, setElapsed] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Timer for queue elapsed time
  useEffect(() => {
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Cooldown countdown
  useEffect(() => {
    if (!cooldownUntil) return;
    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((new Date(cooldownUntil) - new Date()) / 1000));
      setCooldownRemaining(remaining);
    };
    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Show cooldown overlay if player is on cooldown
  if (cooldownUntil && cooldownRemaining > 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)', backdropFilter: 'blur(8px)' }}
      >
        <div
          className="rounded-2xl p-6 text-center space-y-4 max-w-sm w-full"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)' }}
        >
          <div className="text-4xl">⏳</div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--danger)' }}>
            Cooldown Active
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            You left a ranked game early. Please wait before re-queuing.
          </p>
          <div className="text-3xl font-mono font-bold" style={{ color: 'var(--danger)' }}>
            {formatTime(cooldownRemaining)}
          </div>
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
            style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-2xl p-6 text-center space-y-4 max-w-sm w-full"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)' }}
      >
        {/* Tier Badge */}
        <div className="flex justify-center">
          <RankBadge tier={tier} tierIcon={tierIcon} elo={elo} size="lg" showElo />
        </div>

        {/* Placement Progress */}
        {placementProgress && (
          <div
            className="rounded-xl px-4 py-2"
            style={{
              background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            }}
          >
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
              Placement: {placementProgress}
            </p>
          </div>
        )}

        {/* Win/Loss/Draw Record (#365, #374 review — always show all three) */}
        {profile && !placementProgress && (
          <div
            className="rounded-xl px-4 py-2 flex items-center justify-center gap-4"
            style={{
              background: 'color-mix(in srgb, var(--bg-secondary) 50%, transparent)',
              border: '1px solid var(--border-color)',
            }}
          >
            <span className="text-xs font-bold" style={{ color: 'var(--success)' }}>
              {profile.wins}W
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>·</span>
            <span className="text-xs font-bold" style={{ color: 'var(--danger)' }}>
              {profile.losses}L
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>·</span>
            <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
              {profile.draws || 0}D
            </span>
          </div>
        )}

        {/* Search Animation */}
        <div>
          <div className="text-4xl mb-2">⚔️</div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Finding Opponent…
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Matching within ±200 ELO
            {elapsed >= 30 && <span> (expanded range)</span>}
          </p>
        </div>

        {/* Timer */}
        <div className="text-2xl font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
          {formatTime(elapsed)}
        </div>

        {/* Queue Size */}
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {queueSize} player{queueSize !== 1 ? 's' : ''} in ranked queue
        </p>

        {/* Cancel Button */}
        <button
          onClick={onCancel}
          className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
          style={{
            background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            color: 'var(--danger)',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default RankedQueue;
