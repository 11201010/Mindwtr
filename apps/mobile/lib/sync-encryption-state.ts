// Mobile's binding of core's sync-encryption state store (#1056 phase 2). The store itself —
// the parsed local state, the queued writes, the key cache, material resolution, the block
// and posture rules, and the diagnostics trail — lives in core
// (`packages/core/src/sync-encryption-local-state.ts`) so the native app runs the same code.
// This module binds it to AsyncStorage, the secure-config seam and the app log.
//
// Callers must await `loadSyncEncryptionLocalState()` once per process before using the ports.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createSyncEncryptionStateStore,
    type SyncEncryptionKeyCachePort,
    type SyncEncryptionLocalState,
    type SyncEncryptionLocalStatePort,
    type SyncEncryptionLogEvent,
    type SyncEncryptionStateStore,
    type SyncEncryptionStatus,
    type SyncEncryptionTransitionKind,
    type SyncKeyMaterial,
} from '@mindwtr/core';

import { logInfo, logWarn } from './app-log';
import { readActiveSyncLocationScope } from './sync-location-scope';
import { deleteSecureConfigValue, getSecureConfigValue, setSecureConfigValue } from './secure-config';

export {
    SyncEncryptionKeyMissingError,
    SyncEncryptionNoKeyError,
    SyncEncryptionStateUnavailableError,
} from '@mindwtr/core';

// Created on first use: tests that replace @mindwtr/core as a whole still import this module.
let store: SyncEncryptionStateStore | null = null;
const stateStore = (): SyncEncryptionStateStore => {
    store ??= createSyncEncryptionStateStore({
        storage: {
            getItem: (key) => AsyncStorage.getItem(key),
            setItem: (key, value) => AsyncStorage.setItem(key, value),
            removeItem: (key) => AsyncStorage.removeItem(key),
        },
        secureConfig: {
            getSecureConfigValue: (key) => getSecureConfigValue(key),
            setSecureConfigValue: (key, value) => setSecureConfigValue(key, value),
            deleteSecureConfigValue: (key) => deleteSecureConfigValue(key),
        },
        readActiveScope: () => readActiveSyncLocationScope(),
        log: {
            info: (message, context) => logInfo(message, context),
            warn: (message, context) => logWarn(message, context),
        },
    });
    return store;
};

export const loadSyncEncryptionLocalState = (): Promise<SyncEncryptionLocalState | null> =>
    stateStore().loadSyncEncryptionLocalState();

/** Re-read the device-local sidecar after a compensated write failed. Recovery code must
 * not make its next key decision from the optimistic cache: `write()` updates that cache
 * before AsyncStorage acknowledges the durable value and restores it only after rejection. */
export const reloadSyncEncryptionLocalStateForRecovery = (): Promise<SyncEncryptionLocalState | null> =>
    stateStore().reloadSyncEncryptionLocalStateForRecovery();

export const flushSyncEncryptionLocalState = (): Promise<void> => stateStore().flushSyncEncryptionLocalState();

export const syncEncryptionLocalState: SyncEncryptionLocalStatePort = {
    read: () => stateStore().syncEncryptionLocalState.read(),
    write: (state) => stateStore().syncEncryptionLocalState.write(state),
};

export const syncEncryptionKeyCache: SyncEncryptionKeyCachePort = {
    getKey: () => stateStore().syncEncryptionKeyCache.getKey(),
    setKey: (key) => stateStore().syncEncryptionKeyCache.setKey(key),
    clearKey: () => stateStore().syncEncryptionKeyCache.clearKey(),
};

/** The key material this device should encrypt/decrypt sync artifacts with, or `null` when
 *  encryption is genuinely off. Throws `SyncEncryptionKeyMissingError` when the state says
 *  `enabled` but the key is gone: that must fail CLOSED, never read as "off". */
export const getSyncEncryptionMaterial = (): Promise<SyncKeyMaterial | null> =>
    stateStore().getSyncEncryptionMaterial();

export const getMobileSyncEncryptionStatus = (): Promise<SyncEncryptionStatus> =>
    stateStore().getSyncEncryptionStatus();

export const getIncompleteSyncEncryptionTransition = (): Promise<SyncEncryptionTransitionKind | null> =>
    stateStore().getIncompleteSyncEncryptionTransition();

/** True when this device must NOT sync against `activeScope` (core's
 *  `isSyncEncryptionStateBlocked` over the persisted state). */
export const isSyncEncryptionBlocked = (activeScope: string | null): Promise<boolean> =>
    stateStore().isSyncEncryptionBlocked(activeScope);

/** True when this cycle does not yet know whether `activeScope`'s encryption posture matches
 *  what this device believes, so the pre-sync attachment phase must defer. */
export const isSyncEncryptionPostureUnestablished = (
    activeScope: string | null,
    hasCompletedCycleAgainstLocation: boolean,
): Promise<boolean> => stateStore().isSyncEncryptionPostureUnestablished(activeScope, hasCompletedCycleAgainstLocation);

/** The one emitter for the `[sync-encryption]` trail on mobile. Returns the queued file write
 *  so a caller that must not race it (Share log) can await it; the promise never rejects. */
export const logSyncEncryptionEvent = (
    event: SyncEncryptionLogEvent,
    extra: Record<string, string>,
    options?: { level?: 'info' | 'warn'; force?: boolean },
): Promise<void> => stateStore().logSyncEncryptionEvent(event, extra, options);

/** The `Encryption` block the Diagnostics screen renders, as `label: value` lines. */
export const getSyncEncryptionDiagnosticsLines = (): Promise<string[]> =>
    stateStore().getSyncEncryptionDiagnosticsLines();

/** Writes the same posture into the log file unconditionally, before Share log opens. */
export const logSyncEncryptionDiagnosticsBlock = (): Promise<void> =>
    stateStore().logSyncEncryptionDiagnosticsBlock();

export const __resetSyncEncryptionStateForTests = (): void => {
    stateStore().reset();
};
