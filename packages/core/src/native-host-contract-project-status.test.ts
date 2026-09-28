import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectStatusMethods, type NativeProjectStatusRequest,
    type NativeSelectableProjectStatus } from './native-host-contract-project-status';
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
        settings: { deviceId: 'status-device' }, ...initial };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next); saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = createProjectStatusMethods({ readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        }, revision: () => 'stable-revision' });
    const request = (status: NativeSelectableProjectStatus): NativeProjectStatusRequest => {
        const options = methods.getProjectStatusOptions({ projectId: 'target' });
        if (!options.ok) throw new Error(JSON.stringify(options.error));
        const { id: _id, ...expected } = options.value.project;
        return { requestId: '73799899-d143-40c1-84bd-a09172bba5a4', projectId: 'target', status, expected };
    };
    return { methods, request, data: () => data, saves: () => saves };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared native Project Active/Waiting/Someday edits', () => {
    it.each([
        { before: 'active' as const, focused: true, next: 'waiting' as const, afterFocus: false },
        { before: 'waiting' as const, focused: false, next: 'someday' as const, afterFocus: false },
        { before: 'someday' as const, focused: undefined, next: 'active' as const, afterFocus: undefined },
    ])('matches RN updateProject for $before -> $next without touching children', async ({ before, focused, next, afterFocus }) => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z'));
        const original = project('target', { status: before, isFocused: focused, supportNotes: '  raw Notes  ',
            attachments: [{ id: 'a', kind: 'link', title: 'Source', uri: 'https://example.test/',
                createdAt: now, updatedAt: now }], dueDate: '2026-10-01' });
        const { methods, request } = await open({ projects: [original, project('other')],
            tasks: [task()], sections: [section()] });
        const beforeAttachment = projectToSqliteRow(original)[PROJECT_SQLITE_COLUMNS.indexOf('attachments')];
        const input = request(next);
        const plan = methods.prepareProjectStatus(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.effect.project.after).toMatchObject({ status: next, rev: 4,
            title: original.title, supportNotes: original.supportNotes, dueDate: original.dueDate });
        expect(plan.value.prepared.effect.project.after.isFocused).toBe(afterFocus);
        expect(projectToSqliteRow(plan.value.prepared.effect.project.after)[PROJECT_SQLITE_COLUMNS.indexOf('attachments')])
            .toBe(beforeAttachment);
        const children = { tasks: structuredClone(useTaskStore.getState()._allTasks),
            sections: structuredClone(useTaskStore.getState()._allSections) };
        expect((await useTaskStore.getState().updateProject('target', { status: next })).success).toBe(true);
        expect(useTaskStore.getState()._allProjects[0]).toEqual(plan.value.prepared.effect.project.after);
        expect(useTaskStore.getState()._allProjects[1]).toEqual(project('other'));
        expect(useTaskStore.getState()._allTasks).toEqual(children.tasks);
        expect(useTaskStore.getState()._allSections).toEqual(children.sections);
    });

    it('preserves all other rich rows and returns the lifecycle focus result', async () => {
        const original = project('target', { isFocused: true, supportNotes: 'keep',
            attachments: [{ id: 'a', kind: 'link', title: 'Source', uri: 'https://example.test/',
                createdAt: now, updatedAt: now }] });
        const other = project('other');
        const linkedTask = task(); const linkedSection = section();
        const { methods, request, data } = await open({ projects: [original, other],
            tasks: [linkedTask], sections: [linkedSection] });
        const childrenBefore = { tasks: structuredClone(useTaskStore.getState()._allTasks),
            sections: structuredClone(useTaskStore.getState()._allSections) };
        const input = request('waiting');
        const plan = methods.prepareProjectStatus(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(await methods.commitPreparedProjectStatus({ request: input, prepared: plan.value.prepared }))
            .toEqual({ ok: true, value: { id: 'target', status: 'waiting', isFocused: false } });
        expect(data().projects[0]).toEqual(plan.value.prepared.effect.project.after);
        expect(data().projects[1]).toEqual(other);
        expect(data().tasks).toEqual(childrenBefore.tasks);
        expect(data().sections).toEqual(childrenBefore.sections);
    });

    it('checks stale tokens before same-status no-op or archived block, without initializing a device', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', { isFocused: undefined })],
            settings: {} });
        useTaskStore.setState({ settings: {} });
        expect(methods.getProjectStatusOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { project: { isFocused: null, cancelledAt: null }, canChange: true } });
        const same = request('active');
        expect(methods.prepareProjectStatus(same)).toEqual({ ok: true,
            value: { kind: 'noop', result: { id: 'target', status: 'active', isFocused: null } } });
        expect(useTaskStore.getState().settings.deviceId).toBeUndefined();
        useTaskStore.setState({ _allProjects: [project('target', { status: 'archived', rev: 4 })] });
        expect(methods.prepareProjectStatus(same)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(methods.getProjectStatusOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { canChange: false } });
        expect(methods.prepareProjectStatus(request('active'))).toEqual({ ok: true,
            value: { kind: 'blocked', result: { blocked: '' } } });
        for (const unavailable of [{ deletedAt: now }, { purgedAt: now }]) {
            useTaskStore.setState({ _allProjects: [project('target', unavailable)] });
            expect(methods.getProjectStatusOptions({ projectId: 'target' })).toMatchObject({ ok: false,
                error: { code: 'STALE_REVISION' } });
        }
        expect(methods.prepareProjectStatus({ ...same, status: 'archived' as never }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(0);
    });

    it('accepts sorted-key journals and complete after-row receipts but refuses focus-only or partial states', async () => {
        const rich = project('target', { isFocused: true, supportNotes: 'keep', attachments: [{ id: 'a',
            kind: 'link', title: 'Source', uri: 'https://example.test/', createdAt: now, updatedAt: now }] });
        const { methods, request, saves } = await open({ projects: [rich, project('other')] });
        const input = request('waiting');
        const plan = methods.prepareProjectStatus(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const frozen = JSON.parse(JSON.stringify(sortKeys({ request: input, prepared: plan.value.prepared }))) as
            { request: typeof input; prepared: typeof plan.value.prepared };
        expect(methods.validatePreparedProjectStatus(frozen)).toEqual({ ok: true,
            value: { id: 'target', status: 'waiting', isFocused: false } });
        useTaskStore.setState({ _allProjects: [{ ...rich, status: 'waiting', isFocused: false }, project('other')] });
        expect(await methods.commitPreparedProjectStatus(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [rich, project('other')] });
        expect(await methods.commitPreparedProjectStatus(frozen)).toMatchObject({ ok: true });
        const count = saves();
        useTaskStore.setState((state) => ({ settings: { ...state.settings, deviceId: 'different-device' },
            _allProjects: [...state._allProjects, project('later')] }));
        expect(await methods.commitPreparedProjectStatus(frozen)).toMatchObject({ ok: true,
            value: { id: 'target', status: 'waiting', isFocused: false } });
        expect(saves()).toBe(count);
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, title: 'Later title' } : row) }));
        expect(await methods.commitPreparedProjectStatus(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });

    it('requires exact before-row, including unrelated fields and timestamp collision', async () => {
        const original = project('target', { isFocused: true });
        const { methods, request, saves } = await open({ projects: [original] });
        const input = request('waiting');
        const plan = methods.prepareProjectStatus(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        for (const changed of [{ ...original, color: '#000000' }, { ...original, isFocused: false },
            { ...original, status: 'archived' as const }, { ...original, deletedAt: now },
            { ...original, updatedAt: plan.value.prepared.updateAt, isFocused: false }]) {
            useTaskStore.setState({ _allProjects: [changed] });
            expect(await methods.commitPreparedProjectStatus({ request: input, prepared: plan.value.prepared }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(saves()).toBe(0);
    });

    it('retries failed persistence without another revision and initializes missing device atomically', async () => {
        let failed = true;
        const first = await open({ projects: [project('target', { isFocused: true })], settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request('waiting');
        const plan = first.methods.prepareProjectStatus(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.deviceIdBefore).toBeNull();
        expect(plan.value.prepared.deviceIdToInitialize).toMatch(/^[0-9a-f-]+$/);
        const frozen = { request: input, prepared: plan.value.prepared };
        expect(await first.methods.commitPreparedProjectStatus(frozen)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.data().projects[0].status).toBe('active');
        expect(first.data().settings.deviceId).toBeUndefined();
        failed = false;
        expect(await first.methods.commitPreparedProjectStatus(frozen)).toEqual({ ok: true,
            value: { id: 'target', status: 'waiting', isFocused: false } });
        expect(first.data().projects[0]).toMatchObject({ status: 'waiting', isFocused: false, rev: 4 });
        expect(first.data().settings.deviceId).toBe(plan.value.prepared.deviceIdToInitialize);
        const second = await open(structuredClone(first.data()));
        await flushPendingSave();
        const count = second.saves();
        expect(await second.methods.commitPreparedProjectStatus(frozen)).toMatchObject({ ok: true });
        expect(second.saves()).toBe(count);
    });

    it('rejects forged status, focus, fields, and oversized or malformed requests before writing', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', { isFocused: true })] });
        const input = request('waiting');
        const plan = methods.prepareProjectStatus(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const envelope = { request: input, prepared: plan.value.prepared };
        const missing = structuredClone(envelope);
        (missing.prepared.scope.project as Partial<Project>).tagIds = undefined;
        expect(methods.validatePreparedProjectStatus(missing)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forgedEffect = structuredClone(envelope);
        forgedEffect.prepared.effect.project.after.color = '#000000';
        expect(methods.validatePreparedProjectStatus(forgedEffect)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forgedFocus = structuredClone(envelope);
        forgedFocus.prepared.result.isFocused = true;
        expect(methods.validatePreparedProjectStatus(forgedFocus)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forgedStatus = structuredClone(envelope);
        forgedStatus.prepared.result.status = 'someday';
        expect(methods.validatePreparedProjectStatus(forgedStatus)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectStatus({ ...input, expected: { ...input.expected, isFocused: false } }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(methods.prepareProjectStatus({ ...input, expected: { ...input.expected, title: '漢'.repeat(700_000) } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectStatus({ ...input, requestId: input.requestId.toUpperCase() }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.probeProjectStatusOutcome(input)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });
});
