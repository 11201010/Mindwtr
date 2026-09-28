import * as SecureStore from 'expo-secure-store';
import {
    createSyncSecretVault,
    type SyncSecretStoragePort,
    type SyncSecretVault,
} from '@mindwtr/core/sync-secret-storage';

/** expo-secure-store as core's keystore port. The accessibility class is read at write time:
 *  a caller only ever needs the one it writes with. */
export const secureSecretStorage: SyncSecretStoragePort = {
    isAvailable: () => SecureStore.isAvailableAsync(),
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value, accessibility) => SecureStore.setItemAsync(key, value, {
        keychainAccessible: accessibility === 'after-first-unlock'
            ? SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
            : SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
    deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

/** One vault per process, shared by secure-config, dropbox-auth and ai-config. */
export const secureSecretVault: SyncSecretVault = createSyncSecretVault(secureSecretStorage);

export const isSecureStoreAvailable = (): Promise<boolean> => secureSecretVault.isSecureStoreAvailable();

export const getSessionSecret = (key: string): string | null => secureSecretVault.getSessionSecret(key);

export const setSessionSecret = (key: string, value: string): void => {
    secureSecretVault.setSessionSecret(key, value);
};

export const deleteSessionSecret = (key: string): void => {
    secureSecretVault.deleteSessionSecret(key);
};

export const evacuateLegacySecretToSession = (
    key: string,
    value: string,
    removeLegacy: () => Promise<void>,
): Promise<void> => secureSecretVault.evacuateLegacySecretToSession(key, value, removeLegacy);

export const __resetSecureSecretStoreForTests = (): void => {
    secureSecretVault.reset();
};
