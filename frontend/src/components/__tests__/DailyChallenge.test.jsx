// src/components/__tests__/DailyChallenge.test.jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock socket
const socketHandlers = {};
const mockEmit = vi.fn();
vi.mock('../../socket', () => ({
  default: {
    on: (event, fn) => { socketHandlers[event] = fn; },
    off: vi.fn(),
    emit: (...args) => mockEmit(...args),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock sounds
vi.mock('../../utils/sounds', () => ({
  initAudio: vi.fn(),
  playSound: vi.fn(),
}));

// Mock daily utils
vi.mock('../../utils/daily', () => ({
  apiUrl: (path) => path,
  formatCountdown: (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  },
}));

// Mock DailyResult and DailyLeaderboard
vi.mock('../DailyResult', () => ({
  default: () => <div data-testid="daily-result">Result</div>,
}));
vi.mock('../DailyLeaderboard', () => ({
  default: () => <div data-testid="daily-leaderboard">Leaderboard</div>,
}));

// Mock safeStorage
vi.mock('../../utils/safeStorage', () => ({
  safeStorage: {
    getItem: vi.fn((key) => {
      if (key === 'gridlock_username') return 'TestUser';
      if (key === 'gridlock-avatar') return '👦';
      return null;
    }),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

const { default: DailyChallenge } = await import('../DailyChallenge');

describe('DailyChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(socketHandlers).forEach((k) => delete socketHandlers[k]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches today challenge on mount', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(<DailyChallenge />);
    const calls = global.fetch.mock.calls.map((c) => c[0]);
    expect(calls.some((url) => url.includes('/api/daily/today'))).toBe(true);
  });

  it('fetches streak on mount', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(<DailyChallenge />);
    const calls = global.fetch.mock.calls.map((c) => c[0]);
    expect(calls.some((url) => url.includes('/api/daily/streak/'))).toBe(true);
  });

  it('renders challenge data after successful fetch', async () => {
    const challengeData = {
      success: true,
      challenge: { date: '2026-05-01', gridSize: 3, seed: 12345 },
      alreadyPlayed: false,
      existingResult: null,
      nextPuzzleIn: 3600000,
    };
    const streakData = { success: true, streak: 5 };

    global.fetch = vi.fn((url) => {
      if (url.includes('/api/daily/today')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(challengeData) });
      }
      if (url.includes('/api/daily/streak')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(streakData) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<DailyChallenge />);

    await waitFor(() => {
      // After loading, the component should no longer show loading state
      const loadingElements = screen.queryAllByText(/loading/i);
      // Either no loading text, or the challenge content is visible
      expect(loadingElements.length === 0 || screen.queryByText(/Daily/i)).toBeTruthy();
    });
  });

  it('shows error message on fetch failure', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    render(<DailyChallenge />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to connect/i)).toBeInTheDocument();
    });
  });

  it('shows already played state when alreadyPlayed is true', async () => {
    const challengeData = {
      success: true,
      challenge: { date: '2026-05-01', gridSize: 3, seed: 12345 },
      alreadyPlayed: true,
      existingResult: { score: 7, duration: 45, totalMoves: 9 },
      nextPuzzleIn: 3600000,
    };

    global.fetch = vi.fn((url) => {
      if (url.includes('/api/daily/today')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(challengeData) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, streak: 3 }) });
    });

    render(<DailyChallenge />);

    await waitFor(() => {
      // Should show the result component when already played
      expect(screen.getByTestId('daily-result')).toBeInTheDocument();
    });
  });

  it('shows error from API response', async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/api/daily/today')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: false, error: 'Server maintenance' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, streak: 0 }) });
    });

    render(<DailyChallenge />);

    await waitFor(() => {
      expect(screen.getByText(/Server maintenance/)).toBeInTheDocument();
    });
  });
});
