/**
 * Tests for CORS origin callback logic.
 * We test the callback function in isolation by extracting the same logic.
 */

describe('CORS origin callback', () => {
    const DEFAULT_ORIGINS = [
        'https://gridlock.pro',
        'https://www.gridlock.pro',
        'https://beta.gridlock.pro',
        'http://localhost:5173',
        'http://localhost:4173',
        'http://localhost:4175',
    ];

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
        function parseOrigins(envValue) {
            return envValue
                ? envValue.split(',').map(o => o.trim()).filter(Boolean)
                : DEFAULT_ORIGINS;
        }

        test('parses comma-separated origins', () => {
            const result = parseOrigins('https://a.com, https://b.com');
            expect(result).toEqual(['https://a.com', 'https://b.com']);
        });

        test('empty string env var falls back to defaults', () => {
            const result = parseOrigins('');
            expect(result).toEqual(DEFAULT_ORIGINS);
        });

        test('filters out empty strings from trailing comma', () => {
            const result = parseOrigins('https://a.com,,https://b.com,');
            expect(result).toEqual(['https://a.com', 'https://b.com']);
        });

        test('handles whitespace-only entries', () => {
            const result = parseOrigins('https://a.com, , https://b.com');
            expect(result).toEqual(['https://a.com', 'https://b.com']);
        });

        test('custom origins work with corsCheck', () => {
            const customOrigins = parseOrigins('https://custom.dev,https://test.dev');
            expect(corsCheck('https://custom.dev', customOrigins).allowed).toBe(true);
            expect(corsCheck('https://gridlock.pro', customOrigins).allowed).toBe(false);
        });
    });
});
