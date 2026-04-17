import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CLOUD_PROVIDER_KEY,
    CLOUD_TOKEN_KEY,
    CLOUD_URL_KEY,
    SYNC_BACKEND_KEY,
    SYNC_PATH_KEY,
    WEBDAV_PASSWORD_KEY,
    WEBDAV_URL_KEY,
    WEBDAV_USERNAME_KEY,
} from '@/lib/sync-constants';
import { useSyncSettingsTransportActions } from './use-sync-settings-transport-actions';

const mocked = vi.hoisted(() => ({
    addBreadcrumb: vi.fn(),
    asyncStorage: {
        multiGet: vi.fn(),
        multiSet: vi.fn(),
        removeItem: vi.fn(),
        setItem: vi.fn(),
    },
    cloudGetJson: vi.fn(),
    normalizeWebdavUrl: vi.fn((url: string) => {
        const trimmed = url.replace(/\/+$/, '');
        return trimmed.toLowerCase().endsWith('/data.json') || trimmed.toLowerCase().endsWith('.json')
            ? trimmed
            : `${trimmed}/data.json`;
    }),
    resetSyncStatusForBackendSwitch: vi.fn(),
    showSettingsErrorToast: vi.fn(),
    showSettingsWarning: vi.fn(),
    showToast: vi.fn(),
    webdavGetJson: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: mocked.asyncStorage,
}));

vi.mock('@mindwtr/core', () => ({
    addBreadcrumb: mocked.addBreadcrumb,
    CLOCK_SKEW_THRESHOLD_MS: 60_000,
    cloudGetJson: mocked.cloudGetJson,
    normalizeWebdavUrl: mocked.normalizeWebdavUrl,
    webdavGetJson: mocked.webdavGetJson,
}));

vi.mock('@/lib/storage-file', () => ({
    pickAndParseSyncFolder: vi.fn(),
}));

vi.mock('@/lib/cloudkit-sync', () => ({
    getCloudKitAccountStatus: vi.fn().mockResolvedValue('available'),
}));

vi.mock('@/lib/dropbox-oauth', () => ({
    authorizeDropbox: vi.fn(),
    getDropboxRedirectUri: vi.fn(() => 'mindwtr://dropbox'),
}));

vi.mock('@/lib/dropbox-auth', () => ({
    disconnectDropbox: vi.fn(),
    forceRefreshDropboxAccessToken: vi.fn(),
    getValidDropboxAccessToken: vi.fn(),
    isDropboxConnected: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/sync-service', () => ({
    performMobileSync: vi.fn(),
}));

vi.mock('@/lib/sync-service-utils', () => ({
    coerceSupportedBackend: (backend: string, supportsNativeICloudSync: boolean) => (
        backend === 'cloudkit' && !supportsNativeICloudSync ? 'off' : backend
    ),
    getSyncConflictCount: vi.fn(() => 0),
    getSyncMaxClockSkewMs: vi.fn(() => 0),
    getSyncTimestampAdjustments: vi.fn(() => 0),
    hasSameUserFacingSyncConflictSummary: vi.fn(() => false),
    isLikelyOfflineSyncError: vi.fn(() => false),
}));

vi.mock('@/lib/dropbox-sync', () => ({
    testDropboxAccess: vi.fn(),
}));

vi.mock('@/lib/settings-utils', () => ({
    formatClockSkew: vi.fn((value: number) => `${value} ms`),
    formatError: vi.fn((error: unknown) => String(error)),
    isDropboxUnauthorizedError: vi.fn(() => false),
    logSettingsError: vi.fn(),
}));

let latestHookResult: ReturnType<typeof useSyncSettingsTransportActions> | null = null;
let tree: ReactTestRenderer | null = null;

type HarnessProps = {
    dropboxConfigured?: boolean;
    supportsNativeICloudSync?: boolean;
};

function Harness({
    dropboxConfigured = false,
    supportsNativeICloudSync = false,
}: HarnessProps) {
    latestHookResult = useSyncSettingsTransportActions({
        dropboxAppKey: 'dropbox-app-key',
        dropboxConfigured,
        getCloudKitStatusDetails: (status) => ({
            helpText: status,
            syncEnabled: status === 'available' || status === 'unknown',
        }),
        getSyncFailureToastMessage: () => 'Retry sync later.',
        isExpoGo: false,
        isFossBuild: false,
        lastSyncStats: null,
        lastSyncStatus: 'idle',
        localize: (english) => english,
        resetSyncStatusForBackendSwitch: mocked.resetSyncStatusForBackendSwitch,
        showSettingsErrorToast: mocked.showSettingsErrorToast,
        showSettingsWarning: mocked.showSettingsWarning,
        showToast: mocked.showToast,
        supportsNativeICloudSync,
        t: (key: string) => key,
    });
    return null;
}

const renderHarness = async (props?: HarnessProps) => {
    await act(async () => {
        tree = create(<Harness {...props} />);
        await Promise.resolve();
    });
};

