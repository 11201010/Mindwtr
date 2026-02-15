import { describe, expect, it, vi } from 'vitest';
import {
    cloneAppData,
    createWebdavDownloadBackoff,
    getErrorStatus,
    isWebdavRateLimitedError,
} from './sync-runtime-utils';

describe('sync-runtime-utils', () => {
    it('extracts status code across common error shapes', () => {
        expect(getErrorStatus({ status: 429 })).toBe(429);
        expect(getErrorStatus({ statusCode: 503 })).toBe(503);
        expect(getErrorStatus({ response: { status: 404 } })).toBe(404);
        expect(getErrorStatus(new Error('no status'))).toBeNull();
    });

    it('detects webdav rate limit responses from status and message', () => {
        expect(isWebdavRateLimitedError({ status: 429 })).toBe(true);
        expect(isWebdavRateLimitedError({ statusCode: 503 })).toBe(true);
        expect(isWebdavRateLimitedError(new Error('too many requests from server'))).toBe(true);
        expect(isWebdavRateLimitedError(new Error('permission denied'))).toBe(false);
    });

    it('clones app data snapshots without sharing references', () => {
        const source = {
            tasks: [{ id: 't1', title: 'Task', status: 'inbox', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
            projects: [],
            sections: [],
            areas: [],
            settings: { theme: 'dark' },
        } as any;
        const cloned = cloneAppData(source);
        cloned.tasks[0].title = 'Changed';

        expect(source.tasks[0].title).toBe('Task');
        expect(cloned.tasks[0].title).toBe('Changed');
    });

    it('tracks, prunes, and clears download backoff entries', () => {
        const backoff = createWebdavDownloadBackoff({ missingBackoffMs: 1_000, errorBackoffMs: 2_000 });
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

        backoff.setFromError('a', { status: 404 });
        expect(backoff.getBlockedUntil('a')).toBe(2_000);

        backoff.setFromError('b', { status: 500 });
        expect(backoff.getBlockedUntil('b')).toBe(3_000);

        nowSpy.mockReturnValue(3_001);
        backoff.prune();
        expect(backoff.size()).toBe(0);

        backoff.setFromError('c', { status: 500 });
        backoff.deleteEntry('c');
        expect(backoff.getBlockedUntil('c')).toBeNull();
        backoff.setFromError('c', { status: 500 });
        backoff.clear();
        expect(backoff.size()).toBe(0);

        nowSpy.mockRestore();
    });
});
