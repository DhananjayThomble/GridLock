// src/components/__tests__/PostGameStatsCard.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../utils/postGameUtils', () => ({
  formatDuration: (s) => {
    if (!s && s !== 0) return '—';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m ? `${m}m ${sec}s` : `${sec}s`;
  },
  calcEloChange: vi.fn(() => null),
}));

// Mock fetchElo — module-level constant in PostGameStatsCard
globalThis.fetch = vi.fn(() => Promise.resolve({
  ok: false,
  json: () => Promise.resolve({}),
}));

const { default: PostGameStatsCard } = await import('../PostGameStatsCard');

const baseGameState = {
  player1Name: 'Alice',
  player2Name: 'Bob',
  player1IsCPU: false,
  player2IsCPU: false,
};

const defaultProps = {
  gameState: baseGameState,
  scores: { player1: 5, player2: 4 },
  playerIds: ['player1', 'player2'],
  gridSize: 3,
  moveCount: { player1: 12, player2: 11 },
  gameDuration: 120,
  role: 'player1',
  winnerData: { winner: 'player1', winnerName: 'Alice' },
  onShare: vi.fn(),
  shareStatus: null,
};

const renderCard = (props = {}) => render(
  <MemoryRouter>
    <PostGameStatsCard {...defaultProps} {...props} />
  </MemoryRouter>
);

describe('PostGameStatsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the stats card', () => {
    renderCard();
    expect(screen.getByTestId('post-game-stats')).toBeInTheDocument();
  });

  it('shows territory percentage for each player', () => {
    // 5/9 = 56%, 4/9 = 44%
    renderCard();
    expect(screen.getByTestId('territory-pct-player1')).toHaveTextContent('56%');
    expect(screen.getByTestId('territory-pct-player2')).toHaveTextContent('44%');
  });

  it('shows move counts for each player', () => {
    renderCard();
    expect(screen.getByTestId('move-count-player1')).toHaveTextContent('12');
    expect(screen.getByTestId('move-count-player2')).toHaveTextContent('11');
  });

  it('shows game duration', () => {
    renderCard();
    expect(screen.getByTestId('game-duration')).toHaveTextContent('2m 0s');
  });

  it('shows share button', () => {
    renderCard();
    expect(screen.getByTestId('stats-share-btn')).toBeInTheDocument();
  });

  it('renders profile links for players', () => {
    renderCard();
    expect(screen.getByTestId('profile-link-player1')).toBeInTheDocument();
    expect(screen.getByTestId('profile-link-player2')).toBeInTheDocument();
  });

  it('profile links point to correct URLs', () => {
    renderCard();
    const link1 = screen.getByTestId('profile-link-player1');
    expect(link1).toHaveAttribute('href', '/profile/Alice');
  });

  it('handles zero duration', () => {
    renderCard({ gameDuration: 0 });
    expect(screen.getByTestId('game-duration')).toHaveTextContent('0s');
  });

  it('handles missing move counts gracefully', () => {
    renderCard({ moveCount: {} });
    // Should render without crashing
    expect(screen.getByTestId('post-game-stats')).toBeInTheDocument();
  });

  it('shows 100% territory when one player takes all boxes', () => {
    renderCard({ scores: { player1: 9, player2: 0 } });
    expect(screen.getByTestId('territory-pct-player1')).toHaveTextContent('100%');
    expect(screen.getByTestId('territory-pct-player2')).toHaveTextContent('0%');
  });

  it('shows ELO note for multi-player games', () => {
    renderCard({
      playerIds: ['player1', 'player2', 'player3'],
      scores: { player1: 3, player2: 3, player3: 3 },
      moveCount: { player1: 8, player2: 8, player3: 8 },
      gameState: {
        ...baseGameState,
        player3Name: 'Charlie',
        player3IsCPU: false,
      },
    });
    expect(screen.getByTestId('elo-1v1-note')).toBeInTheDocument();
  });
});
