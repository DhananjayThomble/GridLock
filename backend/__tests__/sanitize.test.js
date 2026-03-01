const {
  sanitizeUsername,
  sanitizeAvatar,
  sanitizeGameId,
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
