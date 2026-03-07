import { useState, useEffect } from 'react';

/**
 * Read all theme-relevant CSS variables from :root.
 * Called once on mount and again whenever [data-theme] changes.
 */
function readCSSVars() {
  const style = getComputedStyle(document.documentElement);
  const get = (v) => style.getPropertyValue(v).trim();
  return {
    '--player1-color': get('--player1-color'),
    '--player2-color': get('--player2-color'),
    '--player3-color': get('--player3-color'),
    '--player4-color': get('--player4-color'),
    '--accent':        get('--accent'),
    '--accent-hover':  get('--accent-hover'),
    '--success':       get('--success'),
    '--danger':        get('--danger'),
    '--warning':       get('--warning'),
    '--text-primary':  get('--text-primary'),
    '--text-secondary': get('--text-secondary'),
    '--text-muted':    get('--text-muted'),
    '--bg-surface':    get('--bg-surface'),
    '--bg-card':       get('--bg-card'),
    '--dot-color':     get('--dot-color'),
    '--line-empty':    get('--line-empty'),
  };
}

export default function useThemeColors() {
  const [colors, setColors] = useState(() => readCSSVars());

  useEffect(() => {
    const observer = new MutationObserver(() => {
      // Small rAF delay so the browser has applied the new theme vars
      requestAnimationFrame(() => setColors(readCSSVars()));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}
