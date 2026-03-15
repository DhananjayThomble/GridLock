const { isInternalRequest } = require('../middleware/internalAccess');

function mockReq({ ip, remoteAddress, headers = {} } = {}) {
    return {
        ip: ip || '',
        socket: { remoteAddress: remoteAddress || '' },
        headers,
    };
}

describe('isInternalRequest', () => {
    // ── Internal IPs should be allowed ──────────────────────────────────────
    test('127.0.0.1 (loopback) is internal', () => {
        expect(isInternalRequest(mockReq({ ip: '127.0.0.1' }))).toBe(true);
    });

    test('127.0.0.254 (loopback range) is internal', () => {
        expect(isInternalRequest(mockReq({ ip: '127.0.0.254' }))).toBe(true);
    });

    test('10.x.x.x is internal', () => {
        expect(isInternalRequest(mockReq({ ip: '10.0.0.1' }))).toBe(true);
        expect(isInternalRequest(mockReq({ ip: '10.255.255.255' }))).toBe(true);
    });

    test('172.16-31.x.x is internal', () => {
        expect(isInternalRequest(mockReq({ ip: '172.16.0.1' }))).toBe(true);
        expect(isInternalRequest(mockReq({ ip: '172.31.255.255' }))).toBe(true);
    });

    test('172.15.x.x and 172.32.x.x are NOT internal', () => {
        expect(isInternalRequest(mockReq({ ip: '172.15.0.1' }))).toBe(false);
        expect(isInternalRequest(mockReq({ ip: '172.32.0.1' }))).toBe(false);
    });

    test('192.168.x.x is internal', () => {
        expect(isInternalRequest(mockReq({ ip: '192.168.0.1' }))).toBe(true);
        expect(isInternalRequest(mockReq({ ip: '192.168.255.255' }))).toBe(true);
    });

    test('::1 (IPv6 loopback) is internal', () => {
        expect(isInternalRequest(mockReq({ ip: '::1' }))).toBe(true);
    });

    test('::ffff:127.0.0.1 (IPv4-mapped IPv6) is internal', () => {
        expect(isInternalRequest(mockReq({ ip: '::ffff:127.0.0.1' }))).toBe(true);
    });

    // ── External IPs should NOT be internal ─────────────────────────────────
    test('8.8.8.8 is NOT internal', () => {
        expect(isInternalRequest(mockReq({ ip: '8.8.8.8' }))).toBe(false);
    });

    test('1.1.1.1 is NOT internal', () => {
        expect(isInternalRequest(mockReq({ ip: '1.1.1.1' }))).toBe(false);
    });

    test('203.0.113.50 (public) is NOT internal', () => {
        expect(isInternalRequest(mockReq({ ip: '203.0.113.50' }))).toBe(false);
    });

    // ── X-Real-IP header takes precedence ───────────────────────────────────
    test('X-Real-IP is used over socket.remoteAddress', () => {
        // External socket IP but internal X-Real-IP → internal
        const req = mockReq({
            ip: '8.8.8.8',
            headers: { 'x-real-ip': '127.0.0.1' },
        });
        expect(isInternalRequest(req)).toBe(true);
    });

    test('X-Real-IP external overrides internal socket IP', () => {
        const req = mockReq({
            ip: '127.0.0.1',
            headers: { 'x-real-ip': '8.8.8.8' },
        });
        expect(isInternalRequest(req)).toBe(false);
    });

    // ── X-Forwarded-For should NOT be used (prevent spoofing) ───────────────
    test('X-Forwarded-For is NOT used (prevents client spoofing)', () => {
        // External IP with spoofed X-Forwarded-For claiming internal
        const req = mockReq({
            ip: '8.8.8.8',
            headers: { 'x-forwarded-for': '127.0.0.1' },
        });
        expect(isInternalRequest(req)).toBe(false);
    });

    // ── Edge cases ──────────────────────────────────────────────────────────
    test('empty IP defaults to non-internal', () => {
        expect(isInternalRequest(mockReq({}))).toBe(false);
    });

    test('uses socket.remoteAddress as fallback when req.ip is empty', () => {
        const req = mockReq({ remoteAddress: '10.0.0.5' });
        expect(isInternalRequest(req)).toBe(true);
    });

    test('localhost string is internal', () => {
        expect(isInternalRequest(mockReq({ ip: 'localhost' }))).toBe(true);
    });
});
