import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeMindwtrCsv } from './mindwtr-csv-export';
import { createBackupFileName, serializeBackupData } from './backup-transfer';
import { createNativeHostContract } from './native-host-contract';
import { acquireWorkspaceTransitionLock } from './sandbox';
import * as sandbox from './sandbox';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { getInMemoryAppDataSnapshot } from './sync-client-helpers';
import type { AppData } from './types';

const now = '2026-10-04T12:34:56.789Z';
const fixture = (): AppData => ({
    tasks: [{ id: 'export-task', title: '日本語 🦉', status: 'reference', tags: ['kept'], contexts: [],
        createdAt: now, updatedAt: now, notes: 'Multiline\nnotes', dueDate: '2026-10-05',
        checklist: [{ id: 'check', title: 'Keep me', isCompleted: false }] }],
    projects: [], sections: [], areas: [], people: [],
    settings: { language: 'ar', diagnostics: { loggingEnabled: false } },
});

async function openHost() {
    await flushPendingSave();
    resetForTests();
    const saveData = vi.fn(async () => {});
    setStorageAdapter({ getData: async () => fixture(), saveData });
    useTaskStore.setState({ tasks: [], projects: [], sections: [], areas: [], people: [],
        _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        error: null, persistenceFailure: null, isLoading: false, editLockCount: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    const host = createNativeHostContract();
    expect((await host.activate({ writeSafetyReady: true })).ok).toBe(true);
    await flushPendingSave();
    saveData.mockClear();
    return { host, saveData };
}

describe('native JSON and CSV export', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('uses the actual RN snapshot and serializer without changing the store or saving', async () => {
        const { host, saveData } = await openHost();
        vi.useFakeTimers();
        vi.setSystemTime(new Date(now));
        const snapshot = getInMemoryAppDataSnapshot();
        const before = JSON.stringify(snapshot);
        const result = host.getDataBackup();
        expect(result).toEqual({ ok: true, value: {
            fileName: createBackupFileName(new Date(now)), content: serializeBackupData(snapshot),
        } });
        expect(JSON.stringify(getInMemoryAppDataSnapshot())).toBe(before);
        expect(saveData).not.toHaveBeenCalled();
        // A later edit cannot change a prepared file's bytes.
        useTaskStore.setState({ settings: { language: 'en' } });
        expect(result.ok && JSON.parse(result.value.content).settings.language).toBe('ar');
    });

    it('exports all live CSV records with RN quoting, history and container lookup without saving', async () => {
        const { host, saveData } = await openHost();
        const task = fixture().tasks[0];
        useTaskStore.setState({ tasks: [], _allTasks: [
            { ...task, title: '日本語, "quoted"\nnext line', description: 'two\nlines', projectId: 'project', sectionId: 'section' },
            { ...task, id: 'done', status: 'done', completedAt: now },
            { ...task, id: 'deleted', deletedAt: now },
            { ...task, id: 'purged', purgedAt: now },
        ], projects: [], _allProjects: [{ id: 'project', title: 'Project', status: 'active', areaId: 'area', createdAt: now, updatedAt: now }],
        sections: [], _allSections: [{ id: 'section', projectId: 'project', title: 'Section', order: 1, createdAt: now, updatedAt: now }],
        areas: [], _allAreas: [{ id: 'area', name: 'Area', createdAt: now, updatedAt: now }] } as never);
        const before = JSON.stringify(getInMemoryAppDataSnapshot());
        const result = host.getDataBackup('csv');
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('CSV refused');
        expect(result.value.fileName).toMatch(/^mindwtr-backup-.*\.csv$/);
        expect(result.value.content).toBe(serializeMindwtrCsv(getInMemoryAppDataSnapshot()));
        expect(result.value.content).toContain('"日本語, ""quoted""\nnext line"');
        expect(result.value.content).toContain('Project,Section,Area');
        expect(result.value.content).toContain(',done,');
        expect(result.value.content).not.toContain(',deleted,');
        expect(result.value.content).not.toContain(',purged,');
        expect(JSON.stringify(getInMemoryAppDataSnapshot())).toBe(before);
        expect(saveData).not.toHaveBeenCalled();
        expect(host.getDataBackup('zip' as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('refuses before activation and during workspace handoff without writes', async () => {
        const { saveData } = await openHost();
        const host = createNativeHostContract();
        for (const format of ['json', 'csv'] as const) {
            expect(host.getDataBackup(format)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        }
        expect((await host.activate({ writeSafetyReady: true })).ok).toBe(true);
        await flushPendingSave();
        saveData.mockClear();
        const release = acquireWorkspaceTransitionLock();
        expect(release).not.toBeNull();
        try {
            for (const format of ['json', 'csv'] as const) {
                expect(host.getDataBackup(format)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
            }
            expect(saveData).not.toHaveBeenCalled();
        } finally { release?.(); }
    });

    it('does not retry or clear a persistence failure to export', async () => {
        const { host, saveData } = await openHost();
        const failure = { message: 'save owed', retrying: false };
        useTaskStore.setState({ persistenceFailure: failure } as never);
        for (const format of ['json', 'csv'] as const) {
            expect(host.getDataBackup(format)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        }
        expect(useTaskStore.getState().persistenceFailure).toBe(failure);
        expect(saveData).not.toHaveBeenCalled();
        useTaskStore.setState({ persistenceFailure: null });
    });

    it('exports hidden records and attachment metadata while compacting purged content exactly as RN does', async () => {
        const { host, saveData } = await openHost();
        const task = fixture().tasks[0];
        const allTasks = [
            { ...task, attachments: [{ id: 'attachment', kind: 'file' as const, title: 'Photo', uri: 'file:///private/photo.jpg', createdAt: now, updatedAt: now }] },
            { ...task, id: 'purged', title: 'removed private text', deletedAt: now, purgedAt: now },
        ];
        useTaskStore.setState({ tasks: [], _allTasks: allTasks });
        const expected = serializeBackupData(getInMemoryAppDataSnapshot());
        const before = JSON.stringify(useTaskStore.getState());
        const result = host.getDataBackup();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('Export refused');
        expect(result.value.content).toBe(expected);
        const parsed = JSON.parse(result.value.content);
        expect(parsed.tasks).toHaveLength(2);
        expect(parsed.tasks[0].attachments).toEqual(allTasks[0].attachments);
        expect(result.value.content).not.toContain('removed private text');
        expect(JSON.stringify(useTaskStore.getState())).toBe(before);
        expect(saveData).not.toHaveBeenCalled();
    });

    it('refuses sandbox transfers without preparing personal data', async () => {
        const { host, saveData } = await openHost();
        vi.spyOn(sandbox, 'isSandboxMode').mockReturnValue(true);
        for (const format of ['json', 'csv'] as const) {
            expect(host.getDataBackup(format)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        }
        expect(saveData).not.toHaveBeenCalled();
    });
});
