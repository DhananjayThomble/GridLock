// Initialize Sentry before React renders (ES module imports are hoisted, but initSentry() runs first)
import { initSentry, SentryErrorBoundary } from './lib/sentry';
initSentry();

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { initPostHog } from './lib/posthog'
import SentryFallback from './components/SentryFallback'
import './index.css'
import App from './App.jsx'

// ── PostHog analytics (optional — requires VITE_POSTHOG_KEY) ─────────────────
initPostHog();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <SentryErrorBoundary fallback={<SentryFallback />}>
        <App />
      </SentryErrorBoundary>
    </HelmetProvider>
  </StrictMode>,
)

// Register service worker (production only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swPath = `${import.meta.env.BASE_URL}sw.js?v=${import.meta.env.VITE_APP_VERSION || '0'}`;
    navigator.serviceWorker.register(swPath).catch((error) => { console.error('Service worker registration failed:', error); });
  });
}
