// src/components/__tests__/JoinGame.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockEmit = vi.fn();
vi.mock('../../socket', () => ({
  default: { on: vi.fn(), off: vi.fn(), emit: (...a) => mockEmit(...a), connected: true, connect: vi.fn() },
}));
vi.mock('../../utils/sounds', () => ({ initAudio: vi.fn() }));

let mockLocationState = null;
vi.mock('react-router-dom', () => ({
  useParams: () => ({ gameId: 'ABC123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: mockLocationState }),
}));

const { default: JoinGame } = await import('../JoinGame');

describe('JoinGame one-tap rejoin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocationState = null;
  });

  it('rejoins at once when the lobby banner sent us here and a session token is stored', () => {
    localStorage.setItem('gridlock:session:ABC123:Bbb', 'a'.repeat(48));
    mockLocationState = { autoRejoin: true, username: 'Bbb', avatar: '🦊' };
    render(<JoinGame />);
    expect(mockEmit).toHaveBeenCalledWith('join_game', expect.objectContaining({
      gameId: 'ABC123', username: 'Bbb', avatar: '🦊', sessionToken: 'a'.repeat(48),
    }));
  });

  it('only joins once, even if the component re-renders', () => {
    localStorage.setItem('gridlock:session:ABC123:Bbb', 'a'.repeat(48));
    mockLocationState = { autoRejoin: true, username: 'Bbb' };
    const { rerender } = render(<JoinGame />);
    rerender(<JoinGame />);
    expect(mockEmit.mock.calls.filter((c) => c[0] === 'join_game')).toHaveLength(1);
  });

  it('shows the form instead when there is no stored session for that name', () => {
    mockLocationState = { autoRejoin: true, username: 'Bbb' };
    render(<JoinGame />);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Join Game/ })).toBeInTheDocument();
  });

  it('never auto-joins a plain invite link, even with a stored token', () => {
    localStorage.setItem('gridlock:session:ABC123:Bbb', 'a'.repeat(48));
    localStorage.setItem('gridlock_username', 'Bbb');
    render(<JoinGame />);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
