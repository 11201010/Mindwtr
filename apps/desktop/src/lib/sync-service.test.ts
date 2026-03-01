import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@mindwtr/core';
import { getFileSyncDir, hashString, normalizeSyncBackend } from './sync-service-utils';
import { SyncService, __syncServiceTestUtils } from './sync-service';

afterEach(async () => {
    __syncServiceTestUtils.resetDependenciesForTests();
    await SyncService.resetForTests();
    localStorage.clear();
    sessionStorage.clear();
});

describe('sync-service test utils', () => {
    it('normalizes known sync backends and defaults unknown values to off', () => {
        expect(normalizeSyncBackend('file')).toBe('file');
        expect(normalizeSyncBackend('webdav')).toBe('webdav');
        expect(normalizeSyncBackend('cloud')).toBe('cloud');
        expect(normalizeSyncBackend('off')).toBe('off');
        expect(normalizeSyncBackend('unknown')).toBe('off');
        expect(normalizeSyncBackend(null)).toBe('off');
    });

    it('extracts base directory for file sync paths', () => {
        expect(getFileSyncDir('/tmp/mindwtr/data.json', 'data.json', 'mindwtr-sync.json')).toBe('/tmp/mindwtr');
        expect(getFileSyncDir('/tmp/mindwtr/mindwtr-sync.json', 'data.json', 'mindwtr-sync.json')).toBe('/tmp/mindwtr');
        expect(getFileSyncDir('/tmp/mindwtr/', 'data.json', 'mindwtr-sync.json')).toBe('/tmp/mindwtr');
        expect(getFileSyncDir('', 'data.json', 'mindwtr-sync.json')).toBe('');
    });

    it('hashes sync payloads with sha256 output', async () => {
        const hash = await hashString('mindwtr');
        expect(hash).toBe('feb7a7b01b1c68e586e77288a4b2598d146ee3696ec7dbfac0074196b8d68c33');
    });

    it('marks attachments unrecoverable when validation failures hit retry cap', () => {
        const attachment: Attachment = {
            id: 'att-1',
            kind: 'file',
            title: 'Design Doc',
            uri: '/tmp/design-doc.pdf',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            localStatus: 'available',
            cloudKey: 'attachments/att-1.pdf',
            fileHash: 'hash-1',
        };

        const first = __syncServiceTestUtils.simulateAttachmentValidationFailure(attachment, 'invalid hash');
        const second = __syncServiceTestUtils.simulateAttachmentValidationFailure(attachment, 'invalid hash');
        const third = __syncServiceTestUtils.simulateAttachmentValidationFailure(attachment, 'invalid hash');

        expect(first.reachedLimit).toBe(false);
        expect(second.reachedLimit).toBe(false);
        expect(third.reachedLimit).toBe(true);
        expect(__syncServiceTestUtils.getAttachmentValidationFailureAttempts(attachment.id)).toBe(0);
        expect(attachment.deletedAt).toBeDefined();
        expect(attachment.localStatus).toBe('missing');
        expect(attachment.cloudKey).toBeUndefined();
        expect(attachment.fileHash).toBeUndefined();
    });
});

