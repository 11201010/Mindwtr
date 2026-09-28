import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectFlowMethods, type NativeProjectFlowRequest } from './native-host-contract-project-flow';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { PROJECT_SQLITE_COLUMNS, projectToSqliteRow } from './project-sync-schema';
import type { AppData, Project, Section, Task } from './types';

const now = '2026-09-28T15:00:00.000Z';
const project = (id = 'target', overrides: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#3b82f6', order: 0, tagIds: ['#work'],
    rev: 3, revBy: 'old-device', createdAt: now, updatedAt: now, ...overrides,
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
        settings: { deviceId: 'flow-device' }, ...initial };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next); saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = createProjectFlowMethods({ readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        }, revision: () => 'revision' });
    const request = (action: NativeProjectFlowRequest['action']): NativeProjectFlowRequest => {
        const options = methods.getProjectFlowOptions({ projectId: 'target' });
        if (!options.ok) throw new Error(JSON.stringify(options.error));
        const { id: _id, ...expected } = options.value.project;
        return { requestId: '73799899-d143-40c1-84bd-a09172bba5a4', projectId: 'target', action, expected };
    };
    return { methods, request, data: () => data, saves: () => saves };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared native Project flow', () => {
    it('toggles type while preserving raw scope and all unrelated rows', async () => {
        const original = project('target', { isSequential: false, sequentialScope: 'section' });
        const linkedTask = task();
        const linkedSection = section();
        const other = project('other');
        const { methods, request, data } = await open({ projects: [original, other],
            tasks: [linkedTask], sections: [linkedSection] });
        const tasksBefore = structuredClone(useTaskStore.getState()._allTasks);
        const sectionsBefore = structuredClone(useTaskStore.getState()._allSections);
        const input = request({ kind: 'toggleType' });
        const plan = methods.prepareProjectFlow(input);
        if (!plan.ok) throw new Error(JSON.stringify(plan.error));
        expect(plan).toMatchObject({ ok: true, value: { kind: 'prepared', prepared: {
            result: { id: 'target', isSequential: true, sequentialScope: 'section' },
            effect: { project: { after: { isSequential: true, sequentialScope: 'section', rev: 4 } } },
        } } });
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(await methods.commitPreparedProjectFlow({ request: input, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true, value: { isSequential: true, sequentialScope: 'section' } });
        expect(data().projects[0]).toEqual(plan.value.prepared.effect.project.after);
        expect(data().projects[1]).toEqual(other);
        expect(data().tasks).toEqual(tasksBefore);
        expect(data().sections).toEqual(sectionsBefore);
    });

    it('keeps optional flow fields raw in the token and makes missing scope an explicit Project write', async () => {
        const { methods, request, data, saves } = await open({ projects: [project('target', { isSequential: true })] });
        expect(methods.getProjectFlowOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { project: { isSequential: true, sequentialScope: null }, canChange: true } });
        const input = request({ kind: 'setScope', scope: 'project' });
        const plan = methods.prepareProjectFlow(input);
        expect(plan).toMatchObject({ ok: true, value: { kind: 'prepared', prepared: {
            result: { isSequential: true, sequentialScope: 'project' } } } });
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(await methods.commitPreparedProjectFlow({ request: input, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true });
        expect(data().projects[0]).toMatchObject({ isSequential: true, sequentialScope: 'project', rev: 4 });
        expect(methods.prepareProjectFlow(request({ kind: 'setScope', scope: 'project' }))).toEqual({ ok: true,
            value: { kind: 'noop', result: { id: 'target', isSequential: true, sequentialScope: 'project' } } });
        expect(saves()).toBe(1);
    });

    it('blocks scope on parallel and all archived flow changes after checking the frozen token', async () => {
        const { methods, request, saves } = await open({ projects: [project('target')] });
        expect(methods.getProjectFlowOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { project: { isSequential: null, sequentialScope: null }, canChange: true } });
        const stale = request({ kind: 'setScope', scope: 'project' });
        expect(methods.prepareProjectFlow(stale)).toEqual({ ok: true,
            value: { kind: 'blocked', result: { blocked: '' } } });
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, status: 'archived', rev: 4 } : row) }));
        expect(methods.prepareProjectFlow(stale)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(methods.getProjectFlowOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { canChange: false } });
        expect(methods.prepareProjectFlow(request({ kind: 'toggleType' }))).toEqual({ ok: true,
            value: { kind: 'blocked', result: { blocked: '' } } });
        expect(saves()).toBe(0);
    });

    it('allows waiting and someday changes, and toggle back keeps stored scope', async () => {
        for (const status of ['waiting', 'someday'] as const) {
            const { methods, request, data } = await open({ projects: [project('target', {
                status, isSequential: true, sequentialScope: 'section',
            })] });
            const input = request({ kind: 'toggleType' });
            const plan = methods.prepareProjectFlow(input);
            if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
            expect(await methods.commitPreparedProjectFlow({ request: input, prepared: plan.value.prepared }))
                .toMatchObject({ ok: true, value: { isSequential: false, sequentialScope: 'section' } });
            expect(data().projects[0]).toMatchObject({ status, isSequential: false, sequentialScope: 'section' });
        }
    });

    it('matches RN updateProject final rows for type and scope without touching children', async () => {
        for (const action of [{ kind: 'toggleType' } as const,
            { kind: 'setScope', scope: 'section' } as const]) {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z'));
            const { methods, request } = await open({ projects: [project('target', {
                status: 'waiting', isSequential: true, sequentialScope: 'project', supportNotes: 'Keep notes',
            })], tasks: [task()], sections: [section()] });
            const input = request(action);
            const plan = methods.prepareProjectFlow(input);
            if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
            const tasksBefore = structuredClone(useTaskStore.getState()._allTasks);
            const sectionsBefore = structuredClone(useTaskStore.getState()._allSections);
            const patch = action.kind === 'toggleType' ? { isSequential: false }
                : { sequentialScope: 'section' as const };
            expect((await useTaskStore.getState().updateProject('target', patch)).success).toBe(true);
            expect(useTaskStore.getState()._allProjects[0]).toEqual(plan.value.prepared.effect.project.after);
            expect(useTaskStore.getState()._allTasks).toEqual(tasksBefore);
            expect(useTaskStore.getState()._allSections).toEqual(sectionsBefore);
            vi.useRealTimers();
        }
    });

    it('accepts Swift sorted-key rich journals, exact receipt replay, and refuses partial changes', async () => {
        const attachment = { id: 'a', kind: 'link' as const, title: 'Source', uri: 'https://example.test/',
            createdAt: now, updatedAt: now };
        const rich = project('target', { isSequential: true, attachments: [attachment, { ...attachment, id: 'b' }],
            supportNotes: 'Keep notes', dueDate: '2026-10-01', areaTitle: 'Work' });
        const attachmentIndex = PROJECT_SQLITE_COLUMNS.indexOf('attachments');
        const attachmentText = projectToSqliteRow(rich)[attachmentIndex];
        const { methods, request, data, saves } = await open({ projects: [rich] });
        const input = request({ kind: 'setScope', scope: 'section' });
        const plan = methods.prepareProjectFlow(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const frozen = JSON.parse(JSON.stringify(sortKeys({ request: input, prepared: plan.value.prepared }))) as
            { request: typeof input; prepared: typeof plan.value.prepared };
        expect(methods.validatePreparedProjectFlow(frozen)).toMatchObject({ ok: true });
        expect(await methods.commitPreparedProjectFlow(frozen)).toMatchObject({ ok: true,
            value: { id: 'target', isSequential: true, sequentialScope: 'section' } });
        expect(projectToSqliteRow(data().projects[0])[attachmentIndex]).toBe(attachmentText);
        expect(data().projects[0]).toMatchObject({ supportNotes: rich.supportNotes, dueDate: rich.dueDate,
            areaTitle: rich.areaTitle, tagIds: rich.tagIds, rev: 4 });
        const count = saves();
        useTaskStore.setState((state) => ({ settings: { ...state.settings, deviceId: 'different-device' },
            _allProjects: [...state._allProjects, project('new')] }));
        expect(await methods.commitPreparedProjectFlow(frozen)).toMatchObject({ ok: true });
        expect(saves()).toBe(count);
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, supportNotes: 'Later edit' } : row) }));
        expect(await methods.commitPreparedProjectFlow(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(count);
    });

    it('refuses stale first-apply metadata, archive, and deletion', async () => {
        const original = project('target', { isSequential: true });
        const { methods, request, saves } = await open({ projects: [original] });
        const input = request({ kind: 'setScope', scope: 'section' });
        const plan = methods.prepareProjectFlow(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        for (const changed of [{ ...original, color: '#000000' },
            { ...original, status: 'archived' as const }, { ...original, deletedAt: now }]) {
            useTaskStore.setState({ _allProjects: [changed] });
            expect(await methods.commitPreparedProjectFlow({ request: input, prepared: plan.value.prepared }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(saves()).toBe(0);
    });

    it('retries a failed durable save without toggling twice and initializes a missing device ID atomically', async () => {
        let failed = true;
        const first = await open({ settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request({ kind: 'toggleType' });
        const plan = first.methods.prepareProjectFlow(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.deviceIdBefore).toBeNull();
        const frozen = { request: input, prepared: plan.value.prepared };
        expect(await first.methods.commitPreparedProjectFlow(frozen)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.data().projects[0].isSequential).toBeUndefined();
        failed = false;
        expect(await first.methods.commitPreparedProjectFlow(frozen)).toMatchObject({ ok: true,
            value: { isSequential: true, sequentialScope: null } });
        expect(first.data().projects[0]).toMatchObject({ isSequential: true, rev: 4 });
        expect(first.data().settings.deviceId).toBe(plan.value.prepared.deviceIdToInitialize);
        const second = await open(structuredClone(first.data()));
        await flushPendingSave();
        const count = second.saves();
        expect(await second.methods.commitPreparedProjectFlow(frozen)).toMatchObject({ ok: true });
        expect(second.saves()).toBe(count);
    });

    it('rejects malformed, forged and oversized journals; nil-pending probe never writes', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', { isSequential: true })] });
        const input = request({ kind: 'setScope', scope: 'section' });
        const plan = methods.prepareProjectFlow(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const envelope = { request: input, prepared: plan.value.prepared };
        const omitted = structuredClone(envelope);
        (omitted.prepared.scope.project as Partial<Project>).tagIds = undefined;
        expect(methods.validatePreparedProjectFlow(omitted)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forged = structuredClone(envelope);
        forged.prepared.effect.project.after.color = '#000000';
        expect(methods.validatePreparedProjectFlow(forged)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const wrongResult = structuredClone(envelope);
        wrongResult.prepared.result.isSequential = false;
        expect(methods.validatePreparedProjectFlow(wrongResult)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectFlow({ ...input, action: { kind: 'setScope', scope: 'other' } as never }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectFlow({ ...input, expected: { ...input.expected, isSequential: false } }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(methods.probeProjectFlowOutcome(input)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('refuses a rich Project snapshot over 2 MB UTF-8 before persistence', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', {
            isSequential: true, supportNotes: '漢'.repeat(250_000),
        })] });
        expect(methods.prepareProjectFlow(request({ kind: 'setScope', scope: 'section' })))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(0);
    });

});
