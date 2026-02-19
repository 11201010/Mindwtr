/**
 * Watches the local data.json file for external modifications (e.g. from the CLI)
 * and merges them into the running desktop app using the existing mergeAppData infrastructure.
 *
 * This solves the problem where CLI-added tasks get overwritten because the desktop app
 * uses SQLite as its primary store and never re-reads data.json after startup.
 */
import {
    type AppData,
    mergeAppData,
    normalizeAppData,
    getInMemoryAppDataSnapshot,
    useTaskStore,
} from '@mindwtr/core';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';
import { hashString, toStableJson } from './sync-service-utils';
import { logInfo, logWarn } from './app-log';

/** How long to ignore file events after we write data.json ourselves (ms). */
const IGNORE_WINDOW_MS = 2000;
/** Debounce delay before processing an external change (ms). */
const DEBOUNCE_MS = 750;

let unwatchFn: (() => void) | null = null;
let ignoreUntil = 0;
let lastKnownHash = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Call this right before (or right after) the app writes to data.json itself,
 * so the watcher knows to ignore that particular file-change event.
 */
export function markLocalWrite(): void {
    ignoreUntil = Date.now() + IGNORE_WINDOW_MS;
}

/**
 * Start watching data.json for external changes.
 * @param dataPath - absolute path to the data.json file (from get_data_path_cmd)
 */
export async function start(dataPath: string): Promise<void> {
    if (!isTauriRuntime()) return;

    // Don't double-start
    if (unwatchFn) return;

    try {
        const { watch } = await import('@tauri-apps/plugin-fs');
        const unwatch = await watch(dataPath, (event: any) => {
            // The watch callback fires on any FS event for the watched path.
            const paths: string[] = Array.isArray(event?.paths)
                ? event.paths
                : event?.path
                  ? [event.path]
                  : [];
            if (paths.length === 0) return;

            void handleExternalChange();
        });

        // Resolve the unwatch handle (same pattern as SyncService.resolveUnwatch)
        if (typeof unwatch === 'function') {
            unwatchFn = unwatch as () => void;
        } else if (unwatch && typeof (unwatch as any).stop === 'function') {
            unwatchFn = () => (unwatch as any).stop();
        } else if (unwatch && typeof (unwatch as any).unwatch === 'function') {
            unwatchFn = () => (unwatch as any).unwatch();
        }

        logInfo('[local-data-watcher] Started watching ' + dataPath);
    } catch (error) {
        logWarn('[local-data-watcher] Failed to start watcher: ' + String(error));
    }
}

/** Stop watching. Safe to call even if not started. */
export function stop(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (unwatchFn) {
        unwatchFn();
        unwatchFn = null;
        logInfo('[local-data-watcher] Stopped');
    }
}

/**
 * Called when the OS reports a change to data.json.
 * Skips if within the ignore window (our own save), deduplicates via hash,
 * and debounces before merging.
 */
async function handleExternalChange(): Promise<void> {
    // Skip events caused by our own writes
    if (Date.now() < ignoreUntil) return;

    try {
        // Read the file the CLI (or other external tool) wrote
        const rawData = await invoke<AppData>('read_data_json' as any);
        const normalized = normalizeAppData(rawData);

        // Hash to detect actual changes (skip if file content hasn't changed)
        const hash = await hashString(toStableJson(normalized));
        if (hash === lastKnownHash) return;
        lastKnownHash = hash;

        // Debounce — wait a moment in case multiple rapid writes happen
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            void mergeExternalData(normalized);
        }, DEBOUNCE_MS);
    } catch (error) {
        logWarn('[local-data-watcher] Failed to read external change: ' + String(error));
    }
}

/**
 * Merge the externally-modified data.json into the running app's store.
 * This uses the same mergeAppData function that the sync service uses.
 */
async function mergeExternalData(externalData: AppData): Promise<void> {
    try {
        const localSnapshot = getInMemoryAppDataSnapshot();
        const merged = mergeAppData(localSnapshot, externalData);

        // Persist merged result back to SQLite + data.json
        markLocalWrite(); // So we don't re-trigger on our own save
        await invoke('save_data' as any, { data: merged });

        // Refresh the UI store so components re-render with the new data
        await useTaskStore.getState().fetchData({ silent: true });

        logInfo('[local-data-watcher] Merged external data.json changes');
    } catch (error) {
        logWarn('[local-data-watcher] Failed to merge external data: ' + String(error));
    }
}
