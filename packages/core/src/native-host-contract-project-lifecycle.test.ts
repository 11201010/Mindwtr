import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Project, Section, Task } from './types';

const AT = '2026-10-01T12:00:00.000Z';
const ID = 'project-lifecycle';
const COMPLETE_ID = '8bebf523-dd4e-40dc-9fce-37e456295d49';
const REACTIVATE_ID = '9bebf523-dd4e-40dc-9fce-37e456295d49';
const CANCEL_ID = 'abebf523-dd4e-40dc-9fce-37e456295d49';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const project = (extra: Partial<Project> = {}): Project => ({ id: ID, title: 'Saved Project',
    status: 'active', color: '#123456', order: 0, tagIds: ['#kept'], supportNotes: 'Keep notes',
    createdAt: AT, updatedAt: AT, rev: 7, revBy: 'lifecycle-device', ...extra });
const section = (id: string, extra: Partial<Section> = {}): Section => ({ id, projectId: ID,
    title: id, order: 0, createdAt: AT, updatedAt: AT, rev: 2, revBy: 'lifecycle-device', ...extra });
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, status: 'next',
    projectId: ID, sectionId: 'section-live', description: 'Keep text',
    tags: ['#kept'], contexts: ['@home'], createdAt: AT, updatedAt: AT,
    rev: 3, revBy: 'lifecycle-device', ...extra });
const initial = (): AppData => ({
    projects: [project(), project({ id: 'foreign-project', title: 'Foreign' })],
    sections: [section('section-live'), section('section-old', { deletedAt: AT })],
    tasks: [task('next'), task('waiting', { status: 'waiting' }),
        task('someday', { status: 'someday' }),
        task('reference', { status: 'reference', checklist: [{ id: 'check', title: 'Keep', isCompleted: true }],
            recurrence: { rule: 'daily', strategy: 'strict' },
            attachments: [{ id: 'link', kind: 'link', title: 'Link', uri: 'https://example.com',
                createdAt: AT, updatedAt: AT }] }),
        task('done', { status: 'done', completedAt: AT }),
        task('archived', { status: 'archived', archivedAt: AT }),
        task('deleted', { deletedAt: AT }),
        task('section-only', { projectId: undefined }),
        task('foreign', { projectId: 'foreign-project' })],
    areas: [], people: [], settings: { deviceId: 'lifecycle-device', migrations: { version: 1 } },
});

