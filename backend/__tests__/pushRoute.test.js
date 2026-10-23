/**
 * backend/__tests__/pushRoute.test.js
 *
 * HTTP integration tests for the push-subscription REST route (routes/push.js).
 * These exercise the Express handlers end-to-end against an in-memory MongoDB,
 * complementing pushService.test.js (which unit-tests the push delivery service).
 *
 * Pattern mirrors profile.test.js / authIntegration.test.js.
 *
 * NOTE: /subscribe and /unsubscribe share a single module-level rate limiter
 * (20 requests / IP / hour). All requests in this file come from the same test
 * client IP, so the number of rate-limited requests is intentionally kept well
 * under 20 to avoid spurious 429s. An explicit "exceeds limit -> 429" test is
 * deliberately omitted (see report) because it would consume the whole budget
 * and the limiting behaviour lives in the third-party express-rate-limit lib.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');

const PushSubscription = require('../models/PushSubscription');
const pushRouter = require('../routes/push');
const log = require('../utils/logger');

let mongoServer;
let app; // no Socket.IO on app.locals.io
let appWithIo; // Socket.IO present on app.locals.io

// Minimal fake Socket.IO server: only the shape push.js touches.
const mockIo = {
    sockets: {
        sockets: new Map([
            ['sock-alice', { data: { username: 'alice' } }],
            ['sock-anon', { data: {} }], // connected but no identity attached
        ]),
    },
};

function validSubscription(endpoint = 'https://push.example.com/ep-1') {
    return {
        endpoint,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    };
}

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    app = express();
    app.use(express.json());
    app.use('/api/push', pushRouter);

    appWithIo = express();
    appWithIo.use(express.json());
    appWithIo.locals.io = mockIo;
    appWithIo.use('/api/push', pushRouter);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
    jest.restoreAllMocks();
});

describe('GET /api/push/vapid-public-key', () => {
    test('returns 503 when VAPID public key is not configured', async () => {
        const original = process.env.VAPID_PUBLIC_KEY;
        delete process.env.VAPID_PUBLIC_KEY;
        try {
            const res = await request(app).get('/api/push/vapid-public-key');
            expect(res.status).toBe(503);
            expect(res.body.error).toMatch(/not configured/i);
        } finally {
            if (original === undefined) delete process.env.VAPID_PUBLIC_KEY;
            else process.env.VAPID_PUBLIC_KEY = original;
        }
    });

    test('returns the public key when configured', async () => {
        const original = process.env.VAPID_PUBLIC_KEY;
        process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
        try {
            const res = await request(app).get('/api/push/vapid-public-key');
            expect(res.status).toBe(200);
            expect(res.body.publicKey).toBe('test-vapid-public-key');
        } finally {
            if (original === undefined) delete process.env.VAPID_PUBLIC_KEY;
            else process.env.VAPID_PUBLIC_KEY = original;
        }
    });
});

describe('POST /api/push/subscribe', () => {
    test('returns 400 when the body is empty', async () => {
        const res = await request(app).post('/api/push/subscribe').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/missing required fields/i);
    });

    test('returns 400 when username is missing', async () => {
        const res = await request(app)
            .post('/api/push/subscribe')
            .send({ subscription: validSubscription() });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/missing required fields/i);
    });

    test('returns 400 for an invalid username', async () => {
        const res = await request(app)
            .post('/api/push/subscribe')
            .send({ username: '<script>', subscription: validSubscription() });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid username/i);
    });

    test('saves a subscription and returns 201 (no Socket.IO configured)', async () => {
        const res = await request(app)
            .post('/api/push/subscribe')
            .send({ username: 'alice', subscription: validSubscription('https://push.example.com/save') });

        expect(res.status).toBe(201);
        expect(res.body.message).toMatch(/subscription saved/i);

        const stored = await PushSubscription.find({ username: 'alice' }).lean();
        expect(stored).toHaveLength(1);
        expect(stored[0].endpoint).toBe('https://push.example.com/save');
        expect(stored[0].keys.p256dh).toBe('p256dh-key');
    });

    test('upserts by endpoint rather than creating duplicates', async () => {
        const endpoint = 'https://push.example.com/shared';
        await PushSubscription.create({
            username: 'olduser',
            endpoint,
            keys: { p256dh: 'old-p', auth: 'old-a' },
        });

        const res = await request(app)
            .post('/api/push/subscribe')
            .send({ username: 'newuser', subscription: validSubscription(endpoint) });

        expect(res.status).toBe(201);
        const all = await PushSubscription.find({ endpoint }).lean();
        expect(all).toHaveLength(1);
        expect(all[0].username).toBe('newuser'); // record updated in place
    });

    test('returns 400 when Socket.IO is present but no socketId is provided', async () => {
        const res = await request(appWithIo)
            .post('/api/push/subscribe')
            .send({ username: 'alice', subscription: validSubscription('https://push.example.com/nosock') });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/socketId is required/i);
    });

    test('returns 403 when the socketId is not connected', async () => {
        const res = await request(appWithIo)
            .post('/api/push/subscribe')
            .send({
                username: 'alice',
                socketId: 'sock-missing',
                subscription: validSubscription('https://push.example.com/missing'),
            });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/not connected/i);
    });

    test('returns 403 when the socket identity does not match the username', async () => {
        const res = await request(appWithIo)
            .post('/api/push/subscribe')
            .send({
                username: 'bob',
                socketId: 'sock-alice', // this socket belongs to alice
                subscription: validSubscription('https://push.example.com/mismatch'),
            });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/identity mismatch/i);
    });

    test('returns 201 when the socket identity matches the username', async () => {
        const res = await request(appWithIo)
            .post('/api/push/subscribe')
            .send({
                username: 'alice',
                socketId: 'sock-alice',
                subscription: validSubscription('https://push.example.com/match'),
            });
        expect(res.status).toBe(201);
        expect(res.body.message).toMatch(/subscription saved/i);
    });

    test('returns 201 when the socket is connected but has no identity yet', async () => {
        const res = await request(appWithIo)
            .post('/api/push/subscribe')
            .send({
                username: 'anyone',
                socketId: 'sock-anon',
                subscription: validSubscription('https://push.example.com/anon'),
            });
        expect(res.status).toBe(201);
    });

    test('returns 500 when persistence fails', async () => {
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(PushSubscription, 'findOneAndUpdate').mockRejectedValue(new Error('db down'));

        const res = await request(app)
            .post('/api/push/subscribe')
            .send({ username: 'alice', subscription: validSubscription('https://push.example.com/fail') });

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/failed to save subscription/i);
    });
});

describe('POST/DELETE /api/push/unsubscribe', () => {
    test('POST returns 400 when endpoint is missing', async () => {
        const res = await request(app).post('/api/push/unsubscribe').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/missing endpoint/i);
    });

    test('POST removes an existing subscription', async () => {
        const endpoint = 'https://push.example.com/remove-post';
        await PushSubscription.create({
            username: 'alice',
            endpoint,
            keys: { p256dh: 'p', auth: 'a' },
        });

        const res = await request(app).post('/api/push/unsubscribe').send({ endpoint });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/subscription removed/i);

        const remaining = await PushSubscription.find({ endpoint }).lean();
        expect(remaining).toHaveLength(0);
    });

    test('DELETE removes an existing subscription (backwards-compatible alias)', async () => {
        const endpoint = 'https://push.example.com/remove-delete';
        await PushSubscription.create({
            username: 'alice',
            endpoint,
            keys: { p256dh: 'p', auth: 'a' },
        });

        const res = await request(app).delete('/api/push/unsubscribe').send({ endpoint });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/subscription removed/i);

        const remaining = await PushSubscription.find({ endpoint }).lean();
        expect(remaining).toHaveLength(0);
    });

    test('POST is a no-op (still 200) for an unknown endpoint', async () => {
        const res = await request(app)
            .post('/api/push/unsubscribe')
            .send({ endpoint: 'https://push.example.com/does-not-exist' });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/subscription removed/i);
    });

    test('returns 500 when deletion fails', async () => {
        jest.spyOn(log, 'error').mockImplementation(() => {});
        jest.spyOn(PushSubscription, 'deleteOne').mockRejectedValue(new Error('db down'));

        const res = await request(app)
            .post('/api/push/unsubscribe')
            .send({ endpoint: 'https://push.example.com/fail' });

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/failed to remove subscription/i);
    });

    test('rejects a non-string endpoint instead of treating it as a query operator', async () => {
        const keep = await PushSubscription.create({
            username: 'carol',
            endpoint: 'https://push.example.com/keep',
            keys: { p256dh: 'p', auth: 'a' },
        });

        const res = await request(app)
            .post('/api/push/unsubscribe')
            .send({ endpoint: { $ne: null } });

        expect(res.status).toBe(400);
        expect(await PushSubscription.findById(keep._id)).not.toBeNull();
    });
});
