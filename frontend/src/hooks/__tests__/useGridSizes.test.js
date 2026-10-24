// src/hooks/__tests__/useGridSizes.test.js
import { renderHook } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import useGridSizes from '../useGridSizes';

const original = { w: window.innerWidth, h: window.innerHeight };
const setViewport = (w, h) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
};

describe('useGridSizes', () => {
  afterEach(() => setViewport(original.w, original.h));

  // The UI around the board is ~350px tall (ScoreBar, header, score cards, toolbar), so the
  // board plus that must fit the window or the Leave button ends up below the fold.
  it.each([
    ['laptop 1280x720', 1280, 720],
    ['desktop 1440x900', 1440, 900],
    ['full HD 1920x1080', 1920, 1080],
    ['iPad Mini 768x1024', 768, 1024],
    ['iPad landscape 1080x810', 1080, 810],
  ])('%s: board plus surrounding UI fits the window', (_name, w, h) => {
    for (const cells of [3, 4, 5, 6]) {
      setViewport(w, h);
      const { result } = renderHook(() => useGridSizes(cells));
      expect(result.current.gridTotal, `${cells}x${cells}`).toBeGreaterThan(0);
      expect(result.current.gridTotal + 351).toBeLessThanOrEqual(h);
    }
  });

  it('phones in landscape get a board that uses the short screen', () => {
    setViewport(750, 340);
    const { result } = renderHook(() => useGridSizes(3));
    expect(result.current.gridTotal).toBeGreaterThanOrEqual(200);
    expect(result.current.gridTotal + 96).toBeLessThanOrEqual(340);
  });
});
