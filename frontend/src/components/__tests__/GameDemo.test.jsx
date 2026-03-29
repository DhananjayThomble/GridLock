// Unit tests for GameDemo component (TDD — written before implementation)
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Mock GridThemeContext — GameDemo uses useGridTheme
vi.mock('../../contexts/GridThemeContext', () => ({
  useGridTheme: () => ({
    theme: {
      id: 'clean',
      dotColor: '#808892',
      emptyLineColor: '#6a7280',
      lineThickness: 6,
      visualDotSize: 5,
      dotStyle: { borderRadius: '50%' },
      lineStyle: { borderRadius: '3px' },
      players: {
        p1: { lineColor: '#6366f1', boxBg: 'rgba(99,102,241,0.12)' },
        p2: { lineColor: '#f59e0b', boxBg: 'rgba(245,158,11,0.12)' },
      },
    },
  }),
}));

import GameDemo from '../GameDemo';

describe('GameDemo', () => {
  let container;
  let root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (root) {
      act(() => root.unmount());
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('renders without crashing', () => {
    act(() => root.render(<GameDemo />));
    expect(container.querySelector('[data-testid="game-demo"]')).toBeTruthy();
  });

  it('contains 9 dot elements (3×3 for a 2×2 grid)', () => {
    act(() => root.render(<GameDemo />));
    const dots = container.querySelectorAll('[data-testid="demo-dot"]');
    expect(dots.length).toBe(9);
  });

  it('contains 6 horizontal line elements', () => {
    act(() => root.render(<GameDemo />));
    const hLines = container.querySelectorAll('[data-testid^="demo-h-"]');
    expect(hLines.length).toBe(6);
  });

  it('contains 6 vertical line elements', () => {
    act(() => root.render(<GameDemo />));
    const vLines = container.querySelectorAll('[data-testid^="demo-v-"]');
    expect(vLines.length).toBe(6);
  });

  it('contains 4 box elements (2×2)', () => {
    act(() => root.render(<GameDemo />));
    const boxes = container.querySelectorAll('[data-testid^="demo-box-"]');
    expect(boxes.length).toBe(4);
  });

  it('animates first move shortly after mount', () => {
    act(() => root.render(<GameDemo />));

    // Initially no lines should be "active"
    const activeBefore = container.querySelectorAll('.demo-line-active');
    expect(activeBefore.length).toBe(0);

    // First move is at delay 0 → fires via setTimeout(0). Advance 100ms.
    act(() => vi.advanceTimersByTime(100));
    const activeAfter = container.querySelectorAll('.demo-line-active');
    expect(activeAfter.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up all timers on unmount (no memory leaks)', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    act(() => root.render(<GameDemo />));
    act(() => vi.advanceTimersByTime(1000));

    act(() => root.unmount());
    root = null; // prevent double-unmount in afterEach

    const totalCleanups = clearTimeoutSpy.mock.calls.length + clearIntervalSpy.mock.calls.length;
    expect(totalCleanups).toBeGreaterThan(0);

    clearTimeoutSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('shows score "1-0" after box capture at ~2600ms', () => {
    act(() => root.render(<GameDemo />));

    act(() => vi.advanceTimersByTime(3000));

    const score = container.querySelector('[data-testid="demo-score"]');
    expect(score).toBeTruthy();
    expect(score.textContent).toContain('1');
    expect(score.textContent).toContain('0');
  });
});
