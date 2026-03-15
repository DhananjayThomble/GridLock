const { isInternalRequest } = require('../middleware/internalAccess');

/** Helper: build a minimal request-like object */
function fakeReq(ip, headers = {}) {
    return { ip, socket: { remoteAddress: ip }, headers };
}

describe('isInternalRequest', () => {
    describe('plain IPv4 private ranges', () => {
        test.each([
            '127.0.0.1',
            '127.255.255.255',
            '10.0.0.1',
            '10.255.255.255',
            '192.168.0.1',
            '192.168.255.255',
            '172.16.0.1',
            '172.31.255.255',
        ])('recognises %s as internal', (ip) => {
            expect(isInternalRequest(fakeReq(ip))).toBe(true);
        });

        test.each([
            '8.8.8.8',
            '172.15.0.1',
            '172.32.0.1',
            '192.169.0.1',
            '11.0.0.1',
        ])('rejects %s as external', (ip) => {
            expect(isInternalRequest(fakeReq(ip))).toBe(false);
        });
    });

    describe('IPv6 loopback', () => {
        test('recognises ::1', () => {
            expect(isInternalRequest(fakeReq('::1'))).toBe(true);
        });
    });

    describe('IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)', () => {
        test.each([
            '::ffff:127.0.0.1',
            '::ffff:127.255.255.255',
            '::ffff:10.0.0.1',
            '::ffff:10.255.255.255',
            '::ffff:192.168.0.1',
            '::ffff:192.168.255.255',
            '::ffff:172.16.0.1',
            '::ffff:172.31.255.255',
        ])('recognises %s as internal', (ip) => {
            expect(isInternalRequest(fakeReq(ip))).toBe(true);
        });

        test.each([
            '::ffff:8.8.8.8',
            '::ffff:172.15.0.1',
            '::ffff:172.32.0.1',
            '::ffff:192.169.0.1',
            '::ffff:11.0.0.1',
        ])('rejects %s as external', (ip) => {
            expect(isInternalRequest(fakeReq(ip))).toBe(false);
        });
    });

    describe('localhost string', () => {
        test('recognises "localhost" as internal', () => {
            expect(isInternalRequest(fakeReq('localhost'))).toBe(true);
        });
    });

    describe('X-Real-IP header — trust chain', () => {
        test('trusts X-Real-IP when socket is internal (Nginx proxy)', () => {
            // Socket from localhost (Nginx), X-Real-IP says internal → internal
            expect(isInternalRequest(fakeReq('127.0.0.1', { 'x-real-ip': '10.0.0.5' }))).toBe(true);
        });

        test('rejects external X-Real-IP even when socket is internal', () => {
            // Socket from localhost (Nginx), but real client is external → external
            expect(isInternalRequest(fakeReq('127.0.0.1', { 'x-real-ip': '8.8.8.8' }))).toBe(false);
        });

        test('IGNORES X-Real-IP when socket is external (anti-spoof)', () => {
            // Direct connection from public IP with spoofed X-Real-IP → external
            // This is the key security fix: can't spoof internal by setting header
            expect(isInternalRequest(fakeReq('8.8.8.8', { 'x-real-ip': '127.0.0.1' }))).toBe(false);
        });

        test('external socket without X-Real-IP is external', () => {
            expect(isInternalRequest(fakeReq('8.8.8.8'))).toBe(false);
        });

        test('internal socket without X-Real-IP is internal', () => {
            expect(isInternalRequest(fakeReq('127.0.0.1'))).toBe(true);
        });
    });
});
