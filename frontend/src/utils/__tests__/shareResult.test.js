// Unit tests for shareResult.js
import { describe, it, expect } from 'vitest';
import { generateShareText } from '../shareResult';

describe('generateShareText', () => {
  it('should generate correct text for 3x3 game with player1 winning', () => {
    const gameState = {
      boxes: [
        ['player1', 'player1', 'player1'],
        ['player1', 'player1', 'player2'],
        ['player2', 'player2', 'player2'],
      ],
      scores: { player1: 5, player2: 4 },
      winner: 'player1',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 3, 2, 'player1');
    const lines = result.split('\n');
    expect(lines[0]).toContain('GridLock');
    expect(lines[0]).toContain('3×3');
    expect(lines[0]).toContain('2P');
    expect(lines[1]).toBe('🟦🟦🟦');
    expect(lines[2]).toBe('🟦🟦🟥');
    expect(lines[3]).toBe('🟥🟥🟥');
    expect(result).toContain('5-4');
    expect(result).toContain('Won');
    expect(result).toContain('🏆');
    expect(result).toContain('gridlock.pro');
  });

  it('should generate correct text for 4x4 game with player2 winning', () => {
    const boxes = Array.from({ length: 4 }, () => Array(4).fill('player2'));
    boxes[0][0] = 'player1';
    boxes[0][1] = 'player1';
    const gameState = {
      boxes,
      scores: { player1: 2, player2: 14 },
      winner: 'player2',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 4, 2, 'player2');
    expect(result).toContain('4×4');
    expect(result).toContain('Won');
    expect(result).toContain('🏆');
    expect(result).toContain('2-14');
    expect(result).toContain('gridlock.pro');
    const lines = result.split('\n');
    const gridLine1 = lines.find(l => l.startsWith('🟦'));
    expect(gridLine1).toBe('🟦🟦🟥🟥');
  });

  it('should show Lost with correct emoji for the losing player', () => {
    const boxes = Array.from({ length: 4 }, () => Array(4).fill('player2'));
    boxes[0][0] = 'player1';
    const gameState = {
      boxes,
      scores: { player1: 1, player2: 15 },
      winner: 'player2',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 4, 2, 'player1');
    expect(result).toContain('Lost');
    expect(result).toContain('💔');
    expect(result).not.toContain('🏆');
  });

  it('should handle draw scenario correctly', () => {
    const gameState = {
      boxes: [
        ['player1', 'player2', 'player1'],
        ['player2', 'player1', 'player2'],
        ['player1', 'player2', 'player1'],
      ],
      scores: { player1: 5, player2: 4 },
      winner: 'draw',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 3, 2, 'player1');
    expect(result).toContain('Draw');
    expect(result).toContain('🤝');
    expect(result).not.toContain('🏆');
    expect(result).not.toContain('💔');
    expect(result).toContain('gridlock.pro');
  });

  it('should handle 3-player game correctly', () => {
    const gameState = {
      boxes: [
        ['player1', 'player2', 'player3'],
        ['player1', 'player3', 'player2'],
        ['player3', 'player1', 'player2'],
      ],
      scores: { player1: 3, player2: 3, player3: 3 },
      winner: 'draw',
      playerCount: 3,
    };
    const result = generateShareText(gameState, 3, 3, 'player1');
    expect(result).toContain('3P');
    expect(result).toContain('3×3');
    expect(result).toContain('🟩');
    expect(result).toContain('🤝');
  });

  it('should handle 4-player game correctly', () => {
    const gameState = {
      boxes: [
        ['player1', 'player2', 'player3', 'player4'],
        ['player4', 'player3', 'player2', 'player1'],
        ['player1', 'player2', 'player3', 'player4'],
        ['player4', 'player3', 'player2', 'player1'],
      ],
      scores: { player1: 4, player2: 4, player3: 4, player4: 4 },
      winner: 'player1',
      playerCount: 4,
    };
    const result = generateShareText(gameState, 4, 4, 'player1');
    expect(result).toContain('4P');
    expect(result).toContain('4×4');
    expect(result).toContain('🟦');
    expect(result).toContain('🟥');
    expect(result).toContain('🟩');
    expect(result).toContain('🟨');
    expect(result).toContain('gridlock.pro');
  });

  it('should show unclaimed boxes with black square emoji', () => {
    const gameState = {
      boxes: [
        ['player1', null, null],
        [null, 'player2', null],
        [null, null, null],
      ],
      scores: { player1: 1, player2: 1 },
      winner: 'draw',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 3, 2, 'player1');
    expect(result).toContain('⬛');
  });

  it('should handle fully claimed board with no unclaimed boxes', () => {
    const gameState = {
      boxes: [
        ['player1', 'player1', 'player2'],
        ['player2', 'player1', 'player2'],
        ['player1', 'player2', 'player1'],
      ],
      scores: { player1: 5, player2: 4 },
      winner: 'player1',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 3, 2, 'player1');
    expect(result).not.toContain('⬛');
  });

  it('should return empty string for null game state', () => {
    expect(generateShareText(null, 3, 2, 'player1')).toBe('');
  });

  it('should return empty string for game state without boxes', () => {
    expect(generateShareText({}, 3, 2, 'player1')).toBe('');
  });

  it('should return empty string for undefined game state', () => {
    expect(generateShareText(undefined, 3, 2, 'player1')).toBe('');
  });

  it('should include score line with Score: prefix', () => {
    const gameState = {
      boxes: [['player1', 'player1'], ['player2', 'player2']],
      scores: { player1: 2, player2: 2 },
      winner: 'draw',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 2, 2, 'player1');
    expect(result).toMatch(/Score: \d+-\d+/);
  });

  it('should have correct header format', () => {
    const gameState = {
      boxes: [['player1', 'player2'], ['player2', 'player1']],
      scores: { player1: 2, player2: 2 },
      winner: 'draw',
      playerCount: 2,
    };
    const result = generateShareText(gameState, 2, 2, 'player1');
    const firstLine = result.split('\n')[0];
    expect(firstLine).toContain('GridLock');
    expect(firstLine).toContain('2P');
  });
});
