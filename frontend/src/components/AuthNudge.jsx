// src/components/AuthNudge.jsx
import React, { useState } from 'react';
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

const AuthNudge = ({ message }) => {
  const { user, loading, login } = useAuth();
  const [dismissed, setDismissed] = useState(() => isDismissed());

  if (loading || user || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div style={styles.banner} data-testid="auth-nudge" role="banner">
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
    backgroundColor: 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))',
    border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border-color))',
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
