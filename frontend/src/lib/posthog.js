import posthog from 'posthog-js';

export function initPostHog() {
  const apiKey = import.meta.env.VITE_POSTHOG_KEY;
  const apiHost = import.meta.env.VITE_POSTHOG_HOST || 'https://analytics.gridlock.pro';

  if (!apiKey) return;

  posthog.init(apiKey, {
    api_host: apiHost,
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug();
    },
  });
}

export { posthog };
