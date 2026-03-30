// src/components/AuthSetup.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL ||
  ''
).replace(/\/$/, '');

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

const AuthSetup = () => {
  const { user, loading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill with displayName suggestion
  useEffect(() => {
    if (user?.displayName && !username) {
      // Sanitize displayName to valid username chars
      const sanitized = user.displayName
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 16);
      if (sanitized.length >= 2) {
        setUsername(sanitized);
      }
    }
  }, [user?.displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect if already set up or not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate('/', { replace: true });
    }
    if (!loading && user?.usernameSetupComplete) {
      navigate('/', { replace: true });
    }
  }, [user, loading, navigate]);

  const validate = (val) => {
    if (val.length < 2) return 'Username must be at least 2 characters';
    if (val.length > 16) return 'Username must be at most 16 characters';
    if (!USERNAME_REGEX.test(val)) return 'Only letters, numbers, underscores, and hyphens allowed';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = username.trim();
    const validationError = validate(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await axios.post(`${API_BASE}/api/auth/setup-username`, { username: trimmed });
      await refreshUser();
      const returnTo = searchParams.get('returnTo') || '/';
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err.response?.status === 409) {
        setError('Username already taken');
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Choose Your Username</h1>
        <p style={styles.subtitle}>This will be your permanent username</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputWrapper}>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              placeholder="Enter username"
              maxLength={16}
              autoFocus
              style={styles.input}
              data-testid="username-input"
              aria-label="Username"
              aria-describedby={error ? 'username-error' : undefined}
            />
            <span style={styles.charCount}>{username.length}/16</span>
          </div>

          {error && (
            <p id="username-error" style={styles.error} data-testid="setup-error" role="alert">
              {error}
            </p>
          )}

          <p style={styles.hint}>
            2-16 characters. Letters, numbers, underscores, hyphens only.
          </p>

          <button
            type="submit"
            disabled={submitting || !username.trim()}
            style={{
              ...styles.button,
              opacity: submitting || !username.trim() ? 0.5 : 1,
              cursor: submitting || !username.trim() ? 'not-allowed' : 'pointer',
            }}
            data-testid="setup-submit"
          >
            {submitting ? 'Setting up…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))',
  },
  card: {
    maxWidth: '400px',
    width: '100%',
    padding: '32px 24px',
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    textAlign: 'center',
  },
  title: {
    fontSize: '22px',
    fontWeight: 800,
    color: 'var(--text-primary)',
    margin: '0 0 8px',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    margin: '0 0 24px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  inputWrapper: {
    position: 'relative',
  },
  input: {
    width: '100%',
    padding: '12px 60px 12px 16px',
    fontSize: '16px',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 150ms',
  },
  charCount: {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  error: {
    fontSize: '13px',
    color: 'var(--danger)',
    margin: 0,
    textAlign: 'left',
  },
  hint: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    margin: 0,
    textAlign: 'left',
  },
  button: {
    width: '100%',
    padding: '12px',
    fontSize: '15px',
    fontWeight: 600,
    borderRadius: '10px',
    border: 'none',
    backgroundColor: 'var(--accent)',
    color: 'var(--text-on-accent)',
    transition: 'opacity 150ms',
    minHeight: '44px',
  },
};

export default AuthSetup;
