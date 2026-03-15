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

    describe('X-Real-IP header takes precedence', () => {
        test('uses X-Real-IP over socket IP', () => {
            // Socket says public, but X-Real-IP says internal → internal
            expect(isInternalRequest(fakeReq('8.8.8.8', { 'x-real-ip': '127.0.0.1' }))).toBe(true);
        });

        test('public X-Real-IP overrides internal socket IP', () => {
            expect(isInternalRequest(fakeReq('127.0.0.1', { 'x-real-ip': '8.8.8.8' }))).toBe(false);
        });
    });
});
