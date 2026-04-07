// src/components/__tests__/GameController.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

// Mock Board to isolate GameController logic
vi.mock('../Board', () => ({
  default: ({ rows, cols }) => (
    <div data-testid="mock-board" data-rows={rows} data-cols={cols}>
      Board {rows}x{cols}
    </div>
  ),
}));

const { default: GameController } = await import('../GameController');

describe('GameController', () => {
  it('renders the title', () => {
    render(<GameController />);
    expect(screen.getByText('GridLock')).toBeInTheDocument();
  });

  it('renders a grid size selector with default value 3', () => {
    render(<GameController />);
    const select = screen.getByLabelText('Grid Size:');
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('3');
  });

  it('renders Board with default 3x3 grid', () => {
    render(<GameController />);
    const board = screen.getByTestId('mock-board');
    expect(board).toHaveAttribute('data-rows', '3');
    expect(board).toHaveAttribute('data-cols', '3');
  });

  it('offers grid size options 3, 4, 5, 6, 8', () => {
    render(<GameController />);
    const select = screen.getByLabelText('Grid Size:');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['3', '4', '5', '6', '8']);
  });

  it('updates Board when grid size changes to 5', () => {
    render(<GameController />);
    const select = screen.getByLabelText('Grid Size:');
    fireEvent.change(select, { target: { value: '5' } });
    const board = screen.getByTestId('mock-board');
    expect(board).toHaveAttribute('data-rows', '5');
    expect(board).toHaveAttribute('data-cols', '5');
  });

  it('updates Board when grid size changes to 8', () => {
    render(<GameController />);
    const select = screen.getByLabelText('Grid Size:');
    fireEvent.change(select, { target: { value: '8' } });
    const board = screen.getByTestId('mock-board');
    expect(board).toHaveAttribute('data-rows', '8');
    expect(board).toHaveAttribute('data-cols', '8');
  });

  it('shows instructions text', () => {
    render(<GameController />);
    expect(screen.getByText(/Click on lines to connect dots/)).toBeInTheDocument();
  });
});
