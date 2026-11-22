// Unit tests for onboarding utilities (TDD — written before implementation)
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isFirstTime, markPlayed, PLAYED_KEY } from '../onboarding';
import { safeStorage } from '../safeStorage';

describe('onboarding utils', () => {
  beforeEach(() => {
    safeStorage.removeItem(PLAYED_KEY);
  });

  describe('isFirstTime()', () => {
    it('returns true when localStorage has no played flag', () => {
      expect(isFirstTime()).toBe(true);
    });

    it('returns false when localStorage has the played flag', () => {
      localStorage.setItem(PLAYED_KEY, 'true');
      expect(isFirstTime()).toBe(false);
    });

    it('returns false when played flag exists but is empty string', () => {
      localStorage.setItem(PLAYED_KEY, '');
      expect(isFirstTime()).toBe(false);
    });
  });

  describe('markPlayed()', () => {
    it('sets the played flag in localStorage', () => {
      expect(isFirstTime()).toBe(true);
      markPlayed();
      expect(isFirstTime()).toBe(false);
    });

    it('sets the exact key "gridlock_has_played" to "true"', () => {
      markPlayed();
      expect(localStorage.getItem(PLAYED_KEY)).toBe('true');
    });

    it('is idempotent — calling twice does not throw', () => {
      markPlayed();
      markPlayed();
      expect(localStorage.getItem(PLAYED_KEY)).toBe('true');
    });

    it('handles localStorage errors gracefully (no throw)', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      });
      try {
        expect(() => markPlayed()).not.toThrow();
        expect(sessionStorage.getItem(PLAYED_KEY)).toBe('true');
      } finally {
        setItem.mockRestore();
      }
    });
  });

  describe('first-time → played transition', () => {
    it('new user starts as first-time, becomes returning after markPlayed', () => {
      expect(isFirstTime()).toBe(true);
      markPlayed();
      expect(isFirstTime()).toBe(false);
    });
  });
});
