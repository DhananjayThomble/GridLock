// src/components/__tests__/AuthNudge.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockLogin = vi.fn();
let mockAuthValue;

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

const { default: AuthNudge } = await import('../AuthNudge.jsx');

describe('AuthNudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockAuthValue = { user: null, loading: false, login: mockLogin };
  });

  it('shows nudge for guests', () => {
    render(<AuthNudge message="Save your stats!" />);
    expect(screen.getByTestId('auth-nudge')).toBeInTheDocument();
    expect(screen.getByText(/Save your stats/)).toBeInTheDocument();
  });

  it('does not show for authenticated users', () => {
    mockAuthValue = { user: { username: 'DJ' }, loading: false, login: mockLogin };
    render(<AuthNudge message="Save your stats!" />);
    expect(screen.queryByTestId('auth-nudge')).not.toBeInTheDocument();
  });

  it('sign in button calls login()', () => {
    render(<AuthNudge message="Save your stats!" />);
    fireEvent.click(screen.getByTestId('nudge-sign-in'));
    expect(mockLogin).toHaveBeenCalled();
  });

  it('dismiss hides and stores in localStorage', () => {
    render(<AuthNudge message="Save your stats!" />);
    fireEvent.click(screen.getByTestId('nudge-dismiss'));
    expect(screen.queryByTestId('auth-nudge')).not.toBeInTheDocument();
    expect(localStorage.getItem('gridlock_auth_nudge_dismissed')).toBeTruthy();
  });

  it('does not show if dismissed within 7 days', () => {
    localStorage.setItem('gridlock_auth_nudge_dismissed', String(Date.now()));
    render(<AuthNudge message="Save your stats!" />);
    expect(screen.queryByTestId('auth-nudge')).not.toBeInTheDocument();
  });

  it('shows if dismissal expired (>7 days)', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('gridlock_auth_nudge_dismissed', String(eightDaysAgo));
    render(<AuthNudge message="Save your stats!" />);
    expect(screen.getByTestId('auth-nudge')).toBeInTheDocument();
  });

  it('does not show when loading', () => {
    mockAuthValue = { user: null, loading: true, login: mockLogin };
    render(<AuthNudge message="Save your stats!" />);
    expect(screen.queryByTestId('auth-nudge')).not.toBeInTheDocument();
  });
});
