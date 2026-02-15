import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFileSyncDir, hashString, normalizeSyncBackend } from './sync-service-utils';
import { SyncService, __syncServiceTestUtils } from './sync-service';

afterEach(async () => {
    __syncServiceTestUtils.resetDependenciesForTests();
    await SyncService.resetForTests();
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
        expect(backendSpy).toHaveBeenCalledTimes(2);
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
});
