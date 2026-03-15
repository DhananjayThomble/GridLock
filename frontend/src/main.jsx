import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { HelmetProvider } from 'react-helmet-async'
import { initPostHog } from './lib/posthog'
import './index.css'
import App from './App.jsx'

// ── Sentry error tracking (optional — requires VITE_SENTRY_DSN) ──────────────
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || undefined,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});

// ── PostHog analytics (optional — requires VITE_POSTHOG_KEY) ─────────────────
initPostHog();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <Sentry.ErrorBoundary fallback={<p>An error occurred.</p>}>
        <App />
      </Sentry.ErrorBoundary>
    </HelmetProvider>
  </StrictMode>,
)

// Register service worker (production only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swPath = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swPath).catch((error) => { console.error('Service worker registration failed:', error); });
  });
}
