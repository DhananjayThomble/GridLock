import { useState, useEffect } from 'react';

let deferredPrompt = null;

// Capture at module level — runs once when JS loads, before any component mounts.
// This ensures the beforeinstallprompt event is never missed, even if the
// consuming component hasn't mounted yet (e.g. Settings page on first visit).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
}

export function usePwaInstall() {
  const [prompt, setPrompt] = useState(() => deferredPrompt);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      deferredPrompt = e;
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    setPrompt(null);
  };

  const isStandalone =
    typeof window !== 'undefined' &&
    window.matchMedia('(display-mode: standalone)').matches;

  return { canInstall: !!prompt && !isStandalone, install };
}
