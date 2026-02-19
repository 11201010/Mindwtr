import { createWithEqualityFn } from 'zustand/traditional';
export { shallow } from 'zustand/shallow';

import type { AppData } from './types';
import type { StorageAdapter } from './storage';
import { noopStorage } from './storage';
import { logError } from './logger';
import type { TaskStore } from './store-types';
import { sanitizeAppDataForStorage } from './store-helpers';
import { createProjectActions } from './store-projects';
import { createSettingsActions } from './store-settings';
import { createTaskActions } from './store-tasks';

export { applyTaskUpdates } from './store-helpers';

let storage: StorageAdapter = noopStorage;

/**
 * Configure the storage adapter to use for persistence.
 * Must be called before using the store.
 */
export const setStorageAdapter = (adapter: StorageAdapter) => {
    storage = adapter;
};

export const getStorageAdapter = () => storage;

// Save queue helper - coalesces writes while ensuring the latest snapshot is persisted quickly.
type PendingSave = {
    version: number;
    data: AppData;
    onErrorCallbacks: Array<(msg: string) => void>;
};

let pendingSaves: PendingSave[] = [];
let pendingVersion = 0;
let savedVersion = 0;
let saveInFlight: Promise<void> | null = null;

/**
 * Save data with write coalescing.
 * Captures a snapshot immediately and serializes writes to avoid lost updates.
 * @param data Snapshot of data to save (must include ALL items including tombstones)
 * @param onError Callback for save failures
 */
const debouncedSave = (data: AppData, onError?: (msg: string) => void) => {
    pendingVersion += 1;
    pendingSaves.push({
        version: pendingVersion,
        data: sanitizeAppDataForStorage(data),
        onErrorCallbacks: onError ? [onError] : [],
    });
    void flushPendingSave().catch((error) => {
        logError('Failed to flush pending save', { scope: 'store', category: 'storage', error });
        try {
            useTaskStore.getState().setError('Failed to save data');
        } catch {
            // Ignore if store is not initialized yet
        }
    });
};

/**
 * Immediately save any pending debounced data.
 * Call this when the app goes to background or is about to be terminated.
 */
export const flushPendingSave = async (): Promise<void> => {
    while (true) {
        if (saveInFlight) {
            await saveInFlight;
            continue;
        }
        const currentQueue = Array.isArray(pendingSaves) ? pendingSaves : [];
        if (currentQueue.length === 0) return;
        pendingSaves = [];
        const queuedSaves = currentQueue.filter((item): item is PendingSave =>
            !!item &&
            typeof item.version === 'number' &&
            !!item.data &&
            Array.isArray(item.onErrorCallbacks)
        );
        if (queuedSaves.length === 0) continue;
        const latestSave = queuedSaves[queuedSaves.length - 1];
        if (!latestSave || latestSave.version <= savedVersion) continue;
        const targetVersion = latestSave.version;
        const dataToSave = latestSave.data;
        const onErrorCallbacks = queuedSaves
            .flatMap((item) => item.onErrorCallbacks)
            .filter((callback): callback is (msg: string) => void => typeof callback === 'function');
        let saveSucceeded = false;
        saveInFlight = Promise.resolve()
            .then(() => storage.saveData(dataToSave))
            .then(() => {
                savedVersion = targetVersion;
                saveSucceeded = true;
            })
            .catch((e) => {
                logError('Failed to flush pending save', { scope: 'store', category: 'storage', error: e });
                if (onErrorCallbacks.length > 0) {
                    onErrorCallbacks.forEach((callback) => callback('Failed to save data'));
                }
                try {
                    useTaskStore.getState().setError('Failed to save data');
                } catch {
                    // Ignore if store is not initialized yet
                }
            })
            .finally(() => {
                saveInFlight = null;
                if (!saveSucceeded) {
                    const hasNewerQueuedSave = pendingSaves.some((item) => item.version > targetVersion);
                    if (!hasNewerQueuedSave) {
                        pendingSaves.unshift({
                            version: targetVersion,
                            data: dataToSave,
                            onErrorCallbacks: [],
                        });
                    }
                }
            });
        await saveInFlight;
        if (!saveSucceeded) {
            const hasQueuedSaves = pendingSaves.some((item) => item.version > targetVersion);
            if (hasQueuedSaves) continue;
            return;
        }
    }
};

export const useTaskStore = createWithEqualityFn<TaskStore>()((set, get) => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    settings: {},
    isLoading: false,
    error: null,
    editLockCount: 0,
    lastDataChangeAt: 0,
    highlightTaskId: null,
    highlightTaskAt: null,
    // Internal: full data including tombstones
    _allTasks: [],
    _allProjects: [],
    _allSections: [],
    _allAreas: [],
    setError: (error: string | null) => set({ error }),
    lockEditing: () => set((state) => ({ editLockCount: state.editLockCount + 1 })),
    unlockEditing: () => set((state) => ({ editLockCount: Math.max(0, state.editLockCount - 1) })),
    ...createSettingsActions({
        set,
        get,
        debouncedSave,
        flushPendingSave,
        getStorage: () => storage,
    }),
    ...createTaskActions({
        set,
        get,
        debouncedSave,
        getStorage: () => storage,
    }),
    ...createProjectActions({
        set,
        get,
        debouncedSave,
    }),
}));
