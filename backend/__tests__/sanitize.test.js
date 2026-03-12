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

  test('rejects script tags as invalid', () => {
    const result = sanitizeUsername('<script>alert("x")</script>');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Username contains invalid characters');
  });

  test('rejects img onerror XSS', () => {
    const result = sanitizeUsername('<img onerror=alert(1)>');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Username contains invalid characters');
  });

  test('rejects username that is ONLY HTML tags', () => {
    expect(sanitizeUsername('<b></b>')).toEqual({
      valid: false, value: '', error: 'Username contains invalid characters',
    });
    expect(sanitizeUsername('<div><span></span></div>')).toEqual({
      valid: false, value: '', error: 'Username contains invalid characters',
    });
  });

  test('rejects javascript: protocol string', () => {
    const result = sanitizeUsername('javascript:alert(1)');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Username contains invalid characters');
  });

  test('rejects unicode XSS attempts with special chars', () => {
    // Strings containing &, ;, quotes, etc. should be rejected by allowlist
    expect(sanitizeUsername('&#60;script&#62;')).toMatchObject({ valid: false });
    // \u0000 is stripped by stripLow, leaving "alert" which is a valid username
    expect(sanitizeUsername('\u0000alert')).toMatchObject({ valid: true });
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

  test('accepts normal usernames with letters and numbers', () => {
    expect(sanitizeUsername('Player1')).toEqual({ valid: true, value: 'Player1' });
    expect(sanitizeUsername('DJ')).toEqual({ valid: true, value: 'DJ' });
  });

  test('accepts usernames with hyphens and underscores', () => {
    expect(sanitizeUsername('cool-player')).toEqual({ valid: true, value: 'cool-player' });
    expect(sanitizeUsername('cool_player')).toEqual({ valid: true, value: 'cool_player' });
  });

  test('accepts usernames with emoji', () => {
    const result = sanitizeUsername('Player🎮');
    expect(result.valid).toBe(true);
    expect(result.value).toContain('Player');
  });

  test('accepts unicode letters', () => {
    expect(sanitizeUsername('Ñoño')).toMatchObject({ valid: true });
    expect(sanitizeUsername('日本語')).toMatchObject({ valid: true });
  });

  test('strips HTML tags but keeps text around them', () => {
    const result = sanitizeUsername('hello<b>world</b>');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('helloworld');
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

  test('strips script tags in avatar, keeps inner text if within length', () => {
    // Tags stripped → "alert(1)" is 8 chars, within limit, not dangerous as plain text
    expect(sanitizeAvatar('<script>alert(1)</script>')).toBe('alert(1)');
    // But if inner text is empty after stripping, falls back to default
    expect(sanitizeAvatar('<script></script>')).toBe('👦');
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
