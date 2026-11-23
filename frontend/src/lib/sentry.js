import * as Sentry from '@sentry/react';
import { createElement, useEffect } from 'react';
import { Routes, createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom';

const dsn = import.meta.env.VITE_SENTRY_DSN;
const isEnabled = Boolean(dsn) && import.meta.env.PROD
  && typeof window !== 'undefined'
  && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export let SentryRoutes = Routes;

function sampleRate(value, fallback) {
  const rate = Number(value);
  return value?.trim() && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
}

function redactRoute(name) {
  return name?.split(/[?#]/)[0].replace(
    /\/(waiting|join|replay|profile|challenge|tournament|play)\/(?!:)[^/]+/g,
    '/$1/:id',
  );
}

function scrubEvent(event) {
  delete event.request;
  delete event.user;
  delete event.extra;
  event.transaction = redactRoute(event.transaction);
  return event;
}

/**
 * Initialize Sentry for the frontend.
 * No-op when VITE_SENTRY_DSN is not set — zero impact on the app.
 * Must be called before React renders (top of main.jsx).
 */
export function initSentry() {
  if (!isEnabled) return;

  const replayRate = sampleRate(import.meta.env.VITE_SENTRY_REPLAY_ON_ERROR_RATE, 0);
  const apiBase = import.meta.env.VITE_API_BASE_URL || window.location.origin;
  const origin = new URL(apiBase, window.location.origin).origin;
  const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tracePropagationTargets = [/^\/api(?:\/|$)/, new RegExp(`^${escapedOrigin}/api(?:/|$)`)];

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    tracesSampleRate: sampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.1),
    tracePropagationTargets,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: replayRate,
    sendDefaultPii: false,
    enableLogs: true,
    beforeBreadcrumb(breadcrumb) {
      if (!['socket', 'game'].includes(breadcrumb.category)) return null;
      return { category: breadcrumb.category, message: breadcrumb.message, level: breadcrumb.level };
    },
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeSendSpan(span) {
      // The browser SDK uses the transaction span format.
      for (const key of Object.keys(span.data || {})) {
        if (/^(?:url\.|http\.(?:url|target|request\.header|response\.header))/.test(key)) {
          delete span.data[key];
        }
      }
      span.description = redactRoute(span.description);
      return span;
    },
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect, useLocation, useNavigationType, createRoutesFromChildren, matchRoutes,
      }),
      ...(replayRate > 0 ? [Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      })] : []),
    ],
  });
  SentryRoutes = Sentry.withSentryReactRouterV7Routing(Routes);
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

export function logSentryWarning(message, attributes) {
  if (isEnabled) Sentry.logger.warn(message, attributes);
}

/**
 * Safe setTag — no-op if Sentry is not initialized.
 */
export function setTag(key, value) {
  if (!isEnabled) return;
  Sentry.setTag(key, value);
}

/**
 * Sentry ErrorBoundary wrapper.
 * When Sentry is enabled, delegates to Sentry.ErrorBoundary.
 * When disabled, renders children directly (no error boundary overhead).
 */
export function SentryErrorBoundary({ children, ...props }) {
  if (!isEnabled) return children;
  return createElement(Sentry.ErrorBoundary, props, children);
}

export { Sentry, isEnabled };
