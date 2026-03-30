// src/components/__tests__/AuthAvatar.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockNavigate = vi.fn();
let mockAuthValue = { user: null, loading: false, login: mockLogin, logout: mockLogout, refreshUser: vi.fn() };

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const { default: AuthAvatar } = await import('../AuthAvatar.jsx');

const renderAvatar = () => render(
  <MemoryRouter>
    <AuthAvatar />
  </MemoryRouter>
);

describe('AuthAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue = { user: null, loading: false, login: mockLogin, logout: mockLogout, refreshUser: vi.fn() };
  });

  it('shows sign-in icon when guest', () => {
    renderAvatar();
    expect(screen.getByTestId('auth-avatar-guest')).toBeInTheDocument();
  });

  it('calls login() when guest clicks icon', () => {
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-guest'));
    expect(mockLogin).toHaveBeenCalled();
  });

  it('shows avatar when authenticated', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: { username: 'DJ', avatar: 'https://example.com/pic.jpg', usernameSetupComplete: true },
    };
    renderAvatar();
    expect(screen.getByTestId('auth-avatar-user')).toBeInTheDocument();
    expect(screen.getByAltText('DJ')).toBeInTheDocument();
  });

  it('dropdown opens on click', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: { username: 'DJ', avatar: 'https://example.com/pic.jpg', usernameSetupComplete: true },
    };
    renderAvatar();
    expect(screen.queryByTestId('auth-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    expect(screen.getByTestId('auth-dropdown')).toBeInTheDocument();
  });

  it('dropdown has profile and sign-out links', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: { username: 'DJ', avatar: 'https://example.com/pic.jpg', usernameSetupComplete: true },
    };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    expect(screen.getByText(/View Profile/)).toBeInTheDocument();
    expect(screen.getByText(/Sign Out/)).toBeInTheDocument();
  });

  it('View Profile navigates to /profile/{username}', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: { username: 'DJ', avatar: 'https://example.com/pic.jpg', usernameSetupComplete: true },
    };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    fireEvent.click(screen.getByText(/View Profile/));
    expect(mockNavigate).toHaveBeenCalledWith('/profile/DJ');
  });

  it('Sign Out calls logout()', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: { username: 'DJ', avatar: 'https://example.com/pic.jpg', usernameSetupComplete: true },
    };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    fireEvent.click(screen.getByText(/Sign Out/));
    expect(mockLogout).toHaveBeenCalled();
  });

  it('returns null when loading', () => {
    mockAuthValue = { ...mockAuthValue, loading: true };
    const { container } = renderAvatar();
    expect(container.innerHTML).toBe('');
  });
});
