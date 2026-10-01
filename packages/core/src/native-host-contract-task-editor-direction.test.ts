import { afterEach, describe, expect, it } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Project, Task } from './types';

const now = '2026-10-01T12:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: 'Saved English', description: 'Saved English Notes', status: 'next',
    createdAt: now, updatedAt: now, ...extra,
});
const archivedProject: Project = {
    id: 'archived', title: 'Archived', status: 'archived', color: '#3b82f6', order: 0,
    tagIds: [], createdAt: now, updatedAt: now,
};

async function open() {
    await flushPendingSave();
    resetForTests();
    const data: AppData = {
        tasks: [task('active'), task('archived-task', { projectId: 'archived' }),
            task('deleted', { deletedAt: now }), task('purged', { purgedAt: now })],
        projects: [archivedProject], sections: [], areas: [], people: [], settings: {},
    };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async () => { saves++; } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    const host = createNativeHostContract();
    expect(host.getTaskEditorDraftDirection({ id: 'active', title: '', description: '' }))
        .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
    const activated = await host.activate({ writeSafetyReady: true });
    expect(activated, JSON.stringify(activated)).toMatchObject({ ok: true });
    await flushPendingSave();
    return { host, data, saves: () => saves };
}

afterEach(async () => { await flushPendingSave(); resetForTests(); });

describe('native Task Editor draft direction', () => {
    it('uses only raw title and Notes with the current language and makes no writes', async () => {
        const { host, data, saves } = await open();
        const before = structuredClone(useTaskStore.getState()._allTasks);
        const saved = saves();
        const direction = (title: string, description: string, id = 'active') =>
            host.getTaskEditorDraftDirection({ id, title, description });
        expect(direction('English', 'English Notes')).toEqual({ ok: true, value: { direction: 'ltr' } });
        expect(direction('مرحبا', 'English Notes')).toEqual({ ok: true, value: { direction: 'rtl' } });
        expect(direction('English', 'שלום Notes')).toEqual({ ok: true, value: { direction: 'rtl' } });
        expect(direction('English title', 'Arabic مرحبا Notes')).toEqual({ ok: true, value: { direction: 'rtl' } });
        expect(direction('', '')).toEqual({ ok: true, value: { direction: 'ltr' } });
        expect(direction('English', '', 'archived-task')).toEqual({ ok: true, value: { direction: 'ltr' } });
        expect(await host.setLanguage({ storedLanguage: 'ar', systemLocale: 'en-US' })).toMatchObject({ ok: true });
        expect(direction('English', '')).toEqual({ ok: true, value: { direction: 'rtl' } });
        expect(direction('  ', '\n ')).toEqual({ ok: true, value: { direction: 'rtl' } });
        expect(await host.setLanguage({ storedLanguage: 'xx', systemLocale: 'en-US' })).toMatchObject({ ok: true,
            value: { language: 'en' } });
        expect(direction('', '')).toEqual({ ok: true, value: { direction: 'ltr' } });
        expect(useTaskStore.getState()._allTasks).toEqual(before);
        expect(data.tasks[0].title).toBe('Saved English');
        expect(saves()).toBe(saved);
    });

    it('rejects unavailable tasks and malformed or oversized input', async () => {
        const { host, saves } = await open();
        const saved = saves();
        for (const id of ['missing', 'deleted', 'purged']) {
            expect(host.getTaskEditorDraftDirection({ id, title: 'Title', description: 'Notes' }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        for (const input of [null, { id: '', title: '', description: '' },
            { id: 'x'.repeat(501), title: '', description: '' }, { id: 'active', title: '' },
            { id: 'active', title: null, description: '' }, { id: 'active', title: '', description: null },
            { id: 'active', title: '', description: '', extra: true },
            { id: 'active', title: '', description: '漢'.repeat(700_000) }]) {
            expect(host.getTaskEditorDraftDirection(input as never))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(saves()).toBe(saved);
    });
});
