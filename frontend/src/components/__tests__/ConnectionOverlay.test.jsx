// src/components/__tests__/ConnectionOverlay.test.jsx
import React, { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const socketHandlers = {};
const ioHandlers = {};
const mockConnect = vi.fn();

vi.mock('../../socket', () => ({
  default: {
    on: (event, fn) => { socketHandlers[event] = fn; },
    off: vi.fn(),
    connect: (...a) => mockConnect(...a),
    io: {
      on: (event, fn) => { ioHandlers[event] = fn; },
      off: vi.fn(),
    },
  },
}));

const { default: ConnectionOverlay } = await import('../ConnectionOverlay');

describe('ConnectionOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(socketHandlers).forEach((k) => delete socketHandlers[k]);
    Object.keys(ioHandlers).forEach((k) => delete ioHandlers[k]);
  });

  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('shows reconnecting overlay on disconnect', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('transport close'); });
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });

  it('shows attempt count during reconnection', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('transport close'); });
    act(() => { ioHandlers.reconnect_attempt?.(3); });
    expect(screen.getByText(/Attempt 3/)).toBeInTheDocument();
  });

  it('shows Connection Lost on reconnect failure', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('transport close'); });
    act(() => { ioHandlers.reconnect_failed?.(); });
    expect(screen.getByText('Connection Lost')).toBeInTheDocument();
  });

  it('shows Connection Lost on server disconnect', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('io server disconnect'); });
    expect(screen.getByText('Connection Lost')).toBeInTheDocument();
  });

  it('shows Retry Connection button when failed', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('io server disconnect'); });
    expect(screen.getByText('Retry Connection')).toBeInTheDocument();
  });

  it('Retry button calls socket.connect()', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('io server disconnect'); });
    fireEvent.click(screen.getByText('Retry Connection'));
    expect(mockConnect).toHaveBeenCalled();
  });

  it('overlay disappears on successful reconnect', () => {
    const { container } = render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('transport close'); });
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    act(() => { socketHandlers.connect?.(); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('overlay has dialog role', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('transport close'); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows helpful message when connection is lost', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('io server disconnect'); });
    expect(screen.getByText(/Check your connection/)).toBeInTheDocument();
  });

  it('Retry switches from failed back to reconnecting state', () => {
    render(<ConnectionOverlay />);
    act(() => { socketHandlers.disconnect?.('io server disconnect'); });
    expect(screen.getByText('Connection Lost')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry Connection'));
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });
});
