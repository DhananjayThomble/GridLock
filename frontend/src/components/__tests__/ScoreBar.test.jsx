// src/components/__tests__/ScoreBar.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import ScoreBar from '../ScoreBar';

const twoPlayers = [
  { id: 'player1', username: 'Alice', avatar: '👦', color: '#6366f1' },
  { id: 'player2', username: 'Bob', avatar: '👧', color: '#f59e0b' },
];

const fourPlayers = [
  { id: 'player1', username: 'Alice', avatar: '👦', color: '#6366f1' },
  { id: 'player2', username: 'Bob', avatar: '👧', color: '#f59e0b' },
  { id: 'player3', username: 'Charlie', avatar: '🧑', color: '#10b981' },
  { id: 'player4', username: 'Dana', avatar: '👩', color: '#ef4444' },
];

const renderScoreBar = (props = {}) =>
  render(
    <ScoreBar
      players={twoPlayers}
      scores={{ player1: 3, player2: 5 }}
      gridSize={3}
      currentPlayer="player1"
      spectatorCount={0}
      {...props}
    />
  );

describe('ScoreBar', () => {
  it('renders all player names', () => {
    renderScoreBar();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows correct percentage for each player', () => {
    // 3x3 grid = 9 total tiles, player1 has 3 (33%), player2 has 5 (56%)
    renderScoreBar();
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('56%')).toBeInTheDocument();
  });

  it('shows 0% when scores are zero', () => {
    renderScoreBar({ scores: { player1: 0, player2: 0 } });
    const zeroes = screen.getAllByText('0%');
    expect(zeroes).toHaveLength(2);
  });

  it('caps percentage at 100%', () => {
    // Edge case: score exceeds total tiles
    renderScoreBar({ scores: { player1: 20, player2: 0 }, gridSize: 3 });
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('handles missing scores gracefully (defaults to 0)', () => {
    renderScoreBar({ scores: {} });
    const zeroes = screen.getAllByText('0%');
    expect(zeroes).toHaveLength(2);
  });

  it('handles null scores gracefully', () => {
    renderScoreBar({ scores: null });
    const zeroes = screen.getAllByText('0%');
    expect(zeroes).toHaveLength(2);
  });

  it('renders player avatars', () => {
    renderScoreBar();
    expect(screen.getByText('👦')).toBeInTheDocument();
    expect(screen.getByText('👧')).toBeInTheDocument();
  });

  it('applies active styling to current player', () => {
    const { container } = renderScoreBar({ currentPlayer: 'player1' });
    const activeElements = container.querySelectorAll('.score-bar-active-player');
    expect(activeElements.length).toBe(1);
  });

  it('shows spectator count when > 0', () => {
    renderScoreBar({ spectatorCount: 5 });
    expect(screen.getByText(/5 watching/)).toBeInTheDocument();
  });

  it('hides spectator count when 0', () => {
    renderScoreBar({ spectatorCount: 0 });
    expect(screen.queryByText(/watching/)).not.toBeInTheDocument();
  });

  it('renders 4 players in multi-player layout', () => {
    renderScoreBar({ players: fourPlayers, scores: { player1: 1, player2: 2, player3: 3, player4: 3 } });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Dana')).toBeInTheDocument();
  });

  it('shows (left) for departed players', () => {
    const players = [
      { id: 'player1', username: 'Alice', avatar: '👦', color: '#6366f1' },
      { id: 'player2', username: 'Bob', avatar: '👧', color: '#f59e0b', left: true },
    ];
    renderScoreBar({ players });
    expect(screen.getByText('(left)')).toBeInTheDocument();
  });

  it('applies line-through to departed player name', () => {
    const players = [
      { id: 'player1', username: 'Alice', avatar: '👦', color: '#6366f1' },
      { id: 'player2', username: 'Bob', avatar: '👧', color: '#f59e0b', disconnected: true },
    ];
    renderScoreBar({ players });
    const bobName = screen.getByText('Bob');
    expect(bobName.className).toContain('line-through');
  });

  it('does not apply active styling to departed current player', () => {
    const players = [
      { id: 'player1', username: 'Alice', avatar: '👦', color: '#6366f1', left: true },
      { id: 'player2', username: 'Bob', avatar: '👧', color: '#f59e0b' },
    ];
    const { container } = renderScoreBar({ players, currentPlayer: 'player1' });
    const activeElements = container.querySelectorAll('.score-bar-active-player');
    expect(activeElements.length).toBe(0);
  });
});
