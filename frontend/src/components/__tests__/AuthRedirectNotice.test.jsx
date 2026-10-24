// src/components/__tests__/AuthRedirectNotice.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ToastProvider from '../../contexts/ToastContext';
import AuthRedirectNotice from '../AuthRedirectNotice';

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
};
const renderAt = (url) => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[url]}>
      <AuthRedirectNotice />
      <Where />
    </MemoryRouter>
  </ToastProvider>
);

describe('AuthRedirectNotice', () => {
  it('tells the player when sign-in failed, and removes the flag from the address', () => {
    renderAt('/?auth=error');
    expect(screen.getByText(/Sign-in didn't complete/)).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('says so when sign-in was cancelled', () => {
    renderAt('/?auth=cancelled');
    expect(screen.getByText('Sign-in cancelled.')).toBeInTheDocument();
  });

  it('keeps other query parameters', () => {
    renderAt('/history?player=Aaa&auth=error');
    expect(screen.getByTestId('where').textContent).toBe('/history?player=Aaa');
  });

  it('does nothing on a normal page', () => {
    renderAt('/?x=1');
    expect(screen.queryByText(/Sign-in/)).not.toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/?x=1');
  });
});