beforeEach(() => {
    latestHookResult = null;
    mocked.asyncStorage.multiGet.mockReset();
    mocked.asyncStorage.multiSet.mockReset();
    mocked.asyncStorage.removeItem.mockReset();
    mocked.asyncStorage.setItem.mockReset();
    mocked.asyncStorage.multiGet.mockResolvedValue([]);
    mocked.asyncStorage.multiSet.mockResolvedValue(undefined);
    mocked.asyncStorage.removeItem.mockResolvedValue(undefined);
    mocked.asyncStorage.setItem.mockResolvedValue(undefined);
    mocked.addBreadcrumb.mockReset();
    mocked.cloudGetJson.mockReset();
    mocked.normalizeWebdavUrl.mockClear();
    mocked.resetSyncStatusForBackendSwitch.mockReset();
    mocked.showSettingsErrorToast.mockReset();
    mocked.showSettingsWarning.mockReset();
    mocked.showToast.mockReset();
    mocked.webdavGetJson.mockReset();
});

afterEach(() => {
    if (tree) {
        act(() => {
            tree?.unmount();
        });
    }
    tree = null;
});

describe('useSyncSettingsTransportActions', () => {
    it('loads persisted transport state inside the hook and coerces unsupported CloudKit state', async () => {
        mocked.asyncStorage.multiGet.mockResolvedValue([
            [SYNC_PATH_KEY, 'file:///sync-folder/data.json'],
            [SYNC_BACKEND_KEY, 'cloudkit'],
            [WEBDAV_URL_KEY, 'https://dav.example.com'],
            [WEBDAV_USERNAME_KEY, 'alice'],
            [WEBDAV_PASSWORD_KEY, 'secret'],
            [CLOUD_URL_KEY, 'https://cloud.example.com'],
            [CLOUD_TOKEN_KEY, 'token-123'],
            [CLOUD_PROVIDER_KEY, 'cloudkit'],
        ]);

        await renderHarness({ supportsNativeICloudSync: false });

        expect(latestHookResult?.syncPath).toBe('file:///sync-folder/data.json');
        expect(latestHookResult?.syncBackend).toBe('off');
        expect(latestHookResult?.cloudProvider).toBe('selfhosted');
        expect(latestHookResult?.webdavUrl).toBe('https://dav.example.com');
        expect(latestHookResult?.webdavUsername).toBe('alice');
        expect(latestHookResult?.webdavPassword).toBe('secret');
        expect(latestHookResult?.cloudUrl).toBe('https://cloud.example.com');
        expect(latestHookResult?.cloudToken).toBe('token-123');
        expect(mocked.asyncStorage.setItem).toHaveBeenCalledWith(SYNC_BACKEND_KEY, 'off');
        expect(mocked.asyncStorage.setItem).toHaveBeenCalledWith(CLOUD_PROVIDER_KEY, 'selfhosted');
    });

    it('updates hook-owned state when selecting a cloud provider and backend', async () => {
        await renderHarness({ supportsNativeICloudSync: true });

        mocked.asyncStorage.multiSet.mockClear();
        mocked.asyncStorage.setItem.mockClear();
        mocked.addBreadcrumb.mockClear();
        mocked.resetSyncStatusForBackendSwitch.mockClear();

        await act(async () => {
            latestHookResult?.handleSelectCloudProvider('cloudkit');
        });

        expect(latestHookResult?.cloudProvider).toBe('cloudkit');
        expect(latestHookResult?.syncBackend).toBe('cloudkit');
        expect(mocked.asyncStorage.multiSet).toHaveBeenCalledWith([
            [CLOUD_PROVIDER_KEY, 'cloudkit'],
            [SYNC_BACKEND_KEY, 'cloudkit'],
        ]);

        await act(async () => {
            latestHookResult?.handleSelectSyncBackend('cloud');
        });

        expect(latestHookResult?.syncBackend).toBe('cloudkit');
        expect(mocked.asyncStorage.setItem).toHaveBeenCalledWith(SYNC_BACKEND_KEY, 'cloudkit');
        expect(mocked.addBreadcrumb).toHaveBeenCalledWith('settings:syncBackend:cloudkit');
        expect(mocked.resetSyncStatusForBackendSwitch).toHaveBeenCalledTimes(2);
    });

    it('normalizes the WebDAV url before testing the mobile connection', async () => {
        mocked.webdavGetJson.mockResolvedValue(null);
        await renderHarness();

        await act(async () => {
            await latestHookResult?.handleTestConnection('webdav', {
                webdav: {
                    password: 'secret',
                    url: 'http://nas.local/remote.php/dav/files/alice/mindwtr/',
                    username: 'alice',
                },
            });
        });

        expect(mocked.normalizeWebdavUrl).toHaveBeenCalledWith('http://nas.local/remote.php/dav/files/alice/mindwtr/');
        expect(mocked.webdavGetJson).toHaveBeenCalledWith(
            'http://nas.local/remote.php/dav/files/alice/mindwtr/data.json',
            expect.objectContaining({
                allowInsecureHttp: true,
                password: 'secret',
                timeoutMs: 10_000,
                username: 'alice',
            }),
        );
        expect(mocked.showToast).toHaveBeenCalledWith(expect.objectContaining({
            message: 'WebDAV endpoint is reachable.',
            title: 'Connection OK',
            tone: 'success',
        }));
    });
});
