import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateShareText, shareOrCopy } from '../shareResult';

describe('generateShareText', () => {
  it('shares the winner, board size, final score and playable URL', () => {
    const state = { winner: 'player1', scores: { player1: 5, player2: 4 } };
    expect(generateShareText(state, 3, 2, 'player1')).toBe([
      'I won in GridLock! 3×3 · 2 players',
      'Score: 5–4 boxes',
      'Play Dots & Boxes: https://gridlock.pro/',
    ].join('\n'));
  });

  it('formats a loss against the CPU', () => {
    const state = { hasCPU: true, winner: 'player2', scores: { player1: 0, player2: 9 } };
    expect(generateShareText(state, 3, 2, 'player1')).toContain('I lost in GridLock! 3×3 · vs CPU\nScore: 0–9 boxes');
  });

  it('puts the sharing player’s score first', () => {
    const state = { winner: 'player2', scores: { player1: 4, player2: 5 } };
    expect(generateShareText(state, 3, 2, 'player2')).toContain('Score: 5–4 boxes');
  });

  it.each([3, 4])('keeps all scores for a %i-player draw', (playerCount) => {
    const state = { winner: 'draw', playerCount, scores: { player1: 4, player2: 4, player3: 1 } };
    const result = generateShareText(state, 3, undefined, 'player2', { tournamentRound: true });
    expect(result).toContain('Draw in GridLock! 3×3 · Tournament');
    expect(result).toContain(playerCount === 3 ? '4–4–1 boxes' : '4–4–1–0 boxes');
  });

  it.each([null, undefined, {}])('returns no result for an unfinished game', (state) => {
    expect(generateShareText(state, 3, 2, 'player1')).toBe('');
  });
});

describe('shareOrCopy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens native share without writing to the clipboard', async () => {
    const share = vi.fn().mockResolvedValue();
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    expect(await shareOrCopy('result')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'result' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the result if native share fails', async () => {
    const share = vi.fn().mockRejectedValue(new Error('Share failed'));
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    expect(await shareOrCopy('result')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('result');
  });

  it('leaves the clipboard alone when sharing is cancelled', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    expect(await shareOrCopy('result')).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });
});
