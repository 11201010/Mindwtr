import { describe, expect, it } from 'vitest';

import { useTaskStore } from './store';
import {
    DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS,
    LocalSyncAbort,
    getInMemoryAppDataSnapshot,
    shouldRunAttachmentCleanup,
} from './sync-client-helpers';

describe('sync-client-helpers', () => {
    it('creates an isolated in-memory app data snapshot', () => {
        const now = '2026-01-01T00:00:00.000Z';
        useTaskStore.setState((state) => ({
            ...state,
            _allTasks: [{ id: 't1', title: 'Task', status: 'inbox', createdAt: now, updatedAt: now }],
            _allProjects: [{ id: 'p1', title: 'Project', status: 'active', color: '#000000', createdAt: now, updatedAt: now }],
            _allSections: [],
            _allAreas: [],
            settings: { gtd: { autoArchiveDays: 7 } },
        }));

        const snapshot = getInMemoryAppDataSnapshot();
        snapshot.tasks[0]!.title = 'Changed';

        expect(useTaskStore.getState()._allTasks[0]!.title).toBe('Task');
    });

    it('evaluates attachment cleanup windows', () => {
        expect(shouldRunAttachmentCleanup(undefined)).toBe(true);
        expect(shouldRunAttachmentCleanup('invalid-date')).toBe(true);

        const now = Date.now();
        const recent = new Date(now - Math.floor(DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS / 2)).toISOString();
        const stale = new Date(now - (DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS + 1_000)).toISOString();

        expect(shouldRunAttachmentCleanup(recent)).toBe(false);
        expect(shouldRunAttachmentCleanup(stale)).toBe(true);
    });

    it('creates a named LocalSyncAbort error', () => {
        const error = new LocalSyncAbort();
        expect(error.name).toBe('LocalSyncAbort');
        expect(error.message).toContain('Local changes detected');
    });
});
