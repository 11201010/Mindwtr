import { describe, expect, it, vi } from 'vitest';
import { completeTaskForProjectArchive } from './store-helpers';
import { buildLoadContext, runLoadMigrations, MIGRATION_VERSION } from './store-load-migrations';
import { createReferenceSearchPredicate, isReferenceInVisibleProject } from './reference';
import { consoleLogger, setLogger, type LogPayload } from './logger';
import { mergeAppData } from './sync';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Project, Task } from './types';

const stamp = '2026-09-01T00:00:00.000Z';
const now = '2026-09-14T12:00:00.000Z';
const project: Project = {
    id: 'project', title: 'Finished project', status: 'archived', color: '#000', order: 0,
    tagIds: [], createdAt: stamp, updatedAt: stamp,
};
const reference: Task = {
    id: 'reference', title: 'Historical reference', description: 'Garden research',
    status: 'reference', projectId: project.id, tags: [], contexts: [],
    createdAt: stamp, updatedAt: stamp, rev: 4,
};
const legacyReference = completeTaskForProjectArchive(reference, stamp, 'older-device');
const makeData = (task: Task = legacyReference): AppData => ({
    tasks: [task], projects: [project], sections: [], areas: [], people: [],
    settings: {
        deviceId: 'current-device',
        gtd: { autoArchiveDays: 0, taskEditor: { defaultsVersion: 9999 }, focusGroupByDefaultsVersion: 9999 },
        migrations: { version: MIGRATION_VERSION, lastTombstoneCleanupAt: now },
    },
});
const load = (data: AppData) => runLoadMigrations(data, buildLoadContext(data.settings, false, now, Date.parse(now)));

describe('legacy archived-project Reference recovery (#1198)', () => {
    it('makes a reference completed by the old load migration visible and searchable with the archive filter', () => {
        const original = makeData();
        const result = load(original).data;
        const projects = new Map(result.projects.map((item) => [item.id, item]));
        expect(result.tasks.filter((task) => isReferenceInVisibleProject(task, projects, false))).toHaveLength(0);
        expect(result.tasks.filter((task) => isReferenceInVisibleProject(task, projects, true))
            .filter(createReferenceSearchPredicate('historical garden')).map((task) => task.id)).toEqual([reference.id]);
        expect(original.tasks[0]).toEqual(legacyReference);
        expect(result.projects[0]).toBe(project);
        expect(result.tasks[0]).toMatchObject({ status: 'reference', rev: 6, revBy: 'current-device', updatedAt: now });
        expect(load(result).data).toBe(result);
    });

    it('recovers the same legacy reference after automatic archival and preserves its content', () => {
        const archived = { ...legacyReference, status: 'archived' as const, updatedAt: '2026-09-10T00:00:00.000Z', rev: 6 };
        const result = load(makeData(archived)).data.tasks[0];
        expect(result).toMatchObject({ ...reference, updatedAt: now, rev: 7, revBy: 'current-device', isFocusedToday: false });
        expect(result.completedAt).toBeUndefined();
        expect(result.statusBeforeProjectArchive).toBeUndefined();
        expect(result.projectArchivedAt).toBeUndefined();
    });

    it.each([
        { statusBeforeProjectArchive: 'next' },
        { statusBeforeProjectArchive: undefined },
        { projectArchivedAt: undefined },
        { completedAt: now },
        { updatedAt: now },
        { cancelledAt: stamp, status: 'archived' },
        { purgedAt: now },
        { status: 'next', statusBeforeProjectArchive: undefined, projectArchivedAt: undefined },
    ] satisfies Partial<Task>[])('does not reinterpret actions or later edits: %j', (updates) => {
        const task = { ...legacyReference, ...updates };
        const result = load(makeData(task)).data.tasks[0];
        expect(result.status).not.toBe('reference');
    });

    it('does not revive deleted tasks or references in deleted, purged, or cancelled projects', () => {
        expect(load(makeData({ ...legacyReference, deletedAt: now })).data.tasks[0]).toMatchObject({ status: 'done', deletedAt: now });
        for (const updates of [{ deletedAt: now }, { purgedAt: now }, { cancelledAt: stamp }]) {
            const data = makeData();
            data.projects = [{ ...project, ...updates }];
            expect(load(data).data.tasks[0].status).toBe('done');
        }
    });

    it('converges with the saved older-client document and does not recover twice', () => {
        const original = makeData();
        const recovered = load(original).data;
        const merged = mergeAppData(recovered, original, { nowIso: now });
        expect(merged.tasks[0].status).toBe('reference');
        const reloaded = load(merged);
        expect(reloaded.applied).not.toContain('recover-legacy-project-references');
        const repeated = mergeAppData(reloaded.data, original, { nowIso: now });
        expect(repeated).toEqual(merged);
    });

    it('emits a content-free recovery count only on the repairing load', () => {
        const logs: LogPayload[] = [];
        setLogger((payload) => logs.push(payload));
        try {
            const repaired = load(makeData());
            load(repaired.data);
            const recoveryLogs = logs.filter((log) => log.context?.releaseCheck === 'v1.3.1/archive-reference-recovered');
            expect(recoveryLogs).toHaveLength(1);
            expect(recoveryLogs[0].context).toEqual({ releaseCheck: 'v1.3.1/archive-reference-recovered', count: 1 });
        } finally {
            setLogger(consoleLogger);
        }
    });

    it('persists recovery through the shared store and reloads without another save', async () => {
        resetForTests();
        const initialState = useTaskStore.getState();
        let persisted = makeData({ ...legacyReference, status: 'archived', rev: 6 });
        const saveData = vi.fn(async (data: AppData) => {
            persisted = JSON.parse(JSON.stringify(data)) as AppData;
        });
        setStorageAdapter({
            getData: async () => JSON.parse(JSON.stringify(persisted)) as AppData,
            saveData,
        });
        try {
            await useTaskStore.getState().fetchData({ silent: true });
            await flushPendingSave();
            expect(persisted.tasks[0]).toMatchObject({ status: 'reference', rev: 7 });
            expect(persisted.projects[0].status).toBe('archived');
            expect(saveData).toHaveBeenCalledTimes(1);
            expect(useTaskStore.getState().getDerivedState().activeTasksByStatus.get('reference'))
                .toEqual([expect.objectContaining({ id: reference.id })]);
            await useTaskStore.getState().fetchData({ silent: true });
            await flushPendingSave();
            expect(saveData).toHaveBeenCalledTimes(1);
        } finally {
            await flushPendingSave();
            resetForTests();
            useTaskStore.setState(initialState, true);
        }
    });
});
