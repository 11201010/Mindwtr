import { describe, expect, it, vi } from 'vitest';

import { createMobileSyncService, type MobileSyncServiceHost } from './mobile-sync-service';
import { createSyncEncryptionStateStore } from './sync-encryption-local-state';
import { createWebdavCapabilityProofStore } from './webdav-capability-proof';
import { SYNC_BACKEND_KEY, WEBDAV_PASSWORD_KEY, WEBDAV_URL_KEY, WEBDAV_USERNAME_KEY, CLOUD_PROVIDER_KEY } from './sync-storage-keys';
import type { AppData } from './types';

const emptyData = (): AppData => ({
  tasks: [],
  projects: [],
  sections: [],
  areas: [],
  people: [],
  settings: {},
} as AppData);

const emptyStats = {
  tasks: { mergedTotal: 0, conflicts: 0, conflictIds: [], maxClockSkewMs: 0, timestampAdjustments: 0 },
  projects: { mergedTotal: 0, conflicts: 0, conflictIds: [], maxClockSkewMs: 0, timestampAdjustments: 0 },
  sections: { mergedTotal: 0, conflicts: 0, conflictIds: [], maxClockSkewMs: 0, timestampAdjustments: 0 },
  areas: { mergedTotal: 0, conflicts: 0, conflictIds: [], maxClockSkewMs: 0, timestampAdjustments: 0 },
};

type FakeOptions = {
  values?: Record<string, string>;
  secrets?: Record<string, string>;
  offline?: boolean;
  isFossBuild?: boolean;
  dropboxAppKey?: string;
};

/** A host whose storage, network, store and transports are all in memory. The cycle's merge
 *  (`performSyncCycle`) is a stand-in: read local, read remote, keep the remote, stamp the
 *  status, write both. */
const createFakeHost = (options: FakeOptions = {}) => {
  const values = new Map(Object.entries(options.values ?? {}));
  const secrets = new Map(Object.entries(options.secrets ?? {}));
  const storage = {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  };
  const logs: Array<{ level: string; message: string; extra?: Record<string, string> }> = [];
  const store = {
    lastDataChangeAt: 1,
    settings: {} as AppData['settings'],
    setError: vi.fn(),
    fetchData: vi.fn(async () => undefined),
  };
  const remote = { data: null as AppData | null, etag: 0 };
  const fenceOwners: string[] = [];
  const saved: AppData[] = [];
  const encryption = createSyncEncryptionStateStore({
    storage,
    secureConfig: {
      getSecureConfigValue: async (key) => secrets.get(key) ?? null,
      setSecureConfigValue: async (key, value) => { secrets.set(key, value); },
      deleteSecureConfigValue: async (key) => { secrets.delete(key); },
    },
    readActiveScope: async () => null,
    log: { info: () => undefined, warn: () => undefined },
  });
  const proof = createWebdavCapabilityProofStore(storage);
  const lease = { token: 'lease' };
  const host: MobileSyncServiceHost<typeof lease> = {
    storage,
    getSecureConfigValue: async (key) => secrets.get(key) ?? null,
    platform: {
      os: () => 'android',
      isFossBuild: options.isFossBuild === true,
      dropboxAppKey: () => options.dropboxAppKey ?? '',
    },
    network: {
      getState: async () => (options.offline
        ? { isConnected: false, isInternetReachable: false, isAirplaneModeEnabled: false }
        : { isConnected: true, isInternetReachable: true, isAirplaneModeEnabled: false }),
      subscribe: () => ({ remove: () => undefined }),
    },
    localData: {
      getData: async () => emptyData(),
      saveData: async (data) => { saved.push(data); },
    },
    log: {
      info: (message, context) => { logs.push({ level: 'info', message, extra: context?.extra }); },
      warn: (message, context) => { logs.push({ level: 'warn', message, extra: context?.extra }); },
      syncError: async () => null,
      sanitize: (message) => message,
    },
    externalCalendars: { load: async () => [], save: async () => undefined },
    fetch: vi.fn(async () => { throw new Error('no network in tests'); }) as unknown as typeof fetch,
    crypto: {} as MobileSyncServiceHost<unknown>['crypto'],
    encryption,
    ensureWebdavCapabilityProof: (config, probe, proofOptions) => proof.ensureWebdavCapabilityProof(config, probe, proofOptions),
    dropboxAuth: {
      isConnected: async () => true,
      getValidAccessToken: async () => 'token',
      forceRefreshAccessToken: async () => 'token',
      getValidAccessTokenForTokens: async (_clientId, tokens) => ({ accessToken: 'token', tokens }),
      forceRefreshAccessTokenForTokens: async (_clientId, tokens) => ({ accessToken: 'token', tokens }),
    },
    fileSync: {
      readVersioned: async () => ({ data: emptyData(), fingerprint: 'file:v1:absent', needsRepair: true }),
      write: async () => undefined,
      resolveUri: async (uri) => uri,
      isBookmarksAvailable: () => false,
      resolveBookmark: async () => null,
      acquireLease: async () => lease,
      revalidateLease: async () => undefined,
      releaseLease: async () => undefined,
    },
    attachments: {
      syncWebdav: async () => false,
      syncCloud: async () => false,
      syncDropbox: async () => false,
      syncFile: async () => false,
      cleanupTempFiles: async () => undefined,
      hasCompletedPresenceReconciliation: async () => false,
      hasPendingWork: async () => false,
      runCleanup: async ({ appData }) => ({ appData, shouldInvalidateFastSyncState: false }),
    },
    core: {
      useTaskStore: {
        getState: () => store as never,
        setState: vi.fn(),
      },
      flushPendingSave: async () => undefined,
      getInMemoryAppDataSnapshot: () => emptyData(),
      isSandboxMode: () => false,
      isWorkspaceTransitionActive: () => false,
      performSyncCycle: vi.fn(async (io) => {
        const local = await io.readLocal();
        const remoteData = await io.readRemote();
        const merged = remoteData ?? local;
        const data = { ...merged, settings: { ...merged.settings, lastSyncStatus: 'success' as const, lastSyncAt: '2026-09-28T12:00:00.000Z' } };
        await io.writeLocal(data);
        await io.writeRemote(data);
        return { status: 'success', stats: emptyStats, data } as never;
      }),
      withRetry: async (operation) => operation(),
      probeWebdavSyncCompatibility: vi.fn(async () => 'strong-etag' as const),
      webdavGetSyncDocument: vi.fn(async () => ({
        state: 'data' as const,
        data: remote.data,
        exists: remote.data !== null,
        strongEtag: remote.data !== null ? `"${remote.etag}"` : null,
      })) as never,
      webdavPutSyncDocument: vi.fn(async (_url: string, data: AppData) => {
        remote.data = data;
        remote.etag += 1;
        return { etag: `"${remote.etag}"` };
      }) as never,
      webdavHeadFile: vi.fn(async () => ({ exists: remote.data !== null, fingerprint: `webdav:v1:etag="${remote.etag}"`, etag: `"${remote.etag}"` })) as never,
      acquireSyncRemoteMutationFence: vi.fn(async (_port, fenceOptions) => {
        fenceOwners.push(fenceOptions.ownerId);
        return { assertHeld: async () => undefined, renew: async () => undefined, release: async () => undefined } as never;
      }),
      createWebdavSyncRemoteMutationFencePort: vi.fn(() => ({}) as never),
      createDropboxSyncRemoteMutationFencePort: vi.fn(() => ({}) as never),
    },
  };
  return { host, values, logs, store, remote, fenceOwners, saved };
};

