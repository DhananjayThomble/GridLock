// src/components/__tests__/Profile.test.jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ username: 'TestUser' }),
  useNavigate: () => mockNavigate,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

// Mock useThemeColors hook
vi.mock('../../hooks/useThemeColors', () => ({
  default: () => ({
    '--success': '#3fb950',
    '--danger': '#f85149',
    '--text-muted': '#999',
  }),
}));

// Mock AuthNudge
vi.mock('../AuthNudge', () => ({
  default: () => <div data-testid="auth-nudge">Auth Nudge</div>,
}));

// Mock sentry
vi.mock('../../lib/sentry', () => ({
  captureException: vi.fn(),
}));

// Mock config
vi.mock('../../config', () => ({
  API_BASE: '',
}));

const { default: Profile } = await import('../Profile');

describe('Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    // Mock fetch to never resolve
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(<Profile />);
    expect(screen.getByText('Loading profile…')).toBeInTheDocument();
  });

  it('renders profile data after successful fetch', async () => {
    const profileData = {
      success: true,
      profile: {
        username: 'TestUser',
        avatar: '👦',
        gamesPlayed: 42,
        wins: 20,
        losses: 15,
        draws: 7,
        winRate: 47.6,
        elo: 1200,
        rank: 5,
        currentStreak: 3,
        bestStreak: 8,
        memberSince: '2026-01-15T00:00:00Z',
        lastPlayedAt: '2026-04-01T12:00:00Z',
        eloHistory: [],
        recentMatches: [],
      },
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(profileData),
      })
    );

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    expect(screen.getByText('👦')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument(); // games played
  });

  it('shows error state on fetch failure', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ success: false, error: 'Player not found' }),
      })
    );

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByText('Player not found')).toBeInTheDocument();
    });
  });

  it('shows error state on network failure', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Failed to load profile')));

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load profile')).toBeInTheDocument();
    });
  });

  it('fetches profile for the username from URL params', () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(<Profile />);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/profile/TestUser')
    );
  });
});
