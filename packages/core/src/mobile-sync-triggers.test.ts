import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMobileSyncTriggers,
  getMobileAutoSyncCadence,
  MOBILE_AUTO_SYNC_CADENCE_FILE,
  MOBILE_AUTO_SYNC_CADENCE_OFF,
  MOBILE_AUTO_SYNC_CADENCE_REMOTE,
  type MobileSyncTriggerPorts,
} from './mobile-sync-triggers';

const createPorts = (overrides: Partial<MobileSyncTriggerPorts> = {}) => {
  let fingerprint = 'sync-change:1';
  const ports: MobileSyncTriggerPorts = {
    initialAppState: 'active',
    performSync: vi.fn(async () => ({ success: true } as { success: boolean; error?: string })),
    abortSync: vi.fn(),
    flushPendingSave: vi.fn(async () => undefined),
    reconcileBackgroundSync: vi.fn(),
    readStoredBackend: vi.fn(async () => 'webdav'),
    resolveSupportedBackend: (raw) => raw ?? 'off',
    getSyncChangeFingerprint: () => fingerprint,
    isLikelyOfflineSyncError: (error) => /offline/i.test(error),
    classifySyncFailure: (error) => (/401/.test(error) ? 'auth' : 'unknown'),
    reportError: vi.fn(),
    logWarn: vi.fn(),
    showSyncIssue: vi.fn(),
    ...overrides,
  };
  return { ports, setFingerprint: (next: string) => { fingerprint = next; } };
};

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mobile sync triggers', () => {
  it('paces File Sync slower than a remote backend, and sync off slowest', () => {
    expect(getMobileAutoSyncCadence('file')).toBe(MOBILE_AUTO_SYNC_CADENCE_FILE);
    for (const backend of ['webdav', 'cloud', 'cloudkit']) {
      expect(getMobileAutoSyncCadence(backend)).toBe(MOBILE_AUTO_SYNC_CADENCE_REMOTE);
    }
    expect(getMobileAutoSyncCadence('off')).toBe(MOBILE_AUTO_SYNC_CADENCE_OFF);
    expect(MOBILE_AUTO_SYNC_CADENCE_REMOTE).toEqual({
      minIntervalMs: 5_000,
      debounceFirstChangeMs: 2_000,
      debounceContinuousChangeMs: 5_000,
      foregroundMinIntervalMs: 30_000,
    });
  });

  it('aborts the running cycle and syncs once when the app leaves the foreground', async () => {
    const { ports } = createPorts();
    const triggers = createMobileSyncTriggers(ports);
    triggers.start();
    await flush();

    expect(triggers.handleAppStateChange('background')).toBe('left');
    await flush();

    expect(ports.abortSync).toHaveBeenCalledTimes(1);
    expect(ports.reconcileBackgroundSync).toHaveBeenCalledTimes(2);
    expect(ports.performSync).toHaveBeenCalledTimes(1);
    triggers.dispose();
  });

  it('dedupes a quick background and foreground round trip with an unchanged payload', async () => {
    const { ports } = createPorts();
    const triggers = createMobileSyncTriggers(ports);
    triggers.start();
    await flush();

    triggers.handleAppStateChange('background');
    await flush();
    expect(triggers.handleAppStateChange('active')).toBe('resumed');
    await flush();
    triggers.handleAppStateChange('background');
    await flush();
    triggers.handleAppStateChange('active');
    await flush();

    expect(ports.performSync).toHaveBeenCalledTimes(1);
    triggers.dispose();
  });

  it('syncs on resume only after the foreground interval since the last automatic sync', async () => {
    const { ports } = createPorts({ initialAppState: 'background' });
    const triggers = createMobileSyncTriggers(ports);
    triggers.start();
    await flush();

    expect(triggers.handleAppStateChange('active')).toBe('resumed');
    await flush();
    expect(ports.performSync).toHaveBeenCalledTimes(1);

    triggers.handleAppStateChange('inactive');
    await flush();
    const afterLeave = vi.mocked(ports.performSync).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    triggers.handleAppStateChange('active');
    await flush();
    // Within 30 s of the last automatic sync: no foreground sync.
    expect(ports.performSync).toHaveBeenCalledTimes(afterLeave);
    triggers.dispose();
  });

  it('syncs a data change after the debounce only when the sync payload changed', async () => {
    const fake = createPorts();
    const triggers = createMobileSyncTriggers(fake.ports);
    triggers.start();
    await flush();

    triggers.handleStoreChange({ lastDataChangeAt: 2 }, { lastDataChangeAt: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.ports.performSync).not.toHaveBeenCalled();

    fake.setFingerprint('sync-change:2');
    triggers.handleStoreChange({ lastDataChangeAt: 3 }, { lastDataChangeAt: 2 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.ports.performSync).toHaveBeenCalledTimes(1);
    triggers.dispose();
  });

  it('warns once for a repeated automatic failure and ignores offline failures', async () => {
    const { ports } = createPorts({ performSync: vi.fn(async () => ({ success: false, error: 'HTTP 401' })) });
    const triggers = createMobileSyncTriggers(ports);
    triggers.start();
    await flush();

    triggers.requestSync(0);
    await flush();
    expect(ports.showSyncIssue).toHaveBeenCalledWith('auth');
    expect(ports.logWarn).toHaveBeenCalledWith('Auto-sync failed', { scope: 'sync', extra: { error: 'HTTP 401' } });

    // The cooldown retry fails the same way within ten minutes: no second warning.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ports.performSync).toHaveBeenCalledTimes(2);
    expect(ports.showSyncIssue).toHaveBeenCalledTimes(1);
    triggers.dispose();

    const offline = createPorts({ performSync: vi.fn(async () => ({ success: false, error: 'Network offline' })) });
    const offlineTriggers = createMobileSyncTriggers(offline.ports);
    offlineTriggers.start();
    offlineTriggers.requestSync(0);
    await flush();
    expect(offline.ports.showSyncIssue).not.toHaveBeenCalled();
    offlineTriggers.dispose();
  });

  it('a finished manual sync cancels the automatic retry', async () => {
    const { ports } = createPorts({ performSync: vi.fn(async () => ({ success: false, error: 'HTTP 401' })) });
    const triggers = createMobileSyncTriggers(ports);
    triggers.start();
    triggers.requestSync(0);
    await flush();
    expect(ports.performSync).toHaveBeenCalledTimes(1);

    triggers.handleStoreChange(
      { lastDataChangeAt: 1, settings: { lastSyncStatus: 'success', lastSyncAt: '2026-09-28T12:01:00.000Z' } },
      { lastDataChangeAt: 1, settings: { lastSyncStatus: 'error', lastSyncAt: '2026-09-28T12:00:00.000Z' } },
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(ports.performSync).toHaveBeenCalledTimes(1);
    triggers.dispose();
  });

  it('does nothing after dispose', async () => {
    const { ports } = createPorts();
    const triggers = createMobileSyncTriggers(ports);
    triggers.start();
    triggers.dispose();

    expect(triggers.isRuntimeActive()).toBe(false);
    expect(triggers.handleAppStateChange('background')).toBeNull();
    triggers.requestSync(0);
    triggers.handleCloudKitChange();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ports.performSync).not.toHaveBeenCalled();
    expect(ports.abortSync).not.toHaveBeenCalled();
  });
});
