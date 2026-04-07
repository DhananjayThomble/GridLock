// src/components/__tests__/BottomNav.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';

import BottomNav from '../BottomNav';

const renderNav = (initialRoute = '/') =>
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <BottomNav />
    </MemoryRouter>
  );

describe('BottomNav', () => {
  it('renders navigation element', () => {
    renderNav();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('has correct aria-label', () => {
    renderNav();
    expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
  });

  it('renders all 5 nav links', () => {
    renderNav();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
  });

  it('renders Lobby link', () => {
    renderNav();
    expect(screen.getByText('Lobby')).toBeInTheDocument();
  });

  it('renders Leaderboard link', () => {
    renderNav();
    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
  });

  it('renders Rules link', () => {
    renderNav();
    expect(screen.getByText('Rules')).toBeInTheDocument();
  });

  it('renders History link', () => {
    renderNav();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('renders Settings link', () => {
    renderNav();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders icons for all tabs', () => {
    renderNav();
    expect(screen.getByText('🏠')).toBeInTheDocument();
    expect(screen.getByText('🏆')).toBeInTheDocument();
    expect(screen.getByText('📖')).toBeInTheDocument();
    expect(screen.getByText('📜')).toBeInTheDocument();
    expect(screen.getByText('⚙️')).toBeInTheDocument();
  });

  it('Lobby link points to /', () => {
    renderNav();
    const lobbyLink = screen.getByText('Lobby').closest('a');
    expect(lobbyLink).toHaveAttribute('href', '/');
  });

  it('Leaderboard link points to /leaderboard', () => {
    renderNav();
    const link = screen.getByText('Leaderboard').closest('a');
    expect(link).toHaveAttribute('href', '/leaderboard');
  });

  it('History link points to /history', () => {
    renderNav();
    const link = screen.getByText('History').closest('a');
    expect(link).toHaveAttribute('href', '/history');
  });

  it('Settings link points to /settings', () => {
    renderNav();
    const link = screen.getByText('Settings').closest('a');
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('Lobby tab is active on root route', () => {
    renderNav('/');
    const lobbyLink = screen.getByText('Lobby').closest('a');
    expect(lobbyLink.className).toContain('active');
  });

  it('Leaderboard tab is active on /leaderboard route', () => {
    renderNav('/leaderboard');
    const link = screen.getByText('Leaderboard').closest('a');
    expect(link.className).toContain('active');
  });

  it('Lobby is not active on other routes', () => {
    renderNav('/settings');
    const lobbyLink = screen.getByText('Lobby').closest('a');
    expect(lobbyLink.className).not.toContain('active');
  });
});
