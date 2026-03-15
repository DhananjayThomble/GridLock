// src/components/HeroBanner.jsx
// Collapsible hero/welcome banner for first-time visitors.
// Persists dismissal to localStorage so returning users skip it.

import React, { useState, useEffect, useRef, useCallback } from 'react';

const STORAGE_KEY = 'gridlock_hero_dismissed';

const FEATURES = [
  { icon: '🎮', label: 'Free to Play' },
  { icon: '👥', label: '2–4 Players' },
  { icon: '🏆', label: 'Tournaments' },
  { icon: '📱', label: 'Mobile Ready' },
  { icon: '🤖', label: 'CPU Opponents' },
  { icon: '🔄', label: 'Instant Rematch' },
  { icon: '👁️', label: 'Spectator Mode' },
  { icon: '📊', label: 'Leaderboards' },
];

/** Safely read localStorage (handles private browsing / SSR). */
const isHeroDismissed = () => {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
};

/** Safely write localStorage. */
const persistDismissal = () => {
  try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* quota / private */ }
};

const HeroBanner = ({ onPlayNow }) => {
  const [dismissed, setDismissed] = useState(isHeroDismissed);
  const [collapsing, setCollapsing] = useState(false);
  const contentRef = useRef(null);
  const [contentHeight, setContentHeight] = useState('auto');

  // Measure real height for smooth collapse animation
  useEffect(() => {
    if (!dismissed && contentRef.current) {
      setContentHeight(`${contentRef.current.scrollHeight}px`);
    }
  }, [dismissed]);

  const handleDismiss = useCallback(() => {
    if (contentRef.current) {
      setContentHeight(`${contentRef.current.scrollHeight}px`);
      // Force reflow so browser registers the explicit height before collapsing
      // eslint-disable-next-line no-unused-expressions
      contentRef.current.offsetHeight;
    }
    setCollapsing(true);
    // After a brief frame, set height to 0 to trigger CSS transition
    requestAnimationFrame(() => {
      setContentHeight('0px');
    });
  }, []);

  const handleTransitionEnd = useCallback(() => {
    if (collapsing) {
      persistDismissal();
      setDismissed(true);
      setCollapsing(false);
    }
  }, [collapsing]);

  if (dismissed) return null;

  return (
    <div
      ref={contentRef}
      className="overflow-hidden transition-all duration-500 ease-in-out"
      style={{
        maxHeight: contentHeight,
        opacity: collapsing ? 0 : 1,
        transition: 'max-height 0.5s ease-in-out, opacity 0.4s ease-in-out',
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div
        className="relative rounded-2xl mb-6 overflow-hidden"
        style={{
          background: 'var(--bg-card-hover)',
          border: '1px solid var(--border-color-strong)',
          boxShadow: '0 8px 32px var(--shadow-color)',
        }}
      >
        {/* Decorative gradient overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, transparent), color-mix(in srgb, var(--player4-color) 8%, transparent), transparent)',
          }}
        />

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss welcome banner"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-90"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
          }}
        >
          ✕
        </button>

        <div className="relative z-[1] px-5 py-6 sm:px-8 sm:py-8">
          {/* Heading */}
          <div className="text-center mb-1">
            <h2
              className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent leading-tight"
            >
              GridLock
            </h2>
            <p
              className="text-sm sm:text-base font-semibold mt-1 tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Multiplayer Dots &amp; Boxes
            </p>
          </div>

          {/* Tagline */}
          <p
            className="text-center text-xs sm:text-sm mt-2 mb-5 max-w-md mx-auto leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            The classic pen-and-paper game, reimagined for competitive online play
          </p>

          {/* Feature badges — 2×4 on desktop, 2 cols on mobile */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5 mb-5">
            {FEATURES.map(({ icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <span className="text-lg flex-shrink-0">{icon}</span>
                <span
                  className="text-xs sm:text-sm font-medium whitespace-nowrap"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* CTA + Dismiss row */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <button
              onClick={() => {
                if (onPlayNow) onPlayNow();
                handleDismiss();
              }}
              className="px-8 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 shadow-lg"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--player4-color))',
                color: 'var(--text-on-accent)',
                boxShadow: '0 4px 16px color-mix(in srgb, var(--accent) 40%, transparent)',
              }}
            >
              🎮 Play Now
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 rounded-xl text-xs font-medium transition-all active:scale-95"
              style={{ color: 'var(--text-muted)' }}
            >
              Got it, don&apos;t show again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroBanner;
