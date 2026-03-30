// src/components/__tests__/SettingsAccount.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

const mockLogin = vi.fn();
const mockLogout = vi.fn();
let mockAuthValue;

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

// Mock all settings dependencies to isolate the Account section
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

vi.mock('../../contexts/GridThemeContext', () => ({
  useGridTheme: () => ({ themeId: 'classic', setTheme: vi.fn(), unlockedThemes: ['classic'] }),
}));

vi.mock('../../utils/sounds', () => ({
  getSoundSettings: () => ({ masterMute: false, moveSound: true, scoreSound: true, turnAlert: true, vibration: true, volume: 75 }),
  saveSoundSettings: vi.fn(),
}));

vi.mock('../../utils/pushManager', () => ({
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

vi.mock('../../utils/sessionStats', () => ({
  getStats: () => ({ gamesPlayed: 0, wins: 0, losses: 0, draws: 0, bestTerritory: 0, bestStreak: 0, currentStreak: 0, history: [] }),
  getWinRate: () => '0%',
  getAvgTerritory: () => '0%',
  resetStats: vi.fn(),
}));

vi.mock('../../hooks/usePwaInstall', () => ({
  usePwaInstall: () => ({ canInstall: false, install: vi.fn() }),
}));

vi.mock('../../themes/gridThemes', () => ({
  GRID_THEMES: { classic: { name: 'Classic', dotColor: '#fff', emptyLineColor: '#ccc', lineThickness: 2, visualDotSize: 6, players: { p1: { lineColor: '#00f', boxBg: '#00f' }, p2: { lineColor: '#f00', boxBg: '#f00' } } } },
  THEME_IDS: ['classic'],
  UNLOCK_CONDITIONS: {},
}));

vi.mock('../../socket', () => ({ default: { id: 'test-socket' } }));

// Mock axios for delete account
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
      delete: vi.fn(),
      defaults: { withCredentials: true, headers: { common: {} } },
    },
  };
});

const { default: Settings } = await import('../Settings.jsx');

const renderSettings = () => render(
  <MemoryRouter>
    <Settings />
  </MemoryRouter>
);

describe('Settings Account Section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue = { user: null, loading: false, login: mockLogin, logout: mockLogout, refreshUser: vi.fn() };
  });

  it('shows sign-in button for guests', () => {
    renderSettings();
    expect(screen.getByTestId('auth-sign-in-button')).toBeInTheDocument();
    expect(screen.getByText(/Sign in with Google/)).toBeInTheDocument();
  });

  it('sign-in button calls login()', () => {
    renderSettings();
    fireEvent.click(screen.getByTestId('auth-sign-in-button'));
    expect(mockLogin).toHaveBeenCalled();
  });

  it('shows account info for authenticated users', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        username: 'DJ_Grid',
        email: 'dj@example.com',
        avatar: 'https://example.com/pic.jpg',
        displayName: 'DJ',
      },
    };
    renderSettings();
    expect(screen.getByText('DJ_Grid')).toBeInTheDocument();
    expect(screen.getByText('dj@example.com')).toBeInTheDocument();
  });

  it('shows sign-out button for authenticated users', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        username: 'DJ_Grid',
        email: 'dj@example.com',
        avatar: 'https://example.com/pic.jpg',
      },
    };
    renderSettings();
    const signOutBtn = screen.getByTestId('auth-sign-out-button');
    expect(signOutBtn).toBeInTheDocument();
    fireEvent.click(signOutBtn);
    expect(mockLogout).toHaveBeenCalled();
  });

  it('delete button shows confirmation', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        username: 'DJ_Grid',
        email: 'dj@example.com',
        avatar: 'https://example.com/pic.jpg',
      },
    };
    renderSettings();
    const deleteBtn = screen.getByTestId('auth-delete-button');
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);
    // Confirmation modal/text should appear
    expect(screen.getByTestId('delete-confirm-modal')).toBeInTheDocument();
  });

  // #4 — Delete modal keyboard a11y
  it('Escape closes the delete confirmation modal', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        username: 'DJ_Grid',
        email: 'dj@example.com',
        avatar: 'https://example.com/pic.jpg',
      },
    };
    renderSettings();
    fireEvent.click(screen.getByTestId('auth-delete-button'));
    expect(screen.getByTestId('delete-confirm-modal')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('delete-confirm-modal')).not.toBeInTheDocument();
  });

  it('delete modal focuses cancel button on open and restores focus to delete button on close', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        username: 'DJ_Grid',
        email: 'dj@example.com',
        avatar: 'https://example.com/pic.jpg',
      },
    };
    renderSettings();
    const deleteBtn = screen.getByTestId('auth-delete-button');
    fireEvent.click(deleteBtn);

    // Cancel button should be focused when modal opens (focus trap)
    const cancelBtn = screen.getByText('Cancel');
    expect(cancelBtn).toHaveFocus();

    // Escape should close and restore focus to delete button
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('delete-confirm-modal')).not.toBeInTheDocument();
    expect(deleteBtn).toHaveFocus();
  });

  // Delete confirmation happy path
  it('confirms delete calls API and logout', async () => {
    axios.delete.mockResolvedValue({ data: { success: true } });
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        username: 'DJ_Grid',
        email: 'dj@example.com',
        avatar: 'https://example.com/pic.jpg',
      },
    };
    renderSettings();
    fireEvent.click(screen.getByTestId('auth-delete-button'));
    fireEvent.click(screen.getByTestId('delete-confirm-button'));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/api/auth/account'));
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  // Delete confirmation error path
  it('shows error when delete API fails', async () => {
    axios.delete.mockRejectedValue({
      response: { status: 500, data: { error: 'Server error' } },
    });
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        username: 'DJ_Grid',
        email: 'dj@example.com',
        avatar: 'https://example.com/pic.jpg',
      },
    };
    renderSettings();
    fireEvent.click(screen.getByTestId('auth-delete-button'));
    fireEvent.click(screen.getByTestId('delete-confirm-button'));

    expect(await screen.findByTestId('delete-error')).toHaveTextContent('Server error');
    // Should NOT logout on failure
    expect(mockLogout).not.toHaveBeenCalled();
    // Modal should still be open
    expect(screen.getByTestId('delete-confirm-modal')).toBeInTheDocument();
  });
});
