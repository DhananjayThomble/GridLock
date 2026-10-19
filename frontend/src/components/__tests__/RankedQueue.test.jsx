// src/components/__tests__/RankedQueue.test.jsx
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock RankBadge — simple stub to avoid deep dependency chain
vi.mock('../RankBadge', () => ({
  default: ({ tier, elo }) => <div data-testid="rank-badge">{tier} ({elo})</div>,
}));

const { default: RankedQueue } = await import('../RankedQueue');

const defaultProps = {
  elo: 1200,
  tier: 'Silver',
  tierIcon: '🥈',
  queueSize: 3,
  placementProgress: null,
  cooldownUntil: null,
  onCancel: vi.fn(),
  profile: { wins: 10, losses: 5, draws: 2 },
};

describe('RankedQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the queue overlay with "Finding Opponent"', () => {
    render(<RankedQueue {...defaultProps} />);
    expect(screen.getByText('Finding Opponent…')).toBeInTheDocument();
  });

  it('shows rank badge with tier and elo', () => {
    render(<RankedQueue {...defaultProps} />);
    expect(screen.getByTestId('rank-badge')).toHaveTextContent('Silver (1200)');
  });

  it('shows queue size', () => {
    render(<RankedQueue {...defaultProps} />);
    expect(screen.getByText(/3 players in ranked queue/)).toBeInTheDocument();
  });

  it('shows singular "player" when queueSize is 1', () => {
    render(<RankedQueue {...defaultProps} queueSize={1} />);
    expect(screen.getByText(/1 player in ranked queue/)).toBeInTheDocument();
  });

  it('shows elapsed timer starting at 0:00', () => {
    render(<RankedQueue {...defaultProps} />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('timer increments each second', () => {
    render(<RankedQueue {...defaultProps} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText('0:05')).toBeInTheDocument();
  });

  it('shows expanded range message after 30 seconds', () => {
    render(<RankedQueue {...defaultProps} />);
    act(() => vi.advanceTimersByTime(31000));
    expect(screen.getByText(/expanded range/)).toBeInTheDocument();
  });

  it('cancel button calls onCancel', () => {
    render(<RankedQueue {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('shows placement progress when provided', () => {
    render(<RankedQueue {...defaultProps} placementProgress="3/5" />);
    expect(screen.getByText(/Placement: 3\/5/)).toBeInTheDocument();
  });

  it('shows win/loss/draw record when profile provided and no placement', () => {
    render(<RankedQueue {...defaultProps} />);
    expect(screen.getByText('10W')).toBeInTheDocument();
    expect(screen.getByText('5L')).toBeInTheDocument();
    expect(screen.getByText('2D')).toBeInTheDocument();
  });

  it('hides W/L/D record when placementProgress is shown', () => {
    render(<RankedQueue {...defaultProps} placementProgress="2/5" />);
    expect(screen.queryByText('10W')).not.toBeInTheDocument();
  });

  it('shows cooldown overlay when cooldownUntil is in the future', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    render(<RankedQueue {...defaultProps} cooldownUntil={future} />);
    expect(screen.getByText('Cooldown Active')).toBeInTheDocument();
    expect(screen.getByText(/You left a ranked game early/)).toBeInTheDocument();
  });

  it('cooldown overlay has Close button that calls onCancel', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    render(<RankedQueue {...defaultProps} cooldownUntil={future} />);
    fireEvent.click(screen.getByText('Close'));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('does not show cooldown overlay when cooldownUntil is in the past', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    render(<RankedQueue {...defaultProps} cooldownUntil={past} />);
    expect(screen.queryByText('Cooldown Active')).not.toBeInTheDocument();
    expect(screen.getByText('Finding Opponent…')).toBeInTheDocument();
  });
});
