import { afterEach, describe, expect, it, vi } from 'vitest';

const getItemMock = vi.fn();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: getItemMock,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('./storage-adapter', () => ({
  mobileStorage: {
    getData: vi.fn(async () => ({ tasks: [], projects: [], sections: [], areas: [], settings: {} })),
    saveData: vi.fn(async () => undefined),
  },
}));

vi.mock('./storage-file', () => ({
  readSyncFile: vi.fn(async () => ({ tasks: [], projects: [], sections: [], areas: [], settings: {} })),
  writeSyncFile: vi.fn(async () => undefined),
}));

vi.mock('./attachment-sync', () => ({
  getBaseSyncUrl: vi.fn(() => ''),
  getCloudBaseUrl: vi.fn(() => ''),
  syncCloudAttachments: vi.fn(async () => false),
  syncFileAttachments: vi.fn(async () => false),
  syncWebdavAttachments: vi.fn(async () => false),
  cleanupAttachmentTempFiles: vi.fn(async () => undefined),
}));

vi.mock('./external-calendar', () => ({
  getExternalCalendars: vi.fn(async () => []),
  saveExternalCalendars: vi.fn(async () => undefined),
}));

vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: vi.fn(() => ({ remove: vi.fn() })),
}));

describe('mobile sync orchestration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    getItemMock.mockReset();
  });

  it('re-runs a queued sync cycle after the in-flight cycle completes', async () => {
    let nowMs = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

    let backendReads = 0;
    getItemMock.mockImplementation(async (key: string) => {
      if (key !== 'mindwtr-sync-backend') return null;
      backendReads += 1;
      if (backendReads === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return 'off';
    });

    const { performMobileSync } = await import('./sync-service');
    const first = performMobileSync();
    const second = performMobileSync();

    nowMs = 86_400_000;
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});
