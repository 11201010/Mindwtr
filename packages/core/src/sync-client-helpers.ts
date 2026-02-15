import { useTaskStore } from './store';
import { cloneAppData } from './sync-runtime-utils';
import type { AppData } from './types';

export const DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class LocalSyncAbort extends Error {
    constructor() {
        super('Local changes detected during sync');
        this.name = 'LocalSyncAbort';
    }
}

export const getInMemoryAppDataSnapshot = (): AppData => {
    const state = useTaskStore.getState();
    return cloneAppData({
        tasks: state._allTasks ?? state.tasks ?? [],
        projects: state._allProjects ?? state.projects ?? [],
        sections: state._allSections ?? state.sections ?? [],
        areas: state._allAreas ?? state.areas ?? [],
        settings: state.settings ?? {},
    });
};

export const shouldRunAttachmentCleanup = (
    lastCleanupAt: string | undefined,
    intervalMs: number = DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS
): boolean => {
    if (!lastCleanupAt) return true;
    const parsed = Date.parse(lastCleanupAt);
    if (Number.isNaN(parsed)) return true;
    return Date.now() - parsed >= intervalMs;
};
