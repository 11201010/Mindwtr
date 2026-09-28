import { describe, expect, it, vi } from 'vitest';

import {
    createSecureSyncConfigStore,
    createSyncSecretVault,
    isSecretConfigKey,
    type SyncSecretAccessibility,
} from './sync-secret-storage';
import {
    CLOUD_TOKEN_KEY,
    SYNC_ENCRYPTION_KEY_KEY,
    WEBDAV_PASSWORD_KEY,
    WEBDAV_URL_KEY,
} from './sync-storage-keys';

const createPorts = (options: { available?: boolean } = {}) => {
    const plain = new Map<string, string>();
    const secure = new Map<string, { value: string; accessibility: SyncSecretAccessibility }>();
    const control = { available: options.available ?? true, probeFailures: 0, failSecureWrites: false };
    const storage = {
        getItem: vi.fn(async (key: string) => plain.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: string) => {
            plain.set(key, value);
        }),
        removeItem: vi.fn(async (key: string) => {
            plain.delete(key);
        }),
    };
    const secrets = {
        isAvailable: vi.fn(async () => {
            if (control.probeFailures > 0) {
                control.probeFailures -= 1;
                throw new Error('keystore probe failed');
            }
            return control.available;
        }),
        getItem: vi.fn(async (key: string) => secure.get(key)?.value ?? null),
        setItem: vi.fn(async (key: string, value: string, accessibility: SyncSecretAccessibility) => {
            if (control.failSecureWrites) throw new Error('keystore unavailable');
            secure.set(key, { value, accessibility });
        }),
        deleteItem: vi.fn(async (key: string) => {
            secure.delete(key);
        }),
    };
    const vault = createSyncSecretVault(secrets);
    const config = createSecureSyncConfigStore({ storage, secrets, vault });
    return { plain, secure, control, storage, secrets, vault, config };
};

describe('isSecretConfigKey', () => {
    it('names the WebDAV password, the cloud token and the encryption key only', () => {
        expect(isSecretConfigKey(WEBDAV_PASSWORD_KEY)).toBe(true);
        expect(isSecretConfigKey(CLOUD_TOKEN_KEY)).toBe(true);
        expect(isSecretConfigKey(SYNC_ENCRYPTION_KEY_KEY)).toBe(true);
        expect(isSecretConfigKey(WEBDAV_URL_KEY)).toBe(false);
    });
});

describe('createSyncSecretVault', () => {
    it('caches a successful availability probe but retries a rejected one', async () => {
        const { control, secrets, vault } = createPorts();
        control.probeFailures = 1;

        await expect(vault.isSecureStoreAvailable()).rejects.toThrow('keystore probe failed');
        await expect(vault.isSecureStoreAvailable()).resolves.toBe(true);
        await expect(vault.isSecureStoreAvailable()).resolves.toBe(true);
        expect(secrets.isAvailable).toHaveBeenCalledTimes(2);

        vault.reset();
        await vault.isSecureStoreAvailable();
        expect(secrets.isAvailable).toHaveBeenCalledTimes(3);
    });

    it('drops the in-memory copy when the legacy plaintext cannot be removed', async () => {
        const { vault } = createPorts();

        await expect(vault.evacuateLegacySecretToSession('k', 'v', async () => {
            throw new Error('remove failed');
        })).rejects.toThrow('remove failed');
        expect(vault.getSessionSecret('k')).toBeNull();

        await vault.evacuateLegacySecretToSession('k', 'v', async () => undefined);
        expect(vault.getSessionSecret('k')).toBe('v');
    });
});

describe('createSecureSyncConfigStore', () => {
    it('writes to the keystore after-first-unlock under the key without its @ prefix', async () => {
        const { plain, secure, config } = createPorts();
        plain.set(CLOUD_TOKEN_KEY, 'old-plaintext');

        await config.setSecureConfigValue(CLOUD_TOKEN_KEY, 'fresh-token');

        expect(secure.get('mindwtr_cloud_token')).toEqual({ value: 'fresh-token', accessibility: 'after-first-unlock' });
        expect(plain.has(CLOUD_TOKEN_KEY)).toBe(false);
    });

    it('reads the keystore first, scrubbing any plaintext copy', async () => {
        const { plain, secure, config } = createPorts();
        secure.set('mindwtr_webdav_password', { value: 'secure-pass', accessibility: 'after-first-unlock' });
        plain.set(WEBDAV_PASSWORD_KEY, 'stale-plaintext');

        await expect(config.getSecureConfigValue(WEBDAV_PASSWORD_KEY)).resolves.toBe('secure-pass');
        expect(plain.has(WEBDAV_PASSWORD_KEY)).toBe(false);
    });

    it('migrates legacy plaintext into the keystore, and keeps it when the keystore write fails', async () => {
        const { plain, secure, control, config } = createPorts();
        plain.set(CLOUD_TOKEN_KEY, 'legacy-token');
        control.failSecureWrites = true;

        await expect(config.getSecureConfigValue(CLOUD_TOKEN_KEY)).rejects.toThrow('keystore unavailable');
        expect(plain.get(CLOUD_TOKEN_KEY)).toBe('legacy-token');

        control.failSecureWrites = false;
        await expect(config.getSecureConfigValue(CLOUD_TOKEN_KEY)).resolves.toBe('legacy-token');
        expect(secure.get('mindwtr_cloud_token')?.value).toBe('legacy-token');
        expect(plain.has(CLOUD_TOKEN_KEY)).toBe(false);
    });

    it('never writes plaintext when the keystore is unsupported: secrets live in memory only', async () => {
        const { plain, secure, storage, config } = createPorts({ available: false });

        await config.setSecureConfigValue(CLOUD_TOKEN_KEY, 'session-token');
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(secure.size).toBe(0);
        await expect(config.getSecureConfigValue(CLOUD_TOKEN_KEY)).resolves.toBe('session-token');

        plain.set(WEBDAV_PASSWORD_KEY, 'legacy-pass');
        await expect(config.getSecureConfigValue(WEBDAV_PASSWORD_KEY)).resolves.toBe('legacy-pass');
        expect(plain.has(WEBDAV_PASSWORD_KEY)).toBe(false);
        await expect(config.getSecureConfigValue(WEBDAV_PASSWORD_KEY)).resolves.toBe('legacy-pass');

        await config.deleteSecureConfigValue(WEBDAV_PASSWORD_KEY);
        await expect(config.getSecureConfigValue(WEBDAV_PASSWORD_KEY)).resolves.toBeNull();
    });

    it('deletes from both stores', async () => {
        const { plain, secure, config } = createPorts();
        secure.set('mindwtr_webdav_password', { value: 'secure-pass', accessibility: 'after-first-unlock' });
        plain.set(WEBDAV_PASSWORD_KEY, 'stale-plaintext');

        await config.deleteSecureConfigValue(WEBDAV_PASSWORD_KEY);

        expect(secure.has('mindwtr_webdav_password')).toBe(false);
        expect(plain.has(WEBDAV_PASSWORD_KEY)).toBe(false);
    });
});
