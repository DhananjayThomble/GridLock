// src/components/AuthNudge.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const DISMISS_KEY = 'gridlock_auth_nudge_dismissed';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isDismissed() {
  const stored = localStorage.getItem(DISMISS_KEY);
  if (!stored) return false;
  const timestamp = parseInt(stored, 10);
  if (isNaN(timestamp)) return false;
  return Date.now() - timestamp < SEVEN_DAYS_MS;
}

// Check if browser supports color-mix()
const supportsColorMix = typeof CSS !== 'undefined' && CSS.supports?.('background-color', 'color-mix(in srgb, red 50%, blue)');

const AuthNudge = ({ message }) => {
  const { user, loading, login } = useAuth();
  const [dismissed, setDismissed] = useState(() => isDismissed());
  const bannerRef = useRef(null);

  // Apply color-mix styles progressively when supported
  useEffect(() => {
    if (supportsColorMix && bannerRef.current) {
      bannerRef.current.style.backgroundColor = 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))';
      bannerRef.current.style.borderColor = 'color-mix(in srgb, var(--accent) 25%, var(--border-color))';
    }
  }, [dismissed, loading, user]);

  if (loading || user || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div ref={bannerRef} style={styles.banner} data-testid="auth-nudge" role="banner">
      <span style={styles.text}>
        {message}
        {' '}
        <button onClick={login} style={styles.link} data-testid="nudge-sign-in">
          Sign in
        </button>
      </span>
      <button
        onClick={handleDismiss}
        style={styles.dismiss}
        aria-label="Dismiss"
        data-testid="nudge-dismiss"
      >
        ✕
      </button>
    </div>
  );
};

const styles = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px 16px',
    margin: '0 0 12px',
    borderRadius: '10px',
    // Fallback for browsers without color-mix() (pre Chrome 111, Firefox 113, Safari 16.2)
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
  },
  text: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: '18px',
  },
  link: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--accent)',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  dismiss: {
    background: 'none',
    border: 'none',
    padding: '4px',
    fontSize: '14px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    flexShrink: 0,
    lineHeight: 1,
  },
};

export default AuthNudge;
