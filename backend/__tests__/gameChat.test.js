// backend/__tests__/gameChat.test.js
// Unit tests for in-game quick chat & emoji reactions (#216)

const { validatePayload } = require('../middleware/socketSchemas');
const { ALLOWED_QUICK_MESSAGES, ALLOWED_EMOJIS, ALLOWED_CHAT_CONTENT } = require('../constants/chatConstants');

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
    let chatRateLimiter;

    beforeAll(() => {
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
        chatRateLimiter.allow('test-socket', 1000);
        chatRateLimiter.cleanup('test-socket');
        // After cleanup, next allow should succeed (fresh tracker)
        expect(chatRateLimiter.allow('test-socket', 2000)).toBe(true);
    });

    test('first message is allowed', () => {
        expect(chatRateLimiter.allow('test-socket', 1000)).toBe(true);
    });

    test('immediate second message is rate-limited (within 2s interval)', () => {
        expect(chatRateLimiter.allow('test-socket', 1000)).toBe(true);
        // Same timestamp — within 2s min interval
        expect(chatRateLimiter.allow('test-socket', 1000)).toBe(false);
        // 1s later — still within 2s
        expect(chatRateLimiter.allow('test-socket', 2000)).toBe(false);
    });

    test('message after cooldown passes', () => {
        expect(chatRateLimiter.allow('test-socket', 1000)).toBe(true);
        // Wait 2001ms (past the 2s min interval)
        expect(chatRateLimiter.allow('test-socket', 3001)).toBe(true);
    });

    test('per-minute cap (10 messages) is enforced', () => {
        let now = 10000;
        for (let i = 0; i < 10; i++) {
            expect(chatRateLimiter.allow('test-socket', now)).toBe(true);
            now += 2100; // space them out past min interval
        }
        // 11th message within the minute window should fail
        expect(chatRateLimiter.allow('test-socket', now)).toBe(false);
    });

    test('messages allowed again after window expires', () => {
        let now = 10000;
        for (let i = 0; i < 10; i++) {
            chatRateLimiter.allow('test-socket', now);
            now += 2100;
        }
        // Jump past 60s window
        now = 10000 + 61000;
        expect(chatRateLimiter.allow('test-socket', now)).toBe(true);
    });
});
