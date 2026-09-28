import { describe, expect, it } from 'vitest';

import { WEBDAV_SYNC_COOLDOWN_MS, createWebdavSyncRateLimitController } from './sync-rate-limit';

describe('createWebdavSyncRateLimitController', () => {
    it('fails WebDAV attempts fast with a 429 until the cooldown ends', () => {
        let nowMs = 5_000;
        const controller = createWebdavSyncRateLimitController({ now: () => nowMs });

        expect(controller.noteError('webdav', { status: 503 })).toBe(true);
        expect(controller.getBlockedUntil()).toBe(5_000 + WEBDAV_SYNC_COOLDOWN_MS);

        nowMs += 1_000;
        let thrown: unknown;
        try {
            controller.assertReady('webdav');
        } catch (error) {
            thrown = error;
        }
        expect((thrown as { status?: number }).status).toBe(429);
        expect((thrown as Error).message).toBe(`WebDAV rate limited for ${WEBDAV_SYNC_COOLDOWN_MS - 1_000}ms`);
        expect(() => controller.assertReady('file')).not.toThrow();

        nowMs = 5_000 + WEBDAV_SYNC_COOLDOWN_MS;
        expect(() => controller.assertReady('webdav')).not.toThrow();
        expect(controller.getBlockedUntil()).toBe(0);
    });

    it('recognizes a rate-limit message, ignores other errors and other backends, and resets', () => {
        const controller = createWebdavSyncRateLimitController({ now: () => 0, cooldownMs: 10 });

        expect(controller.noteError('cloud', { status: 429 })).toBe(false);
        expect(controller.noteError('webdav', new Error('HTTP 500'))).toBe(false);
        expect(controller.getBlockedUntil()).toBe(0);

        expect(controller.noteError('webdav', new Error('Too Many Requests'))).toBe(true);
        expect(controller.getBlockedUntil()).toBe(10);
        controller.reset();
        expect(controller.getBlockedUntil()).toBe(0);
        expect(() => controller.assertReady('webdav')).not.toThrow();
    });
});
