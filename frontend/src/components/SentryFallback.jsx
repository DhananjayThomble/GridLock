/**
 * Top-level Sentry error fallback — shown when the entire app crashes.
 * Styled to match the app's design language.
 */
const SentryFallback = () => (
  <div style={{
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--bg-primary, #0f0f23)',
    color: 'var(--text-primary, #fff)',
    fontFamily: 'system-ui, sans-serif',
    padding: '1.5rem',
  }}>
    <div style={{
      maxWidth: '400px',
      width: '100%',
      textAlign: 'center',
      padding: '2rem',
      borderRadius: '1rem',
      backgroundColor: 'var(--bg-secondary, #1a1a2e)',
      border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>⚠️</div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Something went wrong</h2>
      <p style={{
        fontSize: '0.875rem',
        color: 'var(--text-secondary, #999)',
        marginBottom: '1.5rem',
      }}>
        The app hit an unexpected issue. Please reload to try again.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          width: '100%',
          padding: '0.75rem',
          borderRadius: '0.75rem',
          border: 'none',
          fontWeight: 700,
          fontSize: '0.875rem',
          color: '#fff',
          backgroundColor: 'var(--accent, #3B82F6)',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  </div>
);

export default SentryFallback;
