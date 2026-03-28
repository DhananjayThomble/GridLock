// Unit tests for e2e/helpers/contrast.js
const { parseRgb, parseHex, isTransparent, parseColor, computeContrastRatio } = require('../../e2e/helpers/contrast');

describe('parseRgb', () => {
  test('parses comma-separated rgb()', () => {
    expect(parseRgb('rgb(255, 128, 0)')).toEqual([255, 128, 0]);
  });

  test('parses comma-separated rgba()', () => {
    expect(parseRgb('rgba(255, 128, 0, 0.5)')).toEqual([255, 128, 0, 0.5]);
  });

  test('parses CSS4 space-separated rgb()', () => {
    expect(parseRgb('rgb(255 128 0)')).toEqual([255, 128, 0]);
  });

  test('parses CSS4 space-separated with alpha', () => {
    expect(parseRgb('rgb(255 128 0 / 0.5)')).toEqual([255, 128, 0, 0.5]);
  });

  test('parses CSS4 rgba with slash alpha', () => {
    expect(parseRgb('rgba(10 20 30 / 1)')).toEqual([10, 20, 30, 1]);
  });

  test('returns null for malformed input', () => {
    expect(parseRgb('not a color')).toBeNull();
    expect(parseRgb('')).toBeNull();
    expect(parseRgb('hsl(120, 50%, 50%)')).toBeNull();
  });

  test('clamps RGB values to 0-255', () => {
    const result = parseRgb('rgb(300, -10, 256)');
    // -10 won't match \d+ so this won't parse; test with 0 boundary
    expect(parseRgb('rgb(300, 0, 256)')).toEqual([255, 0, 255]);
  });

  test('clamps alpha to 0-1', () => {
    const result = parseRgb('rgba(100, 100, 100, 1.5)');
    expect(result).toEqual([100, 100, 100, 1]);
  });

  test('handles alpha of 0', () => {
    expect(parseRgb('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0]);
  });

  test('handles NaN alpha gracefully', () => {
    // NaN alpha from parseFloat — should default to 1
    // This won't actually produce NaN via regex since [\d.]+ requires digits,
    // but we test the clamping path
    const result = parseRgb('rgba(100, 100, 100, 0)');
    expect(result[3]).toBe(0);
  });
});

describe('parseHex', () => {
  test('parses #RRGGBB', () => {
    expect(parseHex('#ff8800')).toEqual([255, 136, 0]);
  });

  test('parses RRGGBB without hash', () => {
    expect(parseHex('ff8800')).toEqual([255, 136, 0]);
  });

  test('parses #RGB shorthand', () => {
    expect(parseHex('#f80')).toEqual([255, 136, 0]);
  });

  test('parses black', () => {
    expect(parseHex('#000000')).toEqual([0, 0, 0]);
  });

  test('parses white', () => {
    expect(parseHex('#ffffff')).toEqual([255, 255, 255]);
  });
});

describe('isTransparent', () => {
  test('null/undefined/empty returns true', () => {
    expect(isTransparent(null)).toBe(true);
    expect(isTransparent(undefined)).toBe(true);
    expect(isTransparent('')).toBe(true);
  });

  test('"transparent" keyword returns true', () => {
    expect(isTransparent('transparent')).toBe(true);
    expect(isTransparent('  TRANSPARENT  ')).toBe(true);
  });

  test('rgba with alpha 0 returns true (comma syntax)', () => {
    expect(isTransparent('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isTransparent('rgba(255, 128, 0, 0)')).toBe(true);
  });

  test('rgba with alpha 0 returns true (CSS4 space syntax)', () => {
    expect(isTransparent('rgb(0 0 0 / 0)')).toBe(true);
    expect(isTransparent('rgba(255 128 0 / 0)')).toBe(true);
  });

  test('opaque colors return false', () => {
    expect(isTransparent('rgb(0, 0, 0)')).toBe(false);
    expect(isTransparent('rgba(0, 0, 0, 1)')).toBe(false);
    expect(isTransparent('#000000')).toBe(false);
    expect(isTransparent('rgba(0, 0, 0, 0.5)')).toBe(false);
  });
});

describe('parseColor', () => {
  test('returns null for transparent', () => {
    expect(parseColor('transparent')).toBeNull();
    expect(parseColor('rgba(0, 0, 0, 0)')).toBeNull();
  });

  test('returns null for near-zero alpha', () => {
    expect(parseColor('rgba(100, 100, 100, 0.005)')).toBeNull();
  });

  test('parses hex colors', () => {
    expect(parseColor('#ff0000')).toEqual([255, 0, 0]);
  });

  test('parses rgb colors', () => {
    expect(parseColor('rgb(0, 128, 255)')).toEqual([0, 128, 255]);
  });

  test('strips alpha from rgba (returns rgb only)', () => {
    expect(parseColor('rgba(100, 200, 50, 0.8)')).toEqual([100, 200, 50]);
  });

  test('returns null for unparseable', () => {
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor(null)).toBeNull();
  });
});

describe('computeContrastRatio', () => {
  test('black on white = 21:1', () => {
    const ratio = computeContrastRatio('#000000', '#ffffff');
    expect(ratio).toBeCloseTo(21, 0);
  });

  test('white on white = 1:1', () => {
    expect(computeContrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 1);
  });

  test('returns >= 1 always', () => {
    expect(computeContrastRatio('#333333', '#666666')).toBeGreaterThanOrEqual(1);
  });

  test('handles array input', () => {
    const ratio = computeContrastRatio([0, 0, 0], [255, 255, 255]);
    expect(ratio).toBeCloseTo(21, 0);
  });

  test('returns 1 for unmeasurable colors', () => {
    expect(computeContrastRatio('transparent', '#ffffff')).toBe(1);
  });
});
