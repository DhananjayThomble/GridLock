// src/components/__tests__/TournamentLobby.test.jsx
import React, { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock socket
const socketHandlers = {};
const mockEmit = vi.fn();
vi.mock('../../socket', () => ({
  default: {
    on: (event, fn) => {
      if (!socketHandlers[event]) socketHandlers[event] = [];
      socketHandlers[event].push(fn);
    },
    off: vi.fn(),
    emit: (...args) => mockEmit(...args),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    state: {
      tournamentId: 'TOURN1',
      username: 'TestUser',
      avatar: '👦',
      tournament: {
        tournamentId: 'TOURN1',
        status: 'waiting',
        tournamentSize: 4,
        gridSize: 3,
        participants: [
          { username: 'TestUser', avatar: '👦' },
          { username: 'Player2', avatar: '👧' },
        ],
        rounds: [],
      },
    },
  }),
  useNavigate: () => mockNavigate,
}));

// Mock posthog and sentry
vi.mock('../../lib/posthog', () => ({ capture: vi.fn() }));
vi.mock('../../lib/sentry', () => ({ addBreadcrumb: vi.fn() }));

// Mock Bracket component
vi.mock('../Bracket', () => ({
  default: () => <div data-testid="bracket">Bracket</div>,
}));

const { default: TournamentLobby } = await import('../TournamentLobby');

const emit = (event, data) => {
  (socketHandlers[event] || []).forEach((fn) => fn(data));
};

describe('TournamentLobby', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(socketHandlers).forEach((k) => delete socketHandlers[k]);
  });

  it('renders tournament title', () => {
    render(<TournamentLobby />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Tournament/);
  });

  it('shows tournament ID', () => {
    render(<TournamentLobby />);
    expect(screen.getByText('TOURN1')).toBeInTheDocument();
  });

  it('shows participant count', () => {
    render(<TournamentLobby />);
    expect(screen.getByText('Players (2/4)')).toBeInTheDocument();
  });

  it('shows participant names', () => {
    render(<TournamentLobby />);
    expect(screen.getByText('TestUser')).toBeInTheDocument();
    expect(screen.getByText('Player2')).toBeInTheDocument();
  });

  it('marks current user with "You" label', () => {
    render(<TournamentLobby />);
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('shows empty slots for remaining spots', () => {
    render(<TournamentLobby />);
    const waitingSlots = screen.getAllByText('Waiting…');
    expect(waitingSlots).toHaveLength(2); // 4 total - 2 joined = 2 waiting
  });

  it('shows waiting status with spots left', () => {
    render(<TournamentLobby />);
    expect(screen.getByText(/2 spots left/)).toBeInTheDocument();
  });

  it('shows grid size info', () => {
    render(<TournamentLobby />);
    expect(screen.getByText(/4 Players · 3×3 Grid/)).toBeInTheDocument();
  });

  it('has Copy and Share buttons', () => {
    render(<TournamentLobby />);
    expect(screen.getByText(/Copy/)).toBeInTheDocument();
    expect(screen.getByLabelText('Share tournament ID')).toBeInTheDocument();
  });

  it('has Back to Lobby button', () => {
    render(<TournamentLobby />);
    const backBtn = screen.getByText('← Back to Lobby');
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('emits get_tournament_state on mount', () => {
    render(<TournamentLobby />);
    expect(mockEmit).toHaveBeenCalledWith('get_tournament_state', { tournamentId: 'TOURN1' });
  });

  it('registers socket listeners on mount', () => {
    render(<TournamentLobby />);
    expect(socketHandlers['tournament_update']).toBeDefined();
    expect(socketHandlers['tournament_game_assigned']).toBeDefined();
    expect(socketHandlers['tournament_completed']).toBeDefined();
  });

  it('shows winner overlay when tournament completes', () => {
    render(<TournamentLobby />);
    act(() => {
      emit('tournament_completed', { champion: 'Player2' });
    });
    expect(screen.getByText('Player2 Wins!')).toBeInTheDocument();
    expect(screen.getByText(/Tournament Champion/)).toBeInTheDocument();
  });

  it('shows error message from socket', () => {
    render(<TournamentLobby />);
    act(() => {
      emit('error', 'Tournament is full');
    });
    expect(screen.getByText('Tournament is full')).toBeInTheDocument();
  });
});
