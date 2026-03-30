// src/contexts/__tests__/AuthContext.test.jsx
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios', async () => {
  const actual = await vi.importActual('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
      get: vi.fn(),
      post: vi.fn(),
      defaults: { withCredentials: true, headers: { common: {} } },
    },
  };
});

// Must import after mock setup
const { AuthProvider, useAuth } = await import('../AuthContext.jsx');

const TestConsumer = () => {
  const { user, loading, login, logout, refreshUser } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.username : 'null'}</span>
      <button onClick={login}>login</button>
      <button onClick={logout}>logout</button>
      <button onClick={refreshUser}>refresh</button>
    </div>
  );
};

const mockUser = {
  id: '123',
  username: 'TestUser',
  displayName: 'Test User',
  email: 'test@example.com',
  avatar: 'https://example.com/pic.jpg',
  usernameSetupComplete: true,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children', async () => {
    axios.get.mockResolvedValue({ data: { success: true, user: null } });
    render(
      <AuthProvider>
        <div data-testid="child">Hello</div>
      </AuthProvider>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('fetches /api/auth/me on mount', async () => {
    axios.get.mockResolvedValue({ data: { success: true, user: null } });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/api/auth/me'));
    });
  });

  it('sets user when authenticated', async () => {
    axios.get.mockResolvedValue({ data: { success: true, user: mockUser } });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('TestUser');
    });
  });

  it('sets user to null when guest', async () => {
    axios.get.mockResolvedValue({ data: { success: true, user: null } });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('null');
    });
  });

  it('login() redirects to correct URL', async () => {
    axios.get.mockResolvedValue({ data: { success: true, user: null } });

    // Mock window.location
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, pathname: '/settings', href: '' };

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    act(() => {
      screen.getByText('login').click();
    });

    expect(window.location.href).toContain('/api/auth/google?returnTo=');
    expect(window.location.href).toContain(encodeURIComponent('/settings'));

    window.location = originalLocation;
  });

  it('logout() clears user', async () => {
    axios.get.mockResolvedValue({ data: { success: true, user: mockUser } });
    axios.post.mockResolvedValue({ data: { success: true } });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('TestUser');
    });

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/auth/logout'));
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('loading is true initially, false after fetch', async () => {
    let resolveMe;
    axios.get.mockImplementation(() => new Promise(resolve => { resolveMe = resolve; }));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await act(async () => {
      resolveMe({ data: { success: true, user: null } });
    });

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('refreshUser() calls /api/auth/me again', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { success: true, user: null } })
      .mockResolvedValueOnce({ data: { success: true, user: mockUser } });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await act(async () => {
      screen.getByText('refresh').click();
    });

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('user')).toHaveTextContent('TestUser');
  });
});
