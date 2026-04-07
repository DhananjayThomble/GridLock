// src/components/__tests__/QuickPlay.test.jsx
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock socket
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockEmit = vi.fn();
vi.mock('../../socket', () => ({
  default: { on: (...args) => mockOn(...args), off: (...args) => mockOff(...args), emit: (...args) => mockEmit(...args) },
}));

// Mock safeStorage
vi.mock('../../utils/safeStorage', () => ({
  safeStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

const { default: QuickPlay } = await import('../QuickPlay');

const defaultProps = {
  gridSize: 3,
  playerCount: 2,
  queueSize: 1,
  username: 'TestUser',
  avatar: '👦',
  onCancel: vi.fn(),
  onPlayCPU: vi.fn(),
};

describe('QuickPlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders matchmaking dialog', () => {
    render(<QuickPlay {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Searching for 2-player match/)).toBeInTheDocument();
  });

  it('shows grid size display', () => {
    render(<QuickPlay {...defaultProps} />);
    expect(screen.getByText('3×3')).toBeInTheDocument();
  });

  it('renders player count radio buttons', () => {
    render(<QuickPlay {...defaultProps} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3); // 2P, 3P, 4P
    expect(screen.getByText('2P')).toBeInTheDocument();
    expect(screen.getByText('3P')).toBeInTheDocument();
    expect(screen.getByText('4P')).toBeInTheDocument();
  });

  it('has 2P selected by default', () => {
    render(<QuickPlay {...defaultProps} />);
    const radios = screen.getAllByRole('radio');
    const selected = radios.find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected).toHaveTextContent('2P');
  });

  it('shows cancel button that calls onCancel', () => {
    render(<QuickPlay {...defaultProps} />);
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('shows elapsed timer starting at 0s', () => {
    render(<QuickPlay {...defaultProps} />);
    expect(screen.getByText(/⏱ 0s/)).toBeInTheDocument();
  });

  it('timer increments each second', () => {
    render(<QuickPlay {...defaultProps} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText(/⏱ 3s/)).toBeInTheDocument();
  });

  it('shows queue size', () => {
    render(<QuickPlay {...defaultProps} queueSize={3} />);
    expect(screen.getByText('👥 3')).toBeInTheDocument();
  });

  it('shows CPU option after 15 seconds', () => {
    render(<QuickPlay {...defaultProps} />);
    expect(screen.queryByText(/CPU/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(16000));
    expect(screen.getByText(/CPU/)).toBeInTheDocument();
  });

  it('shows "No opponents found" after timeout (30s)', () => {
    render(<QuickPlay {...defaultProps} />);
    act(() => vi.advanceTimersByTime(31000));
    expect(screen.getByText('No opponents found')).toBeInTheDocument();
  });

  it('CPU button calls onPlayCPU with selected player count', () => {
    render(<QuickPlay {...defaultProps} />);
    act(() => vi.advanceTimersByTime(16000));
    const cpuBtn = screen.getByText(/CPU/);
    fireEvent.click(cpuBtn);
    expect(defaultProps.onPlayCPU).toHaveBeenCalledWith(2);
  });

  it('changing player count re-queues via socket', () => {
    render(<QuickPlay {...defaultProps} />);
    const threeP = screen.getByText('3P');
    fireEvent.click(threeP);
    expect(mockEmit).toHaveBeenCalledWith('queue_leave');
    expect(mockEmit).toHaveBeenCalledWith('queue_join', expect.objectContaining({ playerCount: 3 }));
  });

  it('changing player count resets timer', () => {
    render(<QuickPlay {...defaultProps} />);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByText(/⏱ 10s/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('3P'));
    expect(screen.getByText(/⏱ 0s/)).toBeInTheDocument();
  });

  it('registers socket listeners on mount', () => {
    render(<QuickPlay {...defaultProps} />);
    expect(mockOn).toHaveBeenCalledWith('queue_status', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('queue_timeout', expect.any(Function));
  });

  it('cleans up socket listeners on unmount', () => {
    const { unmount } = render(<QuickPlay {...defaultProps} />);
    unmount();
    expect(mockOff).toHaveBeenCalledWith('queue_status', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('queue_timeout', expect.any(Function));
  });
});