async function open(start: AppData = initial(), shouldFail: () => boolean = () => false,
    recoveryLoad = false) {
    await flushPendingSave(); resetForTests();
    let durable = copy(start);
    let saves = 0;
    setStorageAdapter({ getData: async () => copy(durable), saveData: async (next) => {
        if (shouldFail()) throw new Error('disk unavailable');
        durable = copy(next); saves += 1;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0,
        lastDataChangeAt: 0 } as never);
    const host = createNativeHostContract();
    value(await host.activate({ writeSafetyReady: true, recoveryLoad }));
    await flushPendingSave(); saves = 0;
    const request = (action: 'complete' | 'reactivate' | 'cancel', requestId = action === 'complete'
        ? COMPLETE_ID : action === 'reactivate' ? REACTIVATE_ID : CANCEL_ID) =>
        ({ requestId, projectId: ID, action,
            projectRevision: value(host.getProjectDetail({ projectId: ID, offset: 0, limit: 20 })).projectRevision });
    const prepare = (action: 'complete' | 'reactivate' | 'cancel') => {
        const input = request(action);
        const plan = value(host.prepareProjectLifecycle(input));
        expect(plan.kind).toBe('prepared');
        return { request: input, prepared: plan.prepared };
    };
    return { host, request, prepare, state: () => useTaskStore.getState(), data: () => durable,
        saves: () => saves, reopen: async () => open(durable, shouldFail, recoveryLoad) };
}

// A peer can edit a child while its Project is archived, even though local UI edits are disabled.
async function peerEditTask(id: string, updates: Partial<Task>) {
    const state = useTaskStore.getState();
    useTaskStore.setState({ _allTasks: state._allTasks.map((row) => row.id === id
        ? { ...row, ...updates, updatedAt: '2026-10-03T12:00:00.000Z', rev: (row.rev ?? 0) + 1 }
        : row) });
    await useTaskStore.getState().persistSnapshot();
    await flushPendingSave();
}

afterEach(async () => { await flushPendingSave(); resetForTests(); vi.useRealTimers(); });

describe('prepared Project Complete and Reactivate', () => {
    it.each(['waiting', 'someday'] as const)('completes a live %s Project using the same archived lifecycle', async (status) => {
        const source = initial();
        source.projects[0] = project({ status });
        const env = await open(source);
        const complete = env.prepare('complete');
        expect(value(await env.host.commitPreparedProjectLifecycle(complete))).toEqual({ id: ID, status: 'archived' });
        expect(env.state()._projectsById.get(ID)?.status).toBe('archived');
        expect(env.state()._tasksById.get('next')?.status).toBe('done');
    });

    it('completes owned unfinished children once without recurrence or foreign adoption', async () => {
        const env = await open();
        const envelope = env.prepare('complete');
        expect(envelope.prepared.scope.tasks.map((row) => row.id)).toContain('section-only');
        expect(envelope.prepared.scope.tasks.map((row) => row.id)).not.toContain('foreign');
        expect(value(env.host.validatePreparedProjectLifecycle(envelope))).toEqual({ id: ID, status: 'archived' });
        expect(value(await env.host.commitPreparedProjectLifecycle(envelope))).toEqual({ id: ID, status: 'archived' });
        const state = env.state();
        expect(state._projectsById.get(ID)).toMatchObject({ status: 'archived', isFocused: false,
            supportNotes: 'Keep notes' });
        for (const id of ['next', 'waiting', 'someday', 'section-only']) {
            expect(state._tasksById.get(id)).toMatchObject({ status: 'done', projectId: ID,
                description: 'Keep text' });
        }
        expect(state._tasksById.get('reference')).toMatchObject({ status: 'reference',
            checklist: [{ id: 'check', title: 'Keep', isCompleted: true }],
            recurrence: { rule: 'daily', strategy: 'strict' } });
        expect(state._tasksById.get('foreign')?.projectId).toBe('foreign-project');
        expect(state._tasksById.get('deleted')?.deletedAt).toBe(AT);
        expect(state._allTasks).toHaveLength(initial().tasks.length);
        expect(state._allSections.find((row) => row.id === 'section-live')?.projectArchivedAt).toBeTruthy();
        expect(state._allSections.find((row) => row.id === 'section-old')?.deletedAt).toBe(AT);
        expect(env.saves()).toBe(1);
    });

    it('reactivates exact completed children but retains independent archived/deleted history', async () => {
        const env = await open();
        const complete = env.prepare('complete');
        value(await env.host.commitPreparedProjectLifecycle(complete));
        const reactivate = env.prepare('reactivate');
        expect(value(await env.host.commitPreparedProjectLifecycle(reactivate))).toEqual({ id: ID, status: 'active' });
        const state = env.state();
        expect(state._projectsById.get(ID)).toMatchObject({ status: 'active', supportNotes: 'Keep notes' });
        expect(state._projectsById.get(ID)?.archivedAt).toBeUndefined();
        for (const [id, status] of [['next', 'next'], ['waiting', 'waiting'],
            ['someday', 'someday'], ['section-only', 'next']] as const) {
            expect(state._tasksById.get(id)?.status).toBe(status);
            expect(state._tasksById.get(id)?.projectArchivedAt).toBeUndefined();
        }
        expect(state._tasksById.get('reference')?.status).toBe('reference');
        expect(state._tasksById.get('done')?.status).toBe('done');
        expect(state._tasksById.get('archived')?.status).toBe('archived');
        expect(state._tasksById.get('deleted')?.deletedAt).toBe(AT);
        expect(state._allSections.find((row) => row.id === 'section-live')?.deletedAt).toBeUndefined();
        expect(state._allSections.find((row) => row.id === 'section-old')?.deletedAt).toBe(AT);
        expect(env.saves()).toBe(2);
    });

    it('accepts legacy null Section archive proof and preserves an edited child on Reactivate', async () => {
        const source = initial();
        source.projects[0] = project({ status: 'archived', archivedAt: AT, cancelledAt: AT });
        source.sections[0] = section('section-live', { deletedAt: AT, updatedAt: AT,
            projectArchivedAt: AT, deletedAtBeforeProjectArchive: null as unknown as undefined });
        source.tasks[0] = task('next', { status: 'done', completedAt: AT, archivedAt: AT,
            projectArchivedAt: AT, statusBeforeProjectArchive: 'next', updatedAt: AT });
        source.tasks[1] = task('waiting', { status: 'done', completedAt: AT, archivedAt: AT,
            projectArchivedAt: AT, statusBeforeProjectArchive: 'waiting',
            updatedAt: '2026-10-01T13:00:00.000Z' });
        const env = await open(source, () => false, true);
        const envelope = env.prepare('reactivate');
        expect(value(env.host.validatePreparedProjectLifecycle(envelope))).toEqual({ id: ID, status: 'active' });
        value(await env.host.commitPreparedProjectLifecycle(envelope));
        expect(env.state()._projectsById.get(ID)?.cancelledAt).toBeUndefined();
        expect(env.state()._tasksById.get('next')?.status).toBe('next');
        expect(env.state()._tasksById.get('waiting')).toMatchObject({ status: 'done',
            completedAt: AT, updatedAt: '2026-10-01T13:00:00.000Z' });
        expect(env.state()._allSections.find((row) => row.id === 'section-live')?.deletedAt).toBeUndefined();
    });

    it('cold exact-after replay acknowledges both transitions without rewriting later edits', async () => {
        const env = await open();
        const complete = env.prepare('complete');
        value(await env.host.commitPreparedProjectLifecycle(complete));
        const archived = await env.reopen();
        expect(value(await archived.host.commitPreparedProjectLifecycle(complete))).toEqual({ id: ID, status: 'archived' });
        expect(archived.saves()).toBe(0);
        const reactivate = archived.prepare('reactivate');
        value(await archived.host.commitPreparedProjectLifecycle(reactivate));
        const active = await archived.reopen();
        expect(value(await active.host.commitPreparedProjectLifecycle(reactivate))).toEqual({ id: ID, status: 'active' });
        expect(active.saves()).toBe(0);
        await useTaskStore.getState().updateTask('next', { description: 'Later saved edit' });
        await flushPendingSave();
        const changed = await active.reopen();
        expect(await changed.host.commitPreparedProjectLifecycle(reactivate)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(changed.saves()).toBe(0);
    });

    it('retries a failed durable Complete save with the same UUID and row stamps', async () => {
        let fail = false;
        const env = await open(initial(), () => fail);
        const complete = env.prepare('complete');
        fail = true;
        expect(await env.host.commitPreparedProjectLifecycle(complete)).toMatchObject({
            ok: false, error: { code: 'SAVE_FAILED' },
        });
        const stamped = copy(env.state()._projectsById.get(ID)!);
        fail = false;
        expect(value(await env.host.commitPreparedProjectLifecycle(complete))).toEqual({ id: ID, status: 'archived' });
        expect(env.state()._projectsById.get(ID)).toEqual(stamped);
        expect(env.saves()).toBe(1);
    });

    it('refuses forged effects and changed child membership before a write', async () => {
        const env = await open();
        const complete = env.prepare('complete');
        const forged = copy(complete);
        forged.prepared.effect.project.after.title = 'Forged title';
        expect(env.host.validatePreparedProjectLifecycle(forged)).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        expect(await env.host.commitPreparedProjectLifecycle(forged)).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        expect(env.saves()).toBe(0);
        const added = task('new-owned');
        useTaskStore.setState({ _allTasks: [...env.state()._allTasks, added],
            _tasksById: new Map([...env.state()._tasksById, [added.id, added]]) } as never);
        expect(await env.host.commitPreparedProjectLifecycle(complete)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(env.state()._projectsById.get(ID)?.status).toBe('active');
        expect(env.saves()).toBe(0);
    });

    it('matches RN updateProject rows exactly for Complete and Reactivate', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
        const source = initial();
        const snapshot = () => copy({ projects: useTaskStore.getState()._allProjects,
            tasks: useTaskStore.getState()._allTasks, sections: useTaskStore.getState()._allSections });
        const native = await open(source);
        value(await native.host.commitPreparedProjectLifecycle(native.prepare('complete')));
        const nativeCompleted = snapshot();
        value(await native.host.commitPreparedProjectLifecycle(native.prepare('reactivate')));
        const nativeReactivated = snapshot();

        const rn = await open(source);
        expect(await rn.state().updateProject(ID, { status: 'archived' })).toMatchObject({ success: true });
        expect(snapshot()).toEqual(nativeCompleted);
        expect(await rn.state().updateProject(ID, { status: 'active' })).toMatchObject({ success: true });
        expect(snapshot()).toEqual(nativeReactivated);
    });
});

describe('prepared Project Cancel', () => {
    it('matches RN cancelProject whole rows with one frozen clock and distinct Complete semantics', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
        const source = initial();
        source.tasks[0] = task('next', { isFocusedToday: true, focusOrder: 4,
            recurrence: { rule: 'daily', strategy: 'strict' },
            checklist: [{ id: 'step', title: 'Keep checklist', isCompleted: false }],
            attachments: [{ id: 'file', kind: 'link', title: 'Keep link', uri: 'https://example.com/keep',
                createdAt: AT, updatedAt: AT }] });
        source.tasks.push(task('inbox', { status: 'inbox' }));
        source.tasks[5] = task('archived', { status: 'archived', cancelledAt: AT, archivedAt: AT });
        const snapshot = () => copy({ projects: useTaskStore.getState()._allProjects,
            tasks: useTaskStore.getState()._allTasks, sections: useTaskStore.getState()._allSections });

        const native = await open(source);
        const cancelled = native.prepare('cancel');
        const at = cancelled.prepared.updateAt;
        expect(Object.keys(cancelled.prepared).sort()).toEqual([
            'deviceIdBefore', 'deviceIdToInitialize', 'effect', 'request', 'result', 'scope', 'updateAt', 'version',
        ]);
        expect(cancelled.prepared.result).toEqual({ id: ID, status: 'archived' });
        expect(cancelled.prepared.effect.project.after).toMatchObject({ status: 'archived',
            cancelledAt: at, archivedAt: at, updatedAt: at });
        expect(value(native.host.validatePreparedProjectLifecycle(cancelled))).toEqual({ id: ID, status: 'archived' });
        expect(value(await native.host.commitPreparedProjectLifecycle(cancelled))).toEqual({ id: ID, status: 'archived' });
        const nativeRows = snapshot();
        for (const id of ['next', 'waiting', 'someday', 'inbox', 'section-only']) {
            const saved = native.state()._tasksById.get(id);
            expect(saved).toMatchObject({ status: 'archived', cancelledAt: at, archivedAt: at,
                projectArchivedAt: at, updatedAt: at, projectId: ID });
            expect(saved?.completedAt).toBeUndefined();
        }
        expect(native.state()._tasksById.get('next')).toMatchObject({
            recurrence: { rule: 'daily', strategy: 'strict' }, isFocusedToday: false,
            checklist: [{ id: 'step', title: 'Keep checklist', isCompleted: false }],
            attachments: [{ id: 'file', uri: 'https://example.com/keep' }],
        });
        expect(native.state()._tasksById.get('reference')?.status).toBe('reference');
        expect(native.state()._tasksById.get('done')).toMatchObject({ status: 'done', completedAt: AT });
        expect(native.state()._tasksById.get('archived')).toMatchObject({ status: 'archived', cancelledAt: AT });
        expect(native.state()._tasksById.get('deleted')?.deletedAt).toBe(AT);
        expect(native.state()._tasksById.get('foreign')?.projectId).toBe('foreign-project');
        expect(native.state()._allTasks).toHaveLength(source.tasks.length);

        const rn = await open(source);
        expect(await rn.state().cancelProject(ID)).toEqual({ success: true, id: ID });
        expect(snapshot()).toEqual(nativeRows);
        const complete = await open(source);
        const completed = complete.prepare('complete');
        expect(completed.prepared.effect.project.after.cancelledAt).toBeUndefined();
        expect(completed.prepared.effect.tasks.find((pair) => pair.before.id === 'next')?.after.status).toBe('done');
    });

    it('reactivates untouched cancelled children while retaining later edits and unequal old clocks', async () => {
        const env = await open();
        const cancelled = env.prepare('cancel');
        value(await env.host.commitPreparedProjectLifecycle(cancelled));
        await peerEditTask('waiting', { title: 'Later independent edit' });
        const reactivate = env.prepare('reactivate');
        value(await env.host.commitPreparedProjectLifecycle(reactivate));
        expect(env.state()._projectsById.get(ID)).toMatchObject({ status: 'active', cancelledAt: undefined });
        expect(env.state()._tasksById.get('next')).toMatchObject({ status: 'next', cancelledAt: undefined,
            projectArchivedAt: undefined });
        expect(env.state()._tasksById.get('waiting')).toMatchObject({ status: 'archived',
            cancelledAt: cancelled.prepared.updateAt, title: 'Later independent edit' });
        expect(env.state()._tasksById.get('done')).toMatchObject({ status: 'done', completedAt: AT });
        expect(env.state()._sectionsById.get('section-live')?.deletedAt).toBeUndefined();

        const old = initial();
        const later = '2026-10-01T12:00:01.000Z';
        old.projects[0] = project({ status: 'archived', cancelledAt: AT, archivedAt: later, updatedAt: later });
        old.tasks[0] = task('next', { status: 'archived', cancelledAt: AT, archivedAt: later,
            projectArchivedAt: later, statusBeforeProjectArchive: 'next', updatedAt: later });
        old.sections[0] = section('section-live', { deletedAt: later, projectArchivedAt: later,
            updatedAt: later, deletedAtBeforeProjectArchive: null as unknown as undefined });
        const legacy = await open(old, () => false, true);
        const restored = legacy.prepare('reactivate');
        expect(value(legacy.host.validatePreparedProjectLifecycle(restored))).toEqual({ id: ID, status: 'active' });
        value(await legacy.host.commitPreparedProjectLifecycle(restored));
        expect(legacy.state()._tasksById.get('next')).toMatchObject({ status: 'next', cancelledAt: undefined });
        expect(legacy.state()._sectionsById.get('section-live')?.deletedAt).toBeUndefined();
    });

    it('retries failed Cancel with frozen stamps, then cold-acknowledges exact after-state only', async () => {
        let fail = false;
        const env = await open(initial(), () => fail);
        const cancelled = env.prepare('cancel');
        fail = true;
        expect(await env.host.commitPreparedProjectLifecycle(cancelled)).toMatchObject({
            ok: false, error: { code: 'SAVE_FAILED' },
        });
        const savedStamp = copy(env.state()._projectsById.get(ID)!);
        fail = false;
        expect(value(await env.host.commitPreparedProjectLifecycle(cancelled))).toEqual({ id: ID, status: 'archived' });
        expect(env.state()._projectsById.get(ID)).toEqual(savedStamp);
        const cold = await env.reopen();
        expect(value(await cold.host.commitPreparedProjectLifecycle(cancelled))).toEqual({ id: ID, status: 'archived' });
        expect(cold.saves()).toBe(0);
        await peerEditTask('next', { description: 'Changed after acknowledgement' });
        const changed = await cold.reopen();
        expect(await changed.host.commitPreparedProjectLifecycle(cancelled)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(changed.saves()).toBe(0);
    });

    it('rejects forged cancellation effects and an archived source before any write', async () => {
        const env = await open();
        const cancelled = env.prepare('cancel');
        const forged = copy(cancelled);
        forged.prepared.effect.project.after.cancelledAt = AT;
        expect(env.host.validatePreparedProjectLifecycle(forged)).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        expect(await env.host.commitPreparedProjectLifecycle(forged)).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        expect(env.saves()).toBe(0);
        value(await env.host.commitPreparedProjectLifecycle(cancelled));
        expect(env.host.prepareProjectLifecycle(env.request('cancel', 'bbebf523-dd4e-40dc-9fce-37e456295d49')))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });
});