describe('SyncService testability hooks', () => {
    it('supports resetting singleton state between tests', async () => {
        (SyncService as any).syncQueued = true;
        (SyncService as any).syncStatus = {
            inFlight: true,
            queued: true,
            step: 'syncing',
            lastResult: 'error',
            lastResultAt: '2025-01-01T00:00:00.000Z',
        };
        (SyncService as any).syncListeners.add(() => {});
        __syncServiceTestUtils.clearWebdavDownloadBackoff();
        (SyncService as any).externalSyncTimer = setTimeout(() => undefined, 1_000);

        await SyncService.resetForTests();

        expect(SyncService.getSyncStatus()).toEqual({
            inFlight: false,
            queued: false,
            step: null,
            lastResult: null,
            lastResultAt: null,
        });
        expect((SyncService as any).syncListeners.size).toBe(0);
        expect((SyncService as any).syncQueued).toBe(false);
        expect((SyncService as any).externalSyncTimer).toBeNull();
    });

    it('allows injecting tauri dependencies for orchestration tests', async () => {
        const invoke = vi.fn(async (command: string) => {
            if (command === 'get_sync_backend') return 'cloud';
            return '';
        });
        __syncServiceTestUtils.setDependenciesForTests({
            isTauriRuntime: () => true,
            invoke: invoke as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
        });
        (SyncService as any).didMigrate = true;

        const backend = await SyncService.getSyncBackend();

        expect(backend).toBe('cloud');
        expect(invoke).toHaveBeenCalledWith('get_sync_backend', undefined);
    });

    it('defaults cloud provider to selfhosted and persists selection', async () => {
        expect(await SyncService.getCloudProvider()).toBe('selfhosted');
        await SyncService.setCloudProvider('dropbox');
        expect(await SyncService.getCloudProvider()).toBe('dropbox');
        await SyncService.setCloudProvider('selfhosted');
        expect(await SyncService.getCloudProvider()).toBe('selfhosted');
    });

    it('treats Dropbox app key as build-time config', async () => {
        const baseline = await SyncService.getDropboxAppKey();
        await SyncService.setDropboxAppKey('abc123');
        expect(await SyncService.getDropboxAppKey()).toBe(baseline);
        await SyncService.setDropboxAppKey('');
        expect(await SyncService.getDropboxAppKey()).toBe(baseline);
    });
});

describe('SyncService orchestration', () => {
    it('re-runs a queued sync cycle after the in-flight sync finishes', async () => {
        const backendSpy = vi.spyOn(SyncService as any, 'getSyncBackend');
        backendSpy
            .mockImplementationOnce(async () => {
                await new Promise((resolve) => setTimeout(resolve, 25));
                return 'off';
            })
            .mockResolvedValue('off');

        const first = SyncService.performSync();
        const second = SyncService.performSync();

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.success).toBe(true);
        expect(secondResult.success).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(backendSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('emits queued status updates while a sync is already in flight', async () => {
        const backendSpy = vi.spyOn(SyncService as any, 'getSyncBackend');
        backendSpy
            .mockImplementationOnce(async () => {
                await new Promise((resolve) => setTimeout(resolve, 25));
                return 'off';
            })
            .mockResolvedValue('off');

        const snapshots: Array<ReturnType<typeof SyncService.getSyncStatus>> = [];
        const unsubscribe = SyncService.subscribeSyncStatus((status) => {
            snapshots.push({ ...status });
        });

        const first = SyncService.performSync();
        const second = SyncService.performSync();
        await Promise.all([first, second]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        unsubscribe();

        expect(snapshots.some((status) => status.inFlight === true)).toBe(true);
        expect(snapshots.some((status) => status.queued === true)).toBe(true);
        expect(SyncService.getSyncStatus()).toMatchObject({
            inFlight: false,
            queued: false,
            lastResult: 'success',
        });
    });

    it('serializes re-entrant sync calls triggered by sync status listeners', async () => {
        let active = 0;
        let maxActive = 0;
        const backendSpy = vi.spyOn(SyncService as any, 'getSyncBackend');
        backendSpy.mockImplementation(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 20));
            active -= 1;
            return 'off';
        });

        let triggered = false;
        const unsubscribe = SyncService.subscribeSyncStatus((status) => {
            if (status.inFlight && !triggered) {
                triggered = true;
                void SyncService.performSync().catch(() => undefined);
            }
        });

        const result = await SyncService.performSync();
        await new Promise((resolve) => setTimeout(resolve, 80));
        unsubscribe();

        expect(result.success).toBe(true);
        expect(maxActive).toBe(1);
        expect(backendSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('runs a queued follow-up sync after an in-flight failure', async () => {
        const backendSpy = vi.spyOn(SyncService as any, 'getSyncBackend');
        backendSpy
            .mockImplementationOnce(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
                throw new Error('temporary backend failure');
            })
            .mockResolvedValue('off');

        const first = SyncService.performSync();
        const second = SyncService.performSync();
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult.success).toBe(false);
        expect(secondResult.success).toBe(false);

        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(backendSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(SyncService.getSyncStatus()).toMatchObject({
            inFlight: false,
            queued: false,
            lastResult: 'success',
        });
    });
});
