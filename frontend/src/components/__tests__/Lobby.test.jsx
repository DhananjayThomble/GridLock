// src/components/__tests__/Lobby.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
let mockAuthValue = { user: null, loading: false, login: vi.fn(), logout: vi.fn(), refreshUser: vi.fn() };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

vi.mock('../../socket', () => ({
  default: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, id: 'test-id' },
}));

vi.mock('../../utils/sounds', () => ({
  initAudio: vi.fn(),
}));

vi.mock('../../utils/pushManager', () => ({
  subscribeToPush: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../../utils/onboarding', () => ({
  isFirstTime: vi.fn(() => false),
  markPlayed: vi.fn(),
}));

vi.mock('../../utils/safeStorage', () => ({
  safeStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('../../utils/sessionStats', () => ({
  getStats: () => ({ gamesPlayed: 0, wins: 0, losses: 0, draws: 0, bestTerritory: 0, bestStreak: 0, currentStreak: 0, history: [] }),
}));

vi.mock('../GameDemo', () => ({ default: () => <div data-testid="game-demo" /> }));
vi.mock('../QuickPlay', () => ({ default: () => <div data-testid="quick-play" /> }));
vi.mock('../RecentOpponents', () => ({ default: () => null }));
vi.mock('../RankedQueue', () => ({ default: () => null }));

const { default: Lobby } = await import('../Lobby');

const renderLobby = () => render(
  <MemoryRouter>
    <Lobby />
  </MemoryRouter>
);

describe('Lobby', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue = { user: null, loading: false, login: vi.fn(), logout: vi.fn(), refreshUser: vi.fn() };
  });

  it('renders the lobby title', () => {
    renderLobby();
    const titles = screen.getAllByText('GridLock');
    expect(titles.length).toBeGreaterThan(0);
  });

  it('renders Create Game button', () => {
    renderLobby();
    expect(screen.getByLabelText(/Create Game/)).toBeInTheDocument();
  });

  it('renders Quick Play button', () => {
    renderLobby();
    expect(screen.getByLabelText(/Quick Play/)).toBeInTheDocument();
  });

  it('renders Challenge a Friend button', () => {
    renderLobby();
    expect(screen.getByLabelText(/Challenge a Friend/)).toBeInTheDocument();
  });

  it('shows name input field', () => {
    renderLobby();
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('shows grid size options', () => {
    renderLobby();
    const gridOptions = screen.getAllByText('3×3');
    expect(gridOptions.length).toBeGreaterThan(0);
  });

  it('shows player count selector', () => {
    renderLobby();
    const options = screen.getAllByText('2P');
    expect(options.length).toBeGreaterThan(0);
  });

  it('has avatar selection section', () => {
    renderLobby();
    const avatars = screen.getAllByText('👦');
    expect(avatars.length).toBeGreaterThan(0);
  });

  it('shows CPU toggle switch', () => {
    renderLobby();
    const cpuToggle = screen.getByLabelText(/Add CPU opponents/);
    expect(cpuToggle).toBeInTheDocument();
  });

  it('shows join tab when clicking join section', () => {
    renderLobby();
    const joinButtons = screen.getAllByText(/Join/);
    if (joinButtons.length > 0) {
      fireEvent.click(joinButtons[0]);
      expect(screen.getByText(/Game ID/)).toBeInTheDocument();
    }
  });
});
