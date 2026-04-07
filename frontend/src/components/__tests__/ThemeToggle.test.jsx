// src/components/__tests__/ThemeToggle.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockToggleTheme = vi.fn();
let mockThemeValue = { theme: 'dark', toggleTheme: mockToggleTheme };

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => mockThemeValue,
}));

const { default: ThemeToggle } = await import('../ThemeToggle');

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockThemeValue = { theme: 'dark', toggleTheme: mockToggleTheme };
  });

  it('renders dark mode label when theme is dark', () => {
    render(<ThemeToggle />);
    expect(screen.getByText(/Dark Mode/)).toBeInTheDocument();
  });

  it('renders light mode label when theme is light', () => {
    mockThemeValue = { theme: 'light', toggleTheme: mockToggleTheme };
    render(<ThemeToggle />);
    expect(screen.getByText(/Light Mode/)).toBeInTheDocument();
  });

  it('renders a switch button', () => {
    render(<ThemeToggle />);
    const switchBtn = screen.getByRole('switch');
    expect(switchBtn).toBeInTheDocument();
  });

  it('switch is checked when dark mode is active', () => {
    render(<ThemeToggle />);
    const switchBtn = screen.getByRole('switch');
    expect(switchBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('switch is unchecked when light mode is active', () => {
    mockThemeValue = { theme: 'light', toggleTheme: mockToggleTheme };
    render(<ThemeToggle />);
    const switchBtn = screen.getByRole('switch');
    expect(switchBtn).toHaveAttribute('aria-checked', 'false');
  });

  it('calls toggleTheme when switch is clicked', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('switch'));
    expect(mockToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('shows hint text to switch to light in dark mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByText(/switch to light/)).toBeInTheDocument();
  });

  it('shows hint text to switch to dark in light mode', () => {
    mockThemeValue = { theme: 'light', toggleTheme: mockToggleTheme };
    render(<ThemeToggle />);
    expect(screen.getByText(/switch to dark/)).toBeInTheDocument();
  });

  it('has correct aria-label for dark mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByLabelText(/Switch to light mode/)).toBeInTheDocument();
  });

  it('has correct aria-label for light mode', () => {
    mockThemeValue = { theme: 'light', toggleTheme: mockToggleTheme };
    render(<ThemeToggle />);
    expect(screen.getByLabelText(/Switch to dark mode/)).toBeInTheDocument();
  });
});
