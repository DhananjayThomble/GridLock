// src/components/__tests__/AuthSetup.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

const mockNavigate = vi.fn();
const mockRefreshUser = vi.fn();
let mockAuthValue;

vi.mock('axios', async () => {
  const actual = await vi.importActual('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
      post: vi.fn(),
      defaults: { withCredentials: true, headers: { common: {} } },
    },
  };
});

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

const { default: AuthSetup } = await import('../AuthSetup.jsx');

const renderSetup = () => render(
  <MemoryRouter>
    <AuthSetup />
  </MemoryRouter>
);

describe('AuthSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue = {
      user: {
        displayName: 'John Doe',
        usernameSetupComplete: false,
      },
      loading: false,
      refreshUser: mockRefreshUser,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pre-fills displayName as username suggestion', () => {
    renderSetup();
    const input = screen.getByTestId('username-input');
    expect(input.value).toBe('John_Doe');
  });

  it('validates username format — too short', async () => {
    renderSetup();
    const input = screen.getByTestId('username-input');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.click(screen.getByTestId('setup-submit'));
    expect(await screen.findByTestId('setup-error')).toHaveTextContent('at least 2');
  });

  it('validates username format — invalid chars', async () => {
    renderSetup();
    const input = screen.getByTestId('username-input');
    fireEvent.change(input, { target: { value: 'bad name!' } });
    fireEvent.click(screen.getByTestId('setup-submit'));
    expect(await screen.findByTestId('setup-error')).toHaveTextContent('Only letters');
  });

  it('shows error on 409', async () => {
    axios.post.mockRejectedValue({
      response: { status: 409, data: { success: false, error: 'Username already taken' } },
    });
    renderSetup();
    const input = screen.getByTestId('username-input');
    fireEvent.change(input, { target: { value: 'TakenName' } });
    fireEvent.click(screen.getByTestId('setup-submit'));

    expect(await screen.findByTestId('setup-error')).toHaveTextContent('already taken');
  });

  it('shows generic error on non-409 server error', async () => {
    axios.post.mockRejectedValue({
      response: { status: 500, data: {} },
    });
    renderSetup();
    const input = screen.getByTestId('username-input');
    fireEvent.change(input, { target: { value: 'ValidUser' } });
    fireEvent.click(screen.getByTestId('setup-submit'));

    expect(await screen.findByTestId('setup-error')).toHaveTextContent('Something went wrong');
  });

  it('redirects on success', async () => {
    axios.post.mockResolvedValue({ data: { success: true, user: {} } });
    mockRefreshUser.mockResolvedValue(undefined);

    renderSetup();
    const input = screen.getByTestId('username-input');
    fireEvent.change(input, { target: { value: 'ValidUser' } });
    fireEvent.click(screen.getByTestId('setup-submit'));

    await waitFor(() => {
      expect(mockRefreshUser).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('redirects to / if already setup complete', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: { ...mockAuthValue.user, usernameSetupComplete: true },
    };
    renderSetup();
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('shows availability status after debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSetup();
    const input = screen.getByTestId('username-input');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'GoodName' } });
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByTestId('setup-available')).toHaveTextContent('Username looks good');
  });

  it('rejects reserved usernames after debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSetup();
    const input = screen.getByTestId('username-input');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'admin' } });
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByTestId('setup-validation')).toHaveTextContent('reserved');
  });

  it('disables submit when validation fails after debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSetup();
    const input = screen.getByTestId('username-input');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'admin' } });
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByTestId('setup-submit')).toBeDisabled();
  });
});
