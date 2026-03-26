// src/components/lobby/buttonStyles.js
// Shared button style helpers for 3-tier hierarchy (Primary → Secondary → Tertiary).
// CSS-variable based — works in dark + light themes.

/** Primary: bold accent — the main CTA */
export const primaryStyle = (disabled = false) => ({
  background: disabled
    ? 'var(--bg-surface)'
    : 'color-mix(in srgb, var(--accent) 12%, transparent)',
  border: `1px solid ${disabled ? 'var(--border-color-strong)' : 'color-mix(in srgb, var(--accent) 35%, transparent)'}`,
  color: disabled ? 'var(--text-muted)' : 'var(--accent)',
});

/** Secondary: muted accent tint — consistent across same-level actions */
export const secondaryStyle = (active = false) => ({
  background: active
    ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
    : 'color-mix(in srgb, var(--accent) 10%, transparent)',
  border: `1px solid color-mix(in srgb, var(--accent) ${active ? '45%' : '25%'}, transparent)`,
  color: 'var(--accent)',
});

/** Tertiary: minimal outline — for utility actions like Join */
export const tertiaryStyle = (active = false) => ({
  background: active ? 'color-mix(in srgb, var(--text-secondary) 14%, transparent)' : 'transparent',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color-strong)'}`,
  color: 'var(--text-secondary)',
});

/** Inactive option card: neutral bg + strong border */
export const inactiveOptionStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color-strong)',
  color: 'var(--text-secondary)',
};

/** Disabled overlay style for loading states */
export const disabledOverlay = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-color-strong)',
  color: 'var(--text-muted)',
};
