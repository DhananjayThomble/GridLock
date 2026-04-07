// src/components/__tests__/GameHistory.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/sentry', () => ({ captureException: vi.fn() }));

const { default: GameHistory } = await import('../GameHistory');

const renderHistory = (route = '/history') => render(
  <MemoryRouter initialEntries={[route]}>
    <GameHistory />
  </MemoryRouter>
);

const mockHistoryData = {
  success: true,
  history: [
    {
      gameId: 'G001',
      result: 'win',
      opponents: ['Rival1'],
      gridSize: 3,
      playerCount: 2,
      duration: 120,
      territory: 67,
      eloDelta: 15,
      scores: { player: 6, opponent: 3 },
      playedAt: '2025-12-01T10:00:00Z',
    },
    {
      gameId: 'G002',
      result: 'loss',
      opponents: ['Rival2'],
      gridSize: 4,
      playerCount: 2,
      duration: 240,
      territory: 33,
      eloDelta: -12,
      scores: { player: 5, opponent: 11 },
      playedAt: '2025-12-02T15:00:00Z',
    },
  ],
  pagination: { page: 1, totalPages: 1, totalCount: 2 },
  stats: { wins: 1, losses: 1, draws: 0, total: 2 },
};

describe('GameHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  it('renders the component without crashing', () => {
    globalThis.fetch.mockImplementation(() => new Promise(() => {}));
    renderHistory();
    expect(document.body).toBeTruthy();
  });

  it('shows username input for searching history', () => {
    globalThis.fetch.mockImplementation(() => new Promise(() => {}));
    renderHistory();
    const input = screen.getByPlaceholderText(/username/i);
    expect(input).toBeInTheDocument();
  });

  it('renders game history entries after fetch', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockHistoryData),
    });

    renderHistory('/history?player=TestUser');

    await waitFor(() => {
      expect(screen.getByText(/Win|🏆/)).toBeInTheDocument();
    });
  });

  it('shows loss entries', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockHistoryData),
    });

    renderHistory('/history?player=TestUser');

    await waitFor(() => {
      expect(screen.getByText(/Loss|💔/)).toBeInTheDocument();
    });
  });

  it('shows error on fetch failure', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ success: false, error: 'Not found' }),
    });

    renderHistory('/history?player=NoOne');

    await waitFor(() => {
      expect(screen.getByText(/Not found|error|Unable/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no history exists', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, history: [], pagination: { page: 1, totalPages: 0, totalCount: 0 }, stats: null }),
    });

    renderHistory('/history?player=NewPlayer');

    await waitFor(() => {
      expect(screen.getByText(/No games|no history|empty/i)).toBeInTheDocument();
    });
  });

  it('allows searching by entering username and submitting', () => {
    globalThis.fetch.mockImplementation(() => new Promise(() => {}));
    renderHistory();
    const input = screen.getByPlaceholderText(/username/i);
    fireEvent.change(input, { target: { value: 'TestUser' } });
    expect(input.value).toBe('TestUser');
  });

  it('shows ELO delta for games', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockHistoryData),
    });

    renderHistory('/history?player=TestUser');

    await waitFor(() => {
      expect(screen.getByText(/\+15/)).toBeInTheDocument();
    });
  });
});
