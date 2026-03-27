// e2e/helpers/contrast.js
// WCAG 2.1 relative luminance and contrast ratio utilities.

/**
 * Parse a hex color string (#RGB, #RRGGBB, or RRGGBB) into [r, g, b] (0-255).
 */
function parseHex(hex) {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

/**
 * Parse rgb(r, g, b) or rgba(r, g, b, a) string into [r, g, b] (0-255).
 */
function parseRgb(str) {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * Parse any CSS color string into [r, g, b].
 * Supports #hex, rgb(), rgba().
 */
function parseColor(color) {
  if (!color) return null;
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) return parseHex(trimmed);
  if (trimmed.startsWith('rgb')) return parseRgb(trimmed);
  return null;
}

/**
 * Compute WCAG 2.1 relative luminance for an sRGB channel value (0-255).
 */
function linearize(channel) {
  const sRGB = channel / 255;
  return sRGB <= 0.04045
    ? sRGB / 12.92
    : Math.pow((sRGB + 0.055) / 1.055, 2.4);
}

/**
 * Compute WCAG 2.1 relative luminance for [r, g, b] (0-255).
 */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute WCAG contrast ratio between two colors.
 * Each color can be a hex string (#RRGGBB), rgb() string, or [r,g,b] array.
 * Returns a number ≥ 1.
 */
function computeContrastRatio(color1, color2) {
  const rgb1 = Array.isArray(color1) ? color1 : parseColor(color1);
  const rgb2 = Array.isArray(color2) ? color2 : parseColor(color2);
  if (!rgb1 || !rgb2) return 1; // fallback — can't measure

  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

module.exports = { computeContrastRatio, parseColor, relativeLuminance };
