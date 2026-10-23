// src/components/__tests__/WaitingRoom.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock socket
const socketHandlers = {};
const mockEmit = vi.fn();
vi.mock('../../socket', () => ({
  default: {
    on: (event, fn) => { socketHandlers[event] = fn; },
    off: vi.fn(),
    emit: (...args) => mockEmit(...args),
    connected: true,
    connect: vi.fn(),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
const hostState = {
  gameId: 'ABC123',
  username: 'TestUser',
  sessionToken: 'token123',
  isHost: true,
  gridSize: 3,
  playerCount: 2,
  avatar: '👦',
};
let mockRouteState = hostState;
vi.mock('react-router-dom', () => ({
  useParams: () => ({ gameId: 'ABC123' }),
  useLocation: () => ({ state: mockRouteState }),
  useNavigate: () => mockNavigate,
}));

// Mock qrcode.react
vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr-code">QR</div>,
}));

const { default: WaitingRoom } = await import('../WaitingRoom');

describe('WaitingRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(socketHandlers).forEach((k) => delete socketHandlers[k]);
    mockRouteState = hostState;
  });

  it('renders the game ID', () => {
    render(<WaitingRoom />);
    expect(screen.getByText('ABC123')).toBeInTheDocument();
  });

  it('emits lobby_state on mount', () => {
    render(<WaitingRoom />);
    expect(mockEmit).toHaveBeenCalledWith('lobby_state', { gameId: 'ABC123' });
  });

  it('shows share and copy buttons', () => {
    render(<WaitingRoom />);
    const buttons = screen.getAllByRole('button');
    const hasShare = buttons.some((btn) => btn.textContent.includes('Share'));
    const hasCopy = buttons.some((btn) => btn.textContent.includes('Copy') || btn.getAttribute('aria-label')?.includes('copy') || btn.getAttribute('aria-label')?.includes('Copy'));
    expect(hasShare).toBe(true);
    expect(hasCopy).toBe(true);
  });

  it('shows player slots', () => {
    render(<WaitingRoom />);
    expect(screen.getByText(/TestUser/)).toBeInTheDocument();
  });

  it('shows CPU difficulty section for host', () => {
    render(<WaitingRoom />);
    expect(screen.getByText('CPU Difficulty')).toBeInTheDocument();
    // Difficulty buttons contain emoji + text split across elements
    const buttons = screen.getAllByRole('button');
    const difficultyLabels = ['Easy', 'Medium', 'Hard'];
    difficultyLabels.forEach((label) => {
      const found = buttons.some((btn) => btn.textContent.includes(label));
      expect(found).toBe(true);
    });
  });

  it('shows leave button', () => {
    render(<WaitingRoom />);
    expect(screen.getByText(/Leave Waiting Room/)).toBeInTheDocument();
  });

  // ── Role handed to the board (#590 follow-up: guests were labelled player1) ──
  describe('navigating to the board on game_started', () => {
    const guestState = { ...hostState, isHost: false, role: 'player2', username: 'Guest2', playerCount: 3 };

    it('keeps a guest\'s own role when the server broadcasts game_started without a playerId', () => {
      mockRouteState = guestState;
      render(<WaitingRoom />);
      // This is what the server sends to everyone already in the room when another player joins
      socketHandlers.game_started({ gameId: 'ABC123', playerCount: 3, gridSize: 3 });
      expect(mockNavigate).toHaveBeenCalledWith('/game', expect.objectContaining({
        state: expect.objectContaining({ role: 'player2', username: 'Guest2' }),
      }));
    });

    it('uses the playerId from a targeted game_started when present', () => {
      mockRouteState = guestState;
      render(<WaitingRoom />);
      socketHandlers.game_started({ gameId: 'ABC123', playerId: 'player3', sessionToken: 'tok' });
      expect(mockNavigate).toHaveBeenCalledWith('/game', expect.objectContaining({
        state: expect.objectContaining({ role: 'player3', sessionToken: 'tok' }),
      }));
    });

    it('falls back to player1 only for the host', () => {
      render(<WaitingRoom />);
      socketHandlers.game_started({ gameId: 'ABC123' });
      expect(mockNavigate).toHaveBeenCalledWith('/game', expect.objectContaining({
        state: expect.objectContaining({ role: 'player1' }),
      }));
    });
  });
});