const WEBDAV_VALUES = {
  [SYNC_BACKEND_KEY]: 'webdav',
  [WEBDAV_URL_KEY]: 'https://dav.example.com/Mindwtr',
  [WEBDAV_USERNAME_KEY]: 'alex',
};

describe('mobile sync service behind fake ports', () => {
  it('reports each backend configuration from the stored keys', async () => {
    const off = createMobileSyncService(createFakeHost().host);
    await expect(off.getMobileSyncConfigurationStatus()).resolves.toEqual({ backend: 'off', configured: false });

    const webdav = createMobileSyncService(createFakeHost({ values: WEBDAV_VALUES }).host);
    await expect(webdav.getMobileSyncConfigurationStatus()).resolves.toEqual({ backend: 'webdav', configured: true });

    // FOSS builds never offer Dropbox, even with a key and saved tokens.
    const foss = createMobileSyncService(createFakeHost({
      values: { [SYNC_BACKEND_KEY]: 'cloud', [CLOUD_PROVIDER_KEY]: 'dropbox' },
      isFossBuild: true,
      dropboxAppKey: 'key',
    }).host);
    await expect(foss.getMobileSyncConfigurationStatus()).resolves.toMatchObject({ backend: 'cloud', configured: false });

    // CloudKit is iOS only: a host without it reads the stored backend as off.
    const cloudkit = createMobileSyncService(createFakeHost({ values: { [SYNC_BACKEND_KEY]: 'cloudkit' } }).host);
    await expect(cloudkit.getMobileSyncConfigurationStatus()).resolves.toEqual({ backend: 'off', configured: false });
  });

  it('runs a WebDAV cycle under the mindwtr-mobile fence and publishes the status', async () => {
    const fake = createFakeHost({ values: WEBDAV_VALUES, secrets: { [WEBDAV_PASSWORD_KEY]: 'secret' } });
    const service = createMobileSyncService(fake.host);
    const activity: string[] = [];
    service.subscribeMobileSyncActivityState((state) => activity.push(state));

    const result = await service.performMobileSync(undefined, { manual: true });

    expect(result).toMatchObject({ success: true });
    // Every device on this backend shares the owner id: a new id would wait out the old lease.
    expect(fake.fenceOwners).toEqual(['mindwtr-mobile']);
    const putUrl = vi.mocked(fake.host.core!.webdavPutSyncDocument!).mock.calls[0]?.[0];
    expect(putUrl).toBe('https://dav.example.com/Mindwtr/data.json');
    expect(fake.remote.data).not.toBeNull();
    expect(fake.saved.length).toBeGreaterThan(0);
    expect(fake.values.get('@mindwtr_local_sync_status_v1')).toContain('"lastSyncStatus":"success"');
    expect(activity).toEqual(['idle', 'syncing', 'idle']);
  });

  it('reads the password through the keystore, not the plain key-value store', async () => {
    const fake = createFakeHost({ values: WEBDAV_VALUES, secrets: { [WEBDAV_PASSWORD_KEY]: 'secret' } });
    const service = createMobileSyncService(fake.host);

    await service.performMobileSync(undefined, { manual: true });

    expect(fake.host.storage.getItem).not.toHaveBeenCalledWith(WEBDAV_PASSWORD_KEY);
    const probeOptions = vi.mocked(fake.host.core!.probeWebdavSyncCompatibility!).mock.calls[0]?.[1];
    expect(probeOptions).toMatchObject({ username: 'alex', password: 'secret', timeoutMs: 30_000 });
  });

  it('skips a remote backend while the device is offline, without starting a cycle', async () => {
    const fake = createFakeHost({ values: WEBDAV_VALUES, offline: true });
    const service = createMobileSyncService(fake.host);

    await expect(service.performMobileSync()).resolves.toEqual({ success: true, skipped: 'offline', offlineCause: 'network' });
    expect(fake.host.core!.performSyncCycle).not.toHaveBeenCalled();
  });

  it('never saves a candidate configuration during its activation probe', async () => {
    const fake = createFakeHost({ values: { [SYNC_BACKEND_KEY]: 'off' } });
    const service = createMobileSyncService(fake.host);

    const result = await service.performMobileSync(undefined, {
      activationProbe: true,
      configOverride: {
        backend: 'webdav',
        webdav: { url: 'https://candidate.example.com/dav', username: 'bea', password: 'pw' },
      },
    });

    expect(result).toMatchObject({ success: true });
    expect(vi.mocked(fake.host.core!.webdavPutSyncDocument!).mock.calls[0]?.[0]).toBe('https://candidate.example.com/dav/data.json');
    // The settings transaction saves the configuration after the proof; the probe never does.
    const writtenKeys = fake.host.storage.setItem.mock.calls.map(([key]) => key);
    expect(writtenKeys).not.toContain(SYNC_BACKEND_KEY);
    expect(writtenKeys).not.toContain(WEBDAV_URL_KEY);
    expect(fake.values.get(SYNC_BACKEND_KEY)).toBe('off');
  });

  it('refuses a Dropbox candidate in a FOSS build', async () => {
    const fake = createFakeHost({ isFossBuild: true, dropboxAppKey: 'key' });
    const service = createMobileSyncService(fake.host);

    const result = await service.performMobileSync(undefined, {
      manual: true,
      configOverride: { backend: 'cloud', cloudProvider: 'dropbox' },
    });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Dropbox sync is unavailable in this build') });
  });

  it('returns requeued for a settings proof that arrives while a cycle runs', async () => {
    const fake = createFakeHost({ values: WEBDAV_VALUES });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const performSyncCycle = vi.mocked(fake.host.core!.performSyncCycle!);
    const original = performSyncCycle.getMockImplementation()!;
    performSyncCycle.mockImplementation(async (io) => {
      await gate;
      return original(io);
    });
    const service = createMobileSyncService(fake.host);

    const active = service.performMobileSync();
    await vi.waitFor(() => expect(performSyncCycle).toHaveBeenCalled());
    const proof = await service.performMobileSync(undefined, {
      configOverride: { backend: 'webdav', webdav: { url: 'https://other.example.com', username: '', password: '' } },
    });

    expect(proof).toEqual({ success: true, skipped: 'requeued' });
    release();
    await active;
  });

  it('treats a lifecycle abort as a success and queues a follow-up', async () => {
    const fake = createFakeHost({ values: WEBDAV_VALUES });
    const service = createMobileSyncService(fake.host);
    const performSyncCycle = vi.mocked(fake.host.core!.performSyncCycle!);
    performSyncCycle.mockImplementationOnce(async () => {
      expect(service.abortMobileSync()).toBe(true);
      throw new Error('aborted');
    });

    const result = await service.performMobileSync();

    expect(result).toEqual({ success: true });
    expect(fake.logs.some((line) => line.message === 'Sync aborted by app lifecycle transition')).toBe(true);
    await service.waitForMobileSyncIdle();
    expect(performSyncCycle).toHaveBeenCalledTimes(2);
  });

  it('does nothing in sandbox mode', async () => {
    const fake = createFakeHost({ values: WEBDAV_VALUES });
    fake.host.core!.isSandboxMode = () => true;
    const service = createMobileSyncService(fake.host);

    await expect(service.performMobileSync()).resolves.toEqual({ success: true, skipped: 'disabled' });
    await expect(service.getMobileSyncConfigurationStatus()).resolves.toEqual({ backend: 'off', configured: false });
    expect(fake.host.storage.getItem).not.toHaveBeenCalled();
  });
});
