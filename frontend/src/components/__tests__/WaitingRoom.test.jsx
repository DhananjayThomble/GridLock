// src/components/__tests__/WaitingRoom.test.jsx
import React from 'react';
import { render, screen, act } from '@testing-library/react';
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

  it('shares a link to the site it is running on, not a hardcoded address', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<WaitingRoom />);
    await act(async () => { screen.getByRole('button', { name: /Share/ }).click(); });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/ABC123`);
  });

  it('refreshes the seats when a guest leaves, so they do not linger on the host\'s screen', () => {
    render(<WaitingRoom />);
    mockEmit.mockClear();
    socketHandlers.player_left({ playerId: 'player2', username: 'Bbb', reason: 'left_lobby' });
    expect(mockEmit).toHaveBeenCalledWith('lobby_state', { gameId: 'ABC123' });
  });

  // Leaving is an explicit action: re-renders and remounts must never give up the seat
  it('tells the server it is leaving only when the leave button is pressed', () => {
    const { rerender, unmount } = render(<WaitingRoom />);
    rerender(<WaitingRoom />);
    expect(mockEmit).not.toHaveBeenCalledWith('leave_waiting_room', expect.anything());
    screen.getByRole('button', { name: /Leave/ }).click();
    expect(mockEmit).toHaveBeenCalledWith('leave_waiting_room', { gameId: 'ABC123' });
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    unmount();
  });

  // ── Refresh / reconnect / closed room (#593) ───────────────────────────────────
  describe('keeping the seat', () => {
    const guestState = { ...hostState, isHost: false, role: 'player2', username: 'Guest2', playerCount: 3, sessionToken: 'a'.repeat(48) };

    it('stays in the waiting room while seats are empty, even if the server says game_started', () => {
      mockRouteState = guestState;
      render(<WaitingRoom />);
      socketHandlers.game_started({ gameId: 'ABC123', playerCount: 3, playerId: 'player2', players: { player1: { username: 'H' }, player2: { username: 'Guest2' } } });
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith('lobby_state', { gameId: 'ABC123' });
    });

    it('goes to the board once every seat is taken', () => {
      mockRouteState = guestState;
      render(<WaitingRoom />);
      socketHandlers.game_started({ gameId: 'ABC123', playerCount: 3, players: { player1: { username: 'H' }, player2: { username: 'Guest2' }, player3: { username: 'G3' } } });
      expect(mockNavigate).toHaveBeenCalledWith('/game', expect.objectContaining({ state: expect.objectContaining({ role: 'player2' }) }));
    });

    it('puts itself back in the room (with its token) after a refresh', () => {
      mockRouteState = guestState;
      render(<WaitingRoom />);
      socketHandlers.error('Not in this game');
      expect(mockEmit).toHaveBeenCalledWith('join_game', expect.objectContaining({
        gameId: 'ABC123', username: 'Guest2', sessionToken: 'a'.repeat(48),
      }));
    });

    it('only tries to re-register once, then tells the player and heads for the lobby', () => {
      mockRouteState = guestState;
      render(<WaitingRoom />);
      act(() => { socketHandlers.error('Not in this game'); });
      act(() => { socketHandlers.error('Not in this game'); }); // a second lobby_state reply is not a failure
      expect(screen.queryByText(/Could not rejoin/)).not.toBeInTheDocument();
      act(() => { socketHandlers.error('This username is already in use.'); });
      expect(mockEmit.mock.calls.filter((c) => c[0] === 'join_game')).toHaveLength(1);
      expect(screen.getByText(/Could not rejoin this room/)).toBeInTheDocument();
    });

    it('asks for the lobby again when the connection comes back', () => {
      render(<WaitingRoom />);
      mockEmit.mockClear();
      socketHandlers.connect();
      expect(mockEmit).toHaveBeenCalledWith('lobby_state', { gameId: 'ABC123' });
    });

    it('tells guests when the host has gone and the room is closed', () => {
      mockRouteState = guestState;
      render(<WaitingRoom />);
      act(() => { socketHandlers.room_closed({ reason: 'Host disconnected', gameId: 'ABC123' }); });
      expect(screen.getByText(/room was closed/)).toBeInTheDocument();
    });
  });
});
