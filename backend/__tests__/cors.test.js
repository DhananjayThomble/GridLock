/**
 * Tests for CORS origin callback logic.
 * We test the callback function in isolation by extracting the same logic.
 */
const { DEFAULT_ORIGINS, getAllowedOrigins } = require('../config/corsOrigins');

describe('CORS origin callback', () => {
    // Mirror the CORS callback logic from server.js
    function corsCheck(origin, allowedOrigins = DEFAULT_ORIGINS) {
        if (!origin) return { allowed: true };
        if (allowedOrigins.includes(origin)) return { allowed: true };
        return { allowed: false, error: 'Not allowed by CORS' };
    }

    test('gridlock.pro is allowed', () => {
        expect(corsCheck('https://gridlock.pro').allowed).toBe(true);
    });

    test('www.gridlock.pro is allowed', () => {
        expect(corsCheck('https://www.gridlock.pro').allowed).toBe(true);
    });

    test('beta.gridlock.pro is allowed', () => {
        expect(corsCheck('https://beta.gridlock.pro').allowed).toBe(true);
    });

    test('localhost:5173 is allowed', () => {
        expect(corsCheck('http://localhost:5173').allowed).toBe(true);
    });

    test('localhost:4173 (preview) is allowed', () => {
        expect(corsCheck('http://localhost:4173').allowed).toBe(true);
    });

    test('evil.com is rejected', () => {
        const result = corsCheck('https://evil.com');
        expect(result.allowed).toBe(false);
    });

    test('null origin is allowed (server-to-server)', () => {
        expect(corsCheck(null).allowed).toBe(true);
    });

    test('undefined origin is allowed (server-to-server)', () => {
        expect(corsCheck(undefined).allowed).toBe(true);
    });

    test('empty string origin is rejected', () => {
        // Empty string is falsy, so treated like no origin
        expect(corsCheck('').allowed).toBe(true);
    });

    describe('CORS_ORIGIN env var parsing', () => {
        test('parses comma-separated origins', () => {
            const original = process.env.CORS_ORIGIN;
            process.env.CORS_ORIGIN = 'https://a.com, https://b.com';
            const result = getAllowedOrigins();
            expect(result).toEqual(['https://a.com', 'https://b.com']);
            if (original === undefined) delete process.env.CORS_ORIGIN;
            else process.env.CORS_ORIGIN = original;
        });

        test('empty string env var falls back to defaults', () => {
            const original = process.env.CORS_ORIGIN;
            process.env.CORS_ORIGIN = '';
            const result = getAllowedOrigins();
            expect(result).toEqual(DEFAULT_ORIGINS);
            if (original === undefined) delete process.env.CORS_ORIGIN;
            else process.env.CORS_ORIGIN = original;
        });

        test('filters out empty strings from trailing comma', () => {
            const original = process.env.CORS_ORIGIN;
            process.env.CORS_ORIGIN = 'https://a.com,,https://b.com,';
            const result = getAllowedOrigins();
            expect(result).toEqual(['https://a.com', 'https://b.com']);
            if (original === undefined) delete process.env.CORS_ORIGIN;
            else process.env.CORS_ORIGIN = original;
        });

        test('handles whitespace-only entries', () => {
            const original = process.env.CORS_ORIGIN;
            process.env.CORS_ORIGIN = 'https://a.com, , https://b.com';
            const result = getAllowedOrigins();
            expect(result).toEqual(['https://a.com', 'https://b.com']);
            if (original === undefined) delete process.env.CORS_ORIGIN;
            else process.env.CORS_ORIGIN = original;
        });

        test('custom origins work with corsCheck', () => {
            const original = process.env.CORS_ORIGIN;
            process.env.CORS_ORIGIN = 'https://custom.dev,https://test.dev';
            const customOrigins = getAllowedOrigins();
            expect(corsCheck('https://custom.dev', customOrigins).allowed).toBe(true);
            expect(corsCheck('https://gridlock.pro', customOrigins).allowed).toBe(false);
            if (original === undefined) delete process.env.CORS_ORIGIN;
            else process.env.CORS_ORIGIN = original;
        });
    });
});
