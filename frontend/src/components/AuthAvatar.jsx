// src/components/AuthAvatar.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const AuthAvatar = () => {
  const { user, loading, login, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  if (loading) return null;

  // Guest: show sign-in icon
  if (!user) {
    return (
      <div style={styles.container}>
        <button
          onClick={login}
          style={styles.guestButton}
          aria-label="Sign in with Google"
          data-testid="auth-avatar-guest"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>
      </div>
    );
  }

  // Authenticated: show avatar with dropdown
  return (
    <div style={styles.container} ref={ref}>
      <button
        onClick={() => setOpen(prev => !prev)}
        style={styles.avatarButton}
        aria-label="Account menu"
        aria-expanded={open}
        data-testid="auth-avatar-user"
      >
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.username}
            style={styles.avatarImg}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div style={styles.avatarFallback}>
            {user.username?.[0]?.toUpperCase() || '?'}
          </div>
        )}
      </button>

      {open && (
        <div style={styles.dropdown} data-testid="auth-dropdown" role="menu">
          <button
            onClick={() => {
              setOpen(false);
              navigate(`/profile/${encodeURIComponent(user.username)}`);
            }}
            style={styles.dropdownItem}
            role="menuitem"
          >
            👤 View Profile
          </button>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            style={styles.dropdownItem}
            role="menuitem"
          >
            🚪 Sign Out
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: 1000,
  },
  guestButton: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    transition: 'opacity 150ms',
  },
  avatarButton: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '2px solid var(--border-color)',
    backgroundColor: 'var(--bg-card)',
    cursor: 'pointer',
    padding: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    objectFit: 'cover',
  },
  avatarFallback: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent)',
    color: 'var(--text-on-accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
  },
  dropdown: {
    position: 'absolute',
    top: '44px',
    right: 0,
    minWidth: '160px',
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    overflow: 'hidden',
    zIndex: 1001,
  },
  dropdownItem: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'block',
    transition: 'background-color 150ms',
  },
};

export default AuthAvatar;
