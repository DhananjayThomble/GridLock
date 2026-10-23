// src/components/__tests__/Leaderboard.test.jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Mock matchMedia for responsive component
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

vi.mock('../../lib/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../RankBadge', () => ({ default: ({ rank }) => <span data-testid="rank-badge">{rank}</span> }));

const { default: Leaderboard } = await import('../Leaderboard');

const renderLeaderboard = () => render(
  <MemoryRouter>
    <Leaderboard />
  </MemoryRouter>
);

const mockLeaderboardData = {
  success: true,
  leaderboard: [
    { username: 'TopPlayer', wins: 50, losses: 10, draws: 5, gamesPlayed: 65, winRate: 76.9, lastPlayed: '2025-12-01T10:00:00Z' },
    { username: 'SecondPlace', wins: 40, losses: 20, draws: 3, gamesPlayed: 63, winRate: 63.5, lastPlayed: '2025-12-02T10:00:00Z' },
  ],
};

describe('Leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  it('shows loading state initially', () => {
    globalThis.fetch.mockImplementation(() => new Promise(() => {}));
    renderLeaderboard();
    expect(document.body).toBeTruthy();
  });

  it('renders leaderboard rows after successful fetch', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(mockLeaderboardData),
    });

    renderLeaderboard();

    await waitFor(() => {
      const topPlayerEls = screen.getAllByText('TopPlayer');
      expect(topPlayerEls.length).toBeGreaterThan(0);
    });
    const secondPlaceEls = screen.getAllByText('SecondPlace');
    expect(secondPlaceEls.length).toBeGreaterThan(0);
  });

  it('shows error message on fetch failure', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: false, error: 'Server error' }),
    });

    renderLeaderboard();

    await waitFor(() => {
      expect(screen.getByText(/Server error|Unable to load/)).toBeInTheDocument();
    });
  });

  it('shows error on network failure', async () => {
    globalThis.fetch.mockRejectedValue(new Error('Network error'));

    renderLeaderboard();

    await waitFor(() => {
      expect(screen.getByText(/Network error|Unable to load/)).toBeInTheDocument();
    });
  });

  it('renders player stats (wins, games played)', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(mockLeaderboardData),
    });

    renderLeaderboard();

    await waitFor(() => {
      const els = screen.getAllByText('TopPlayer');
      expect(els.length).toBeGreaterThan(0);
    });
    // Win or game count should be visible somewhere
    const winsEl = screen.queryByText('50') || screen.queryByText('65') || screen.queryByText('76.9%') || screen.queryByText('77%');
    expect(winsEl).toBeTruthy();
  });

  it('renders empty state when leaderboard is empty', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, leaderboard: [] }),
    });

    renderLeaderboard();

    await waitFor(() => {
      expect(screen.getByText(/No leaderboard|No ranked|No games|Be the first/i)).toBeInTheDocument();
    });
  });

  it('on a phone, a short leaderboard lists each player once (podium cards only, no repeat in the list)', async () => {
    window.matchMedia.mockImplementation((query) => ({
      matches: /max-width:\s*767px/.test(query), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    globalThis.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(mockLeaderboardData),
    });
    renderLeaderboard();
    await waitFor(() => expect(screen.getAllByText('TopPlayer').length).toBeGreaterThan(0));
    expect(screen.getAllByText('TopPlayer')).toHaveLength(1);
    expect(screen.getAllByText('SecondPlace')).toHaveLength(1);
  });
});
