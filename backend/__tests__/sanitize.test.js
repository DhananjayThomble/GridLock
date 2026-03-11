const {
  sanitizeUsername,
  sanitizeAvatar,
  sanitizeGameId,
  validateNumber,
  sanitizeText,
} = require('../utils/sanitize');

describe('sanitizeUsername', () => {
  test('rejects missing and non-string values', () => {
    expect(sanitizeUsername()).toEqual({ valid: false, value: '', error: 'Username is required' });
    expect(sanitizeUsername(null)).toEqual({ valid: false, value: '', error: 'Username is required' });
    expect(sanitizeUsername(123)).toEqual({ valid: false, value: '', error: 'Username is required' });
  });

  test('trims and escapes dangerous characters', () => {
    const result = sanitizeUsername('  <script>alert("x")</script>  ');
    expect(result.valid).toBe(true);
    // Value is escaped and truncated to 20 chars
    expect(result.value).toBe('&lt;script&gt;alert(');
  });

  test('rejects empty after trimming/control cleanup', () => {
    const result = sanitizeUsername('   ');
    expect(result).toEqual({ valid: false, value: '', error: 'Username cannot be empty' });
  });

  test('truncates usernames longer than 20 chars', () => {
    const result = sanitizeUsername('abcdefghijklmnopqrstuvwxyz');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('abcdefghijklmnopqrst');
    expect(result.value.length).toBe(20);
  });

  // ── XSS prevention tests ──────────────────────────────────────────────────
  test('escapes HTML entities in usernames', () => {
    const result = sanitizeUsername('<img src=x onerror=alert(1)>');
    expect(result.valid).toBe(true);
    expect(result.value).not.toContain('<');
    expect(result.value).not.toContain('>');
  });

  test('escapes quotes in usernames', () => {
    const result = sanitizeUsername('user"onclick="alert(1)');
    expect(result.valid).toBe(true);
    expect(result.value).not.toContain('"');
  });

  test('strips null bytes', () => {
    const result = sanitizeUsername('user\0name');
    expect(result.valid).toBe(true);
    expect(result.value).not.toContain('\0');
    expect(result.value).toBe('username');
  });

  test('strips zero-width and unicode control characters', () => {
    const result = sanitizeUsername('user\u200Bname');
    expect(result.valid).toBe(true);
    expect(result.value).not.toContain('\u200B');
  });

  test('handles emoji usernames', () => {
    const result = sanitizeUsername('🎮 Player');
    expect(result.valid).toBe(true);
    expect(result.value).toContain('Player');
  });
});

describe('sanitizeAvatar', () => {
  test('returns default avatar for missing/non-string input', () => {
    expect(sanitizeAvatar()).toBe('👦');
    expect(sanitizeAvatar(null)).toBe('👦');
    expect(sanitizeAvatar(42)).toBe('👦');
  });

  test('removes html tags and keeps safe value', () => {
    expect(sanitizeAvatar('  <b>😎</b>  ')).toBe('😎');
  });

  test('returns default avatar for empty result', () => {
    expect(sanitizeAvatar('   ')).toBe('👦');
    expect(sanitizeAvatar('<b></b>')).toBe('👦');
  });

  test('returns default for avatars longer than 8 chars', () => {
    expect(sanitizeAvatar('toolongavatar')).toBe('👦');
  });

  test('strips null bytes from avatar', () => {
    const result = sanitizeAvatar('😎\0');
    expect(result).not.toContain('\0');
  });

  test('removes event handler attributes', () => {
    const result = sanitizeAvatar('onerror=alert(1)');
    expect(result).not.toContain('onerror');
  });
});

describe('sanitizeGameId', () => {
  test('rejects missing/non-string values', () => {
    expect(sanitizeGameId()).toEqual({ valid: false, value: '', error: 'Game ID is required' });
    expect(sanitizeGameId(null)).toEqual({ valid: false, value: '', error: 'Game ID is required' });
    expect(sanitizeGameId(1234)).toEqual({ valid: false, value: '', error: 'Game ID is required' });
  });

  test('normalizes to uppercase and trims', () => {
    expect(sanitizeGameId('  ab12  ')).toEqual({ valid: true, value: 'AB12' });
  });

  test('accepts valid lengths 4 to 8 alphanumeric', () => {
    expect(sanitizeGameId('A1B2')).toEqual({ valid: true, value: 'A1B2' });
    expect(sanitizeGameId('ABC12345')).toEqual({ valid: true, value: 'ABC12345' });
  });

  test('rejects invalid format/length/characters', () => {
    expect(sanitizeGameId('ABC')).toEqual({ valid: false, value: '', error: 'Invalid Game ID format' });
    expect(sanitizeGameId('ABCDEFGHI')).toEqual({ valid: false, value: '', error: 'Invalid Game ID format' });
    expect(sanitizeGameId('AB-12')).toEqual({ valid: false, value: '', error: 'Invalid Game ID format' });
    expect(sanitizeGameId('AB 12')).toEqual({ valid: false, value: '', error: 'Invalid Game ID format' });
  });
});

describe('validateNumber', () => {
  test('validates numbers within range', () => {
    expect(validateNumber(5, 1, 10, 'test')).toEqual({ valid: true, value: 5 });
    expect(validateNumber('3', 1, 10, 'test')).toEqual({ valid: true, value: 3 });
  });

  test('rejects out-of-range numbers', () => {
    expect(validateNumber(0, 1, 10, 'size').valid).toBe(false);
    expect(validateNumber(11, 1, 10, 'size').valid).toBe(false);
  });

  test('rejects non-numeric input', () => {
    expect(validateNumber('abc', 1, 10, 'size').valid).toBe(false);
    expect(validateNumber(NaN, 1, 10, 'size').valid).toBe(false);
    expect(validateNumber(undefined, 1, 10, 'size').valid).toBe(false);
  });
});

describe('sanitizeText', () => {
  test('returns empty string for non-string input', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(42)).toBe('');
  });

  test('escapes HTML entities', () => {
    const result = sanitizeText('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;');
  });

  test('strips null bytes', () => {
    const result = sanitizeText('hello\0world');
    expect(result).not.toContain('\0');
  });

  test('truncates to maxLength', () => {
    const input = 'a'.repeat(300);
    const result = sanitizeText(input, 100);
    expect(result.length).toBe(100);
  });

  test('uses default maxLength of 200', () => {
    const input = 'b'.repeat(500);
    const result = sanitizeText(input);
    expect(result.length).toBe(200);
  });
});
