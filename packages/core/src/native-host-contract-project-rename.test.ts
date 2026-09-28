import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectRenameMethods, type NativeProjectRenameRequest } from './native-host-contract-project-rename';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { PROJECT_SQLITE_COLUMNS, projectToSqliteRow } from './project-sync-schema';
import type { AppData, Project, Section, Task } from './types';

const now = '2026-09-28T15:00:00.000Z';
const project = (id = 'target', overrides: Partial<Project> = {}): Project => ({
    id, title: id === 'target' ? 'Old title' : id, status: 'active', color: '#3b82f6', order: 0,
    tagIds: ['#work'], rev: 3, revBy: 'old-device', createdAt: now, updatedAt: now, ...overrides,
});
const task = (): Task => ({ id: 'linked-task', title: 'Keep task text', status: 'next', projectId: 'target',
    tags: ['#work'], contexts: ['@home'], rev: 5, revBy: 'old-device', createdAt: now, updatedAt: now });
const section = (): Section => ({ id: 'linked-section', projectId: 'target', title: 'Keep section text',
    order: 0, rev: 2, revBy: 'old-device', createdAt: now, updatedAt: now });
const sortKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortKeys(nested)])) : value;

async function open(initial: Partial<AppData> = {}, fail?: () => boolean) {
    await flushPendingSave(); resetForTests();
    let data: AppData = { tasks: [], projects: [project()], sections: [], areas: [], people: [],
        settings: { deviceId: 'rename-device' }, ...initial };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next); saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = createProjectRenameMethods({ readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        }, revision: () => 'revision' });
    const request = (title: string): NativeProjectRenameRequest => {
        const options = methods.getProjectRenameOptions({ projectId: 'target' });
        if (!options.ok) throw new Error(JSON.stringify(options.error));
        const { id: _id, ...expected } = options.value.project;
        return { requestId: '73799899-d143-40c1-84bd-a09172bba5a4', projectId: 'target', title, expected };
    };
    return { methods, request, data: () => data, saves: () => saves };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared native Project rename', () => {
    it('trims title, permits duplicates, and revises only the selected Project', async () => {
        const original = project();
        const duplicate = project('other', { title: 'New title' });
        const linkedTask = task();
        const linkedSection = section();
        const { methods, request, data } = await open({ projects: [original, duplicate],
            tasks: [linkedTask], sections: [linkedSection] });
        const tasksBefore = structuredClone(useTaskStore.getState()._allTasks);
        const sectionsBefore = structuredClone(useTaskStore.getState()._allSections);
        const input = request('  New title  ');
        expect(methods.getProjectRenameOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { project: { title: 'Old title', status: 'active' }, canRename: true } });
        const plan = methods.prepareProjectRename(input);
        expect(plan).toMatchObject({ ok: true, value: { kind: 'prepared', prepared: {
            result: { id: 'target', title: 'New title' }, effect: { project: { after: {
                title: 'New title', rev: 4, revBy: 'rename-device', color: '#3b82f6' } } } } } });
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(methods.validatePreparedProjectRename({ request: input, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true, value: { id: 'target', title: 'New title' } });
        expect(await methods.commitPreparedProjectRename({ request: input, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true, value: { id: 'target', title: 'New title' } });
        expect(data().projects[0]).toEqual(plan.value.prepared.effect.project.after);
        expect(data().projects[1]).toEqual(duplicate);
        expect(data().tasks).toEqual(tasksBefore);
        expect(data().sections).toEqual(sectionsBefore);
    });

    it('returns normalized no-op with the stored title, and blocks archived edits after token validation', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', { title: ' Old title ' })] });
        expect(methods.prepareProjectRename(request('   '))).toEqual({ ok: true,
            value: { kind: 'noop', result: { id: 'target', title: ' Old title ' } } });
        expect(methods.prepareProjectRename(request('Old title'))).toMatchObject({ ok: true,
            value: { kind: 'prepared', prepared: { result: { id: 'target', title: 'Old title' } } } });
        expect(saves()).toBe(0);
        const stale = request('New title');
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, status: 'archived', rev: 4 } : row) }));
        expect(methods.prepareProjectRename(stale)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(methods.getProjectRenameOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { canRename: false } });
        expect(methods.prepareProjectRename(request('New title'))).toEqual({ ok: true,
            value: { kind: 'blocked', result: { blocked: '' } } });
        expect(saves()).toBe(0);
    });

    it('allows waiting and someday titles, while an exact current title remains a no-write no-op', async () => {
        for (const status of ['waiting', 'someday'] as const) {
            const { methods, request, data, saves } = await open({ projects: [project('target', { status })] });
            expect(methods.prepareProjectRename(request(' Old title '))).toEqual({ ok: true,
                value: { kind: 'noop', result: { id: 'target', title: 'Old title' } } });
            const input = request(`${status} title`);
            const plan = methods.prepareProjectRename(input);
            expect(plan).toMatchObject({ ok: true, value: { kind: 'prepared' } });
            if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
            expect(await methods.commitPreparedProjectRename({ request: input, prepared: plan.value.prepared }))
                .toMatchObject({ ok: true, value: { id: 'target', title: `${status} title` } });
            expect(data().projects[0]).toMatchObject({ status, title: `${status} title`, rev: 4 });
            expect(saves()).toBe(1);
        }
    });

    it('matches RN updateProject final title-only lifecycle row', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z'));
        const { methods, request } = await open({ projects: [project('target', {
            status: 'waiting', isFocused: true, supportNotes: 'Keep notes', cancelledAt: undefined,
        })] });
        const input = request('  Renamed  ');
        const plan = methods.prepareProjectRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect((await useTaskStore.getState().updateProject('target', { title: 'Renamed' })).success).toBe(true);
        expect(useTaskStore.getState()._allProjects[0]).toEqual(plan.value.prepared.effect.project.after);
    });

    it('accepts a sorted-key rich Project journal and preserves exact attachment SQL text on apply and replay', async () => {
        const attachment = { id: 'a', kind: 'link' as const, title: 'Source', uri: 'https://example.test/',
            createdAt: now, updatedAt: now };
        const rich = project('target', { attachments: [attachment, { ...attachment, id: 'b' }],
            supportNotes: 'Keep notes', dueDate: '2026-10-01', areaTitle: 'Work' });
        const attachmentIndex = PROJECT_SQLITE_COLUMNS.indexOf('attachments');
        const attachmentText = projectToSqliteRow(rich)[attachmentIndex];
        const { methods, request, data, saves } = await open({ projects: [rich] });
        const input = request('  Edited title ');
        const plan = methods.prepareProjectRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const frozen = JSON.parse(JSON.stringify(sortKeys({ request: input, prepared: plan.value.prepared }))) as
            { request: typeof input; prepared: typeof plan.value.prepared };
        expect(methods.validatePreparedProjectRename(frozen)).toMatchObject({ ok: true });
        expect(await methods.commitPreparedProjectRename(frozen)).toMatchObject({ ok: true,
            value: { id: 'target', title: 'Edited title' } });
        expect(projectToSqliteRow(data().projects[0])[attachmentIndex]).toBe(attachmentText);
        expect(data().projects[0]).toMatchObject({ supportNotes: rich.supportNotes, dueDate: rich.dueDate,
            areaTitle: rich.areaTitle, tagIds: rich.tagIds, rev: 4 });
        const count = saves();
        useTaskStore.setState((state) => ({ settings: { ...state.settings, deviceId: 'different-device' },
            _allProjects: [...state._allProjects, project('new', { isFocused: true })] }));
        expect(await methods.commitPreparedProjectRename(frozen)).toMatchObject({ ok: true });
        expect(saves()).toBe(count);
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, supportNotes: 'Later edit' } : row) }));
        expect(await methods.commitPreparedProjectRename(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(count);
    });

    it('refuses changed live metadata, archive, or deletion before the first apply', async () => {
        const original = project();
        const { methods, request, saves } = await open({ projects: [original] });
        const input = request('Changed title');
        const plan = methods.prepareProjectRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const envelope = { request: input, prepared: plan.value.prepared };
        for (const changed of [
            { ...original, color: '#000000' },
            { ...original, status: 'archived' as const },
            { ...original, deletedAt: now },
        ]) {
            useTaskStore.setState({ _allProjects: [changed] });
            expect(await methods.commitPreparedProjectRename(envelope)).toMatchObject({ ok: false,
                error: { code: 'STALE_REVISION' } });
        }
        expect(saves()).toBe(0);
    });

    it('retries a failed save with one revision and initializes a missing device ID atomically', async () => {
        let failed = true;
        const first = await open({ settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request('Retried title');
        const plan = first.methods.prepareProjectRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.deviceIdBefore).toBeNull();
        const frozen = { request: input, prepared: plan.value.prepared };
        expect(await first.methods.commitPreparedProjectRename(frozen)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.data().projects[0].title).toBe('Old title');
        failed = false;
        expect(await first.methods.commitPreparedProjectRename(frozen)).toMatchObject({ ok: true,
            value: { id: 'target', title: 'Retried title' } });
        expect(first.data().projects[0]).toMatchObject({ title: 'Retried title', rev: 4 });
        expect(first.data().settings.deviceId).toBe(plan.value.prepared.deviceIdToInitialize);
        const second = await open(structuredClone(first.data()));
        await flushPendingSave();
        const count = second.saves();
        expect(await second.methods.commitPreparedProjectRename(frozen)).toMatchObject({ ok: true });
        expect(second.saves()).toBe(count);
    });

    it('rejects forged, incomplete, and oversized journals; nil-pending probe never writes', async () => {
        const { methods, request, saves } = await open();
        const input = request('Changed title');
        const plan = methods.prepareProjectRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const envelope = { request: input, prepared: plan.value.prepared };
        const omitted = structuredClone(envelope);
        (omitted.prepared.scope.project as Partial<Project>).tagIds = undefined;
        expect(methods.validatePreparedProjectRename(omitted)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forged = structuredClone(envelope);
        forged.prepared.effect.project.after.color = '#000000';
        expect(methods.validatePreparedProjectRename(forged)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const result = structuredClone(envelope);
        result.prepared.result.title = 'Forged';
        expect(methods.validatePreparedProjectRename(result)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectRename({ ...input, title: '漢'.repeat(800_000) }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.probeProjectRenameOutcome(input)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('refuses a rich snapshot above the 2 MB UTF-8 journal bound before persistence', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', {
            supportNotes: '漢'.repeat(250_000),
        })] });
        expect(methods.prepareProjectRename(request('Changed title'))).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(0);
    });
});
