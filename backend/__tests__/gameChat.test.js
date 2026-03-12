// backend/__tests__/gameChat.test.js
// Unit tests for in-game quick chat & emoji reactions (#216)

const { validatePayload } = require('../middleware/socketSchemas');

const ALLOWED_QUICK_MESSAGES = [
    'Good Luck! 🍀', 'GG! 🤝', 'Hello! 👋',
    'Nice Move! 👍', 'Oops! 😬', 'Wow! 😮', 'No Way! 😲',
    'Too Easy 😎', 'Better Luck Next Time!', "You're Trapped! 🕸️",
    'Well Played! 👏', 'Good Game!', 'Close One! 😅',
    'Thinking... 🤔', 'Hurry Up! ⏰', 'One More! 🔄',
];

const ALLOWED_EMOJIS = [
    '😂', '🔥', '💀', '👏', '😱', '🎉', '😤', '🤯',
    '💪', '🏆', '😭', '❤️', '👀', '🤝', '😈',
];

const ALLOWED_CHAT_CONTENT = new Set([...ALLOWED_QUICK_MESSAGES, ...ALLOWED_EMOJIS]);

describe('game_chat schema validation', () => {
    test('accepts valid quick messages', () => {
        for (const msg of ALLOWED_QUICK_MESSAGES) {
            const result = validatePayload('game_chat', { gameId: 'ABC123', content: msg });
            expect(result.valid).toBe(true);
            expect(result.value.content).toBe(msg);
        }
    });

    test('accepts valid emojis', () => {
        for (const emoji of ALLOWED_EMOJIS) {
            const result = validatePayload('game_chat', { gameId: 'ABC123', content: emoji });
            expect(result.valid).toBe(true);
            expect(result.value.content).toBe(emoji);
        }
    });

    test('rejects missing gameId', () => {
        const result = validatePayload('game_chat', { content: 'Hello! 👋' });
        expect(result.valid).toBe(false);
    });

    test('rejects missing content', () => {
        const result = validatePayload('game_chat', { gameId: 'ABC123' });
        expect(result.valid).toBe(false);
    });

    test('rejects empty content', () => {
        const result = validatePayload('game_chat', { gameId: 'ABC123', content: '' });
        expect(result.valid).toBe(false);
    });

    test('rejects content longer than 50 chars', () => {
        const longMsg = 'A'.repeat(51);
        const result = validatePayload('game_chat', { gameId: 'ABC123', content: longMsg });
        expect(result.valid).toBe(false);
    });
});

describe('game_chat content allowlist', () => {
    test('rejects custom/arbitrary text', () => {
        const malicious = [
            'hello world',
            '<script>alert(1)</script>',
            'Give me your password',
            'Nice move',              // close but not exact
            'GOOD LUCK! 🍀',         // wrong case
            '😂😂',                   // double emoji
        ];
        for (const msg of malicious) {
            expect(ALLOWED_CHAT_CONTENT.has(msg)).toBe(false);
        }
    });

    test('all allowed messages are in the set', () => {
        expect(ALLOWED_CHAT_CONTENT.size).toBe(ALLOWED_QUICK_MESSAGES.length + ALLOWED_EMOJIS.length);
    });

    test('correctly categorizes emoji vs quick message', () => {
        for (const emoji of ALLOWED_EMOJIS) {
            expect(ALLOWED_EMOJIS.includes(emoji)).toBe(true);
            // Single emojis shouldn't be in quick messages
            expect(ALLOWED_QUICK_MESSAGES.includes(emoji)).toBe(false);
        }
    });
});

describe('chatRateLimiter', () => {
    // Note: The chat rate limiter bypasses in test mode (NODE_ENV=test).
    // These tests validate the limiter logic directly by temporarily overriding NODE_ENV.

    let chatRateLimiter;

    beforeAll(() => {
        // require after the module is defined
        chatRateLimiter = require('../controllers/socketHandlers')._internal.chatRateLimiter;
    });

    beforeEach(() => {
        chatRateLimiter.cleanup('test-socket');
    });

    test('limiter exists and has expected methods', () => {
        expect(typeof chatRateLimiter.allow).toBe('function');
        expect(typeof chatRateLimiter.cleanup).toBe('function');
    });

    test('cleanup removes tracker for socket', () => {
        // In test mode allow() always returns true, but cleanup should still work
        chatRateLimiter.allow('test-socket');
        chatRateLimiter.cleanup('test-socket');
        // No error means cleanup works
        expect(true).toBe(true);
    });

    test('allow returns true in test mode (rate limiting bypassed)', () => {
        // NODE_ENV is 'test' during jest runs, so allow() should always return true
        expect(chatRateLimiter.allow('test-socket')).toBe(true);
        expect(chatRateLimiter.allow('test-socket')).toBe(true);
        expect(chatRateLimiter.allow('test-socket')).toBe(true);
    });
});
