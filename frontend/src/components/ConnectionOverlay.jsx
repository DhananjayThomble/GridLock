// src/components/ConnectionOverlay.jsx
// Shows reconnecting/disconnected overlay when socket connection drops
import React, { useState, useEffect, useCallback, useRef } from 'react';
import socket from '../socket';

const ConnectionOverlay = () => {
  const [state, setState] = useState('connected'); // 'connected' | 'reconnecting' | 'failed'
  const [attempt, setAttempt] = useState(0);
  const retryBtnRef = useRef(null);
  const headingId = 'connection-overlay-heading';

  useEffect(() => {
    const onDisconnect = (reason) => {
      // io server disconnect = server forcefully disconnected, don't auto-reconnect
      if (reason === 'io server disconnect') {
        setState('failed');
      } else {
        setState('reconnecting');
        setAttempt(0);
      }
    };

    const onReconnectAttempt = (attemptNumber) => {
      setState('reconnecting');
      setAttempt(attemptNumber);
    };

    const onReconnect = () => {
      setState('connected');
      setAttempt(0);
    };

    const onReconnectFailed = () => {
      setState('failed');
    };

    const onConnect = () => {
      setState('connected');
      setAttempt(0);
    };

    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect', onReconnect);
    socket.io.on('reconnect_failed', onReconnectFailed);
    socket.on('connect', onConnect);

    return () => {
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect', onReconnect);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.off('connect', onConnect);
    };
  }, []);

  // Auto-focus retry button when entering failed state
  useEffect(() => {
    if (state === 'failed' && retryBtnRef.current) {
      retryBtnRef.current.focus();
    }
  }, [state]);

  const handleRetry = useCallback(() => {
    setState('reconnecting');
    setAttempt(0);
    socket.connect();
  }, []);

  if (state === 'connected') return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--overlay-bg, rgba(0, 0, 0, 0.7))',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '2rem',
          borderRadius: '1rem',
          backgroundColor: 'var(--bg-surface, #1a1a2e)',
          color: 'var(--text-primary, #fff)',
          maxWidth: '360px',
          width: '90%',
          boxShadow: '0 8px 32px var(--overlay-shadow, rgba(0, 0, 0, 0.4))',
        }}
      >
        {state === 'reconnecting' ? (
          <>
            <div
              className="connection-spinner"
              style={{
                width: '48px',
                height: '48px',
                border: '4px solid var(--border-color, rgba(255,255,255,0.2))',
                borderTop: '4px solid var(--accent, #3B82F6)',
                borderRadius: '50%',
                animation: 'connection-spin 1s linear infinite',
                margin: '0 auto 1rem',
              }}
            />
            <h2 id={headingId} style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              Reconnecting…
            </h2>
            <p aria-live="assertive" style={{ color: 'var(--text-muted, #999)', fontSize: '0.9rem' }}>
              Attempt {attempt || 1} — hang tight
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚡</div>
            <h2 id={headingId} style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              Connection Lost
            </h2>
            <p aria-live="assertive" style={{ color: 'var(--text-muted, #999)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Unable to reach the server. Check your connection and try again.
            </p>
            <button
              ref={retryBtnRef}
              onClick={handleRetry}
              style={{
                padding: '0.75rem 2rem',
                backgroundColor: 'var(--accent, #3B82F6)',
                color: 'var(--text-on-accent, #fff)',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover, #2563EB)')}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent, #3B82F6)')}
            >
              Retry Connection
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ConnectionOverlay;
