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

const authenticatedUser = { username: 'DJ', avatar: 'https://example.com/pic.jpg', usernameSetupComplete: true };

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
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    expect(screen.getByTestId('auth-avatar-user')).toBeInTheDocument();
    expect(screen.getByAltText('DJ')).toBeInTheDocument();
  });

  it('dropdown opens on click', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    expect(screen.queryByTestId('auth-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    expect(screen.getByTestId('auth-dropdown')).toBeInTheDocument();
  });

  it('dropdown has profile and sign-out links', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    expect(screen.getByText(/View Profile/)).toBeInTheDocument();
    expect(screen.getByText(/Sign Out/)).toBeInTheDocument();
  });

  it('View Profile navigates to /profile/{username}', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    fireEvent.click(screen.getByText(/View Profile/));
    expect(mockNavigate).toHaveBeenCalledWith('/profile/DJ');
  });

  it('Sign Out calls logout()', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
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

  // #3 — Keyboard support tests
  it('Escape key closes dropdown', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    expect(screen.getByTestId('auth-dropdown')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('auth-dropdown')).not.toBeInTheDocument();
  });

  it('dropdown menu items have role="menuitem" and tabIndex', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    items.forEach(item => {
      expect(item).toHaveAttribute('tabindex', '0');
    });
  });

  it('dropdown has role="menu"', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  // #2 — ArrowDown/ArrowUp keyboard navigation
  it('ArrowDown moves focus to next menu item', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));

    const items = screen.getAllByRole('menuitem');
    // First item should be focused initially (focusedIndex=0 on open)
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
  });

  it('ArrowUp moves focus to previous menu item', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));

    const items = screen.getAllByRole('menuitem');
    // focusedIndex starts at 0, ArrowDown to 1, then ArrowUp back to 0
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(items[0]).toHaveFocus();
  });

  it('Arrow keys wrap around (last → first, first → last)', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));

    const items = screen.getAllByRole('menuitem');
    // From last item, ArrowDown wraps to first
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // 0 → 1
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // 1 → 0 (wrap)
    expect(items[0]).toHaveFocus();

    // From first item, ArrowUp wraps to last
    fireEvent.keyDown(document, { key: 'ArrowUp' }); // 0 → 1 (wrap)
    expect(items[1]).toHaveFocus();
  });

  // #3 — Escape restores focus to trigger
  it('Escape key restores focus to trigger button', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    const trigger = screen.getByTestId('auth-avatar-user');
    fireEvent.click(trigger);
    expect(screen.getByTestId('auth-dropdown')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('auth-dropdown')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  // #12 — Outside click closes dropdown
  it('outside click closes dropdown', () => {
    mockAuthValue = { ...mockAuthValue, user: authenticatedUser };
    renderAvatar();
    fireEvent.click(screen.getByTestId('auth-avatar-user'));
    expect(screen.getByTestId('auth-dropdown')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('auth-dropdown')).not.toBeInTheDocument();
  });
});
