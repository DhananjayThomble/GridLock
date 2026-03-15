import posthog from 'posthog-js';

/**
 * Safe wrapper around posthog.capture that guards against posthog not being initialized.
 * Use this instead of calling posthog.capture directly to avoid runtime errors.
 */
export const capture = (...args) => posthog?.capture?.(...args);

export function initPostHog() {
  const apiKey = import.meta.env.VITE_POSTHOG_KEY;
  const apiHost = import.meta.env.VITE_POSTHOG_HOST;

  if (!apiKey) return;

  const options = {
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug();
    },
  };

  // Only set api_host if explicitly provided — no hardcoded fallback
  if (apiHost) {
    options.api_host = apiHost;
  }

  posthog.init(apiKey, options);
}

export { posthog };
