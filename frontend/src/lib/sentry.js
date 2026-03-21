import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;
const isEnabled = !!dsn;

/**
 * Initialize Sentry for the frontend.
 * No-op when VITE_SENTRY_DSN is not set — zero impact on the app.
 * Must be called before React renders (top of main.jsx).
 */
export function initSentry() {
  if (!isEnabled) return;

  const isProd = import.meta.env.MODE === 'production';

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION
      ? `gridlock-frontend@${import.meta.env.VITE_APP_VERSION}`
      : undefined,
    enabled: true,

    // Performance: light sampling in prod, full in dev
    tracesSampleRate: isProd ? 0.1 : 1.0,

    // Replay: disabled (no need for session replay currently)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Privacy
    sendDefaultPii: false,

    integrations: [
      Sentry.browserTracingIntegration(),
    ],
  });
}

/**
 * Safe captureException — no-op if Sentry is not initialized.
 */
export function captureException(error, context) {
  if (!isEnabled) return;
  Sentry.captureException(error, context);
}

/**
 * Safe addBreadcrumb — no-op if Sentry is not initialized.
 */
export function addBreadcrumb(breadcrumb) {
  if (!isEnabled) return;
  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Safe setUser — no-op if Sentry is not initialized.
 */
export function setUser(user) {
  if (!isEnabled) return;
  Sentry.setUser(user);
}

/**
 * Safe setTag — no-op if Sentry is not initialized.
 */
export function setTag(key, value) {
  if (!isEnabled) return;
  Sentry.setTag(key, value);
}

/**
 * Sentry ErrorBoundary — falls back to children if Sentry is not available.
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

export { Sentry, isEnabled };
