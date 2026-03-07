// src/components/QuickPlay.jsx
// Matchmaking waiting screen — shows queue status, timer, and CPU fallback

import React, { useState, useEffect, useRef } from 'react';

const QuickPlay = ({ gridSize, playerCount, queueSize: initialQueueSize, onCancel, onPlayCPU }) => {
  const [elapsed, setElapsed] = useState(0);
  const [queueSize, setQueueSize] = useState(initialQueueSize || 1);
  const [showCpuOption, setShowCpuOption] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef(null);

  // Update queue size when prop changes
  useEffect(() => {
    if (initialQueueSize != null) setQueueSize(initialQueueSize);
  }, [initialQueueSize]);

  // Count up timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= 15 && !showCpuOption) setShowCpuOption(true);
        if (next >= 30 && !timedOut) setTimedOut(true);
        return next;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [showCpuOption, timedOut]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color-strong)' }}
      >
        <div className="p-6 text-center space-y-5">

          {/* Animated search indicator */}
          <div className="flex justify-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center animate-pulse"
              style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}
            >
              <span className="text-3xl" role="img" aria-label="searching">🔍</span>
            </div>
          </div>

          {/* Status text */}
          <div>
            <h2
              className="text-lg font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {timedOut ? 'No opponents found' : 'Searching for opponents…'}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Grid: {gridSize}×{gridSize} · Players: {playerCount}
            </p>
          </div>

          {/* Timer and queue info */}
          <div className="flex justify-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                ⏱ {elapsed}s
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                👥 {queueSize}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>In queue</div>
            </div>
          </div>

          {/* CPU fallback option */}
          {showCpuOption && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex-1" style={{ borderTop: '1px solid var(--border-color)' }} />
                <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>or</span>
                <div className="flex-1" style={{ borderTop: '1px solid var(--border-color)' }} />
              </div>
              <button
                onClick={onPlayCPU}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 min-h-[44px]"
                style={{
                  background: timedOut
                    ? 'linear-gradient(135deg, var(--accent), var(--accent-hover))'
                    : 'var(--bg-surface)',
                  border: '1px solid var(--border-color-strong)',
                  color: timedOut ? 'var(--text-on-accent)' : 'var(--text-primary)',
                }}
              >
                🤖 {timedOut ? 'Play vs CPU instead' : 'Play vs CPU instead?'}
              </button>
            </div>
          )}

          {/* Cancel button */}
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 min-h-[44px]"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color-strong)',
              color: 'var(--text-secondary)',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickPlay;
