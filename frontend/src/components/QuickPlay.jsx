// src/components/QuickPlay.jsx
// Matchmaking waiting screen — shows queue status, timer, and CPU fallback

import React, { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../socket';

const QuickPlay = ({ gridSize, playerCount, queueSize: initialQueueSize, onCancel, onPlayCPU }) => {
  const [elapsed, setElapsed] = useState(0);
  const [queueSize, setQueueSize] = useState(initialQueueSize || 1);
  const [showCpuOption, setShowCpuOption] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef(null);
  const overlayRef = useRef(null);
  const showCpuRef = useRef(false);
  const timedOutRef = useRef(false);

  // Update queue size when prop changes
  useEffect(() => {
    if (initialQueueSize != null) setQueueSize(initialQueueSize);
  }, [initialQueueSize]);

  // Listen for queue_status and queue_timeout socket events
  useEffect(() => {
    const onStatus = ({ queueSize: qs }) => {
      if (qs != null) setQueueSize(qs);
    };
    const onTimeout = () => {
      timedOutRef.current = true;
      setTimedOut(true);
    };

    socket.on('queue_status', onStatus);
    socket.on('queue_timeout', onTimeout);
    return () => {
      socket.off('queue_status', onStatus);
      socket.off('queue_timeout', onTimeout);
    };
  }, []);

  // Count up timer — refs for threshold checks to avoid interval churn
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= 15 && !showCpuRef.current) {
          showCpuRef.current = true;
          setShowCpuOption(true);
        }
        if (next >= 30 && !timedOutRef.current) {
          timedOutRef.current = true;
          setTimedOut(true);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, []); // stable — no deps that change

  // Focus trap: keep focus within the overlay
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const focusable = overlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  // Auto-focus overlay on mount
  useEffect(() => {
    const overlay = overlayRef.current;
    if (overlay) {
      const firstBtn = overlay.querySelector('button');
      if (firstBtn) firstBtn.focus();
    }
  }, []);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Quick Play matchmaking"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(8px)' }}
      onKeyDown={handleKeyDown}
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
          <div aria-live="polite">
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
                aria-label={timedOut ? 'Play versus CPU instead' : 'Play versus CPU instead?'}
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
            aria-label="Cancel matchmaking"
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
