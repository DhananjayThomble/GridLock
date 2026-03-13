// src/components/QuickPlay.jsx
// Matchmaking waiting screen — shows queue status, timer, player count selector, and CPU fallback

import React, { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../socket';

// Timeout thresholds (seconds) — Must match backend QUEUE_TIMEOUT_MS in services/matchmaking.js
const QUEUE_TIMEOUT_SEC = 30;
const CPU_SUGGEST_SEC   = 15;
const CPU_AUTO_SEC      = QUEUE_TIMEOUT_SEC;

const PLAYER_OPTIONS = [2, 3, 4];

const QuickPlay = ({ gridSize, playerCount: initialPlayerCount, queueSize: initialQueueSize, username, avatar, onCancel, onPlayCPU }) => {
  const [selectedPlayerCount, setSelectedPlayerCount] = useState(() => {
    // Persist last Quick Play selection across modal open/close (#213)
    const saved = parseInt(localStorage.getItem('gridlock-quickplay-playerCount'), 10);
    return saved >= 2 && saved <= 4 ? saved : (initialPlayerCount || 2);
  });
  const [elapsed, setElapsed] = useState(0);
  const [queueSize, setQueueSize] = useState(initialQueueSize || 1);
  const [queueCounts, setQueueCounts] = useState({}); // per-queueKey counts, e.g. { "2P:3x3": 3, "3P:3x3": 1 }
  const [showCpuOption, setShowCpuOption] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef(null);
  const overlayRef = useRef(null);
  const showCpuRef = useRef(false);
  const timedOutRef = useRef(false);
  const selectedPlayerCountRef = useRef(selectedPlayerCount);
  const radioGroupRef = useRef(null);

  // Keep ref in sync
  useEffect(() => { selectedPlayerCountRef.current = selectedPlayerCount; }, [selectedPlayerCount]);

  // Listen for queue_status and queue_timeout socket events
  useEffect(() => {
    const onStatus = ({ queueSize: qs, queueCounts: qc }) => {
      if (qs != null) setQueueSize(qs);
      if (qc != null) setQueueCounts(qc);
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
        if (next >= CPU_SUGGEST_SEC && !showCpuRef.current) {
          showCpuRef.current = true;
          setShowCpuOption(true);
        }
        if (next >= CPU_AUTO_SEC && !timedOutRef.current) {
          timedOutRef.current = true;
          setTimedOut(true);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, []); // stable — no deps that change

  // Handle player count change — re-queue with new preference
  const handlePlayerCountChange = useCallback((newCount) => {
    if (newCount === selectedPlayerCountRef.current) return;
    setSelectedPlayerCount(newCount);

    // Persist selection so it survives modal close/reopen (#213)
    try { localStorage.setItem('gridlock-quickplay-playerCount', String(newCount)); } catch { /* ignore */ }

    // Re-queue: leave current queue, rejoin with new player count
    socket.emit('queue_leave');
    socket.emit('queue_join', { username, avatar, playerCount: newCount, gridSize });

    // Reset timer and CPU suggestion state on re-queue
    setElapsed(0);
    setShowCpuOption(false);
    showCpuRef.current = false;
    setTimedOut(false);
    timedOutRef.current = false;
    setQueueSize(1);
  }, [gridSize, username, avatar]);

  // Roving tabindex arrow key navigation for radiogroup
  const handleRadioKeyDown = useCallback((e) => {
    const keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();

    const currentIdx = PLAYER_OPTIONS.indexOf(selectedPlayerCountRef.current);
    let nextIdx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIdx = (currentIdx + 1) % PLAYER_OPTIONS.length;
    } else {
      nextIdx = (currentIdx - 1 + PLAYER_OPTIONS.length) % PLAYER_OPTIONS.length;
    }

    const newCount = PLAYER_OPTIONS[nextIdx];
    handlePlayerCountChange(newCount);

    // Focus the newly selected radio button
    const group = radioGroupRef.current;
    if (group) {
      const buttons = group.querySelectorAll('[role="radio"]');
      if (buttons[nextIdx]) buttons[nextIdx].focus();
    }
  }, [handlePlayerCountChange]);

  // Wrap onPlayCPU to pass selected player count
  const handlePlayCPU = useCallback(() => {
    if (onPlayCPU) onPlayCPU(selectedPlayerCountRef.current);
  }, [onPlayCPU]);

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

  // Build per-selection queue count display for the current grid size
  const queueCountDisplay = PLAYER_OPTIONS
    .map((count) => {
      const key = `${count}P:${gridSize}x${gridSize}`;
      const n = queueCounts[key] || 0;
      return n > 0 ? `${n} searching for ${count}P` : null;
    })
    .filter(Boolean)
    .join(' | ');

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
              {timedOut ? 'No opponents found' : `Searching for ${selectedPlayerCount}-player match…`}
            </h2>
          </div>

          {/* Grid size display */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
          >
            <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Grid</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{gridSize}×{gridSize}</span>
          </div>

          {/* Player count selector */}
          <div>
            <label
              className="block text-xs font-bold uppercase mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              Players
            </label>
            <div
              ref={radioGroupRef}
              className="inline-flex rounded-xl overflow-hidden"
              role="radiogroup"
              aria-label="Player count"
              style={{ border: '1px solid var(--border-color-strong)' }}
              onKeyDown={handleRadioKeyDown}
            >
              {PLAYER_OPTIONS.map((count, idx) => {
                const isSelected = count === selectedPlayerCount;
                return (
                  <button
                    key={count}
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`${count} players`}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => handlePlayerCountChange(count)}
                    className="px-5 py-2 text-sm font-bold transition-all min-h-[44px]"
                    style={{
                      background: isSelected
                        ? 'var(--accent)'
                        : 'var(--bg-surface)',
                      color: isSelected
                        ? 'var(--text-on-accent)'
                        : 'var(--text-secondary)',
                      borderRight: idx < PLAYER_OPTIONS.length - 1 ? '1px solid var(--border-color-strong)' : 'none',
                    }}
                  >
                    {count}P
                  </button>
                );
              })}
            </div>
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
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {queueCountDisplay || 'In queue'}
              </div>
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
                onClick={handlePlayCPU}
                aria-label={timedOut ? `Play versus ${selectedPlayerCount - 1} CPU instead` : `Play versus ${selectedPlayerCount - 1} CPU instead?`}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 min-h-[44px]"
                style={{
                  background: timedOut
                    ? 'linear-gradient(135deg, var(--accent), var(--accent-hover))'
                    : 'var(--bg-surface)',
                  border: '1px solid var(--border-color-strong)',
                  color: timedOut ? 'var(--text-on-accent)' : 'var(--text-primary)',
                }}
              >
                🤖 {timedOut
                  ? `Play vs ${selectedPlayerCount - 1} CPU instead`
                  : `Play vs ${selectedPlayerCount - 1} CPU instead?`}
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
