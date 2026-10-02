import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Area, Project, Section, Task } from './types';

const AT = '2026-10-01T12:00:00.000Z';
const ID = 'project-duplicate';
const REQUEST_ID = '8bebf523-dd4e-40dc-9fce-37e456295d49';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const project = (extra: Partial<Project> = {}): Project => ({ id: ID, title: 'Template', status: 'active',
    color: '#123456', order: 2, tagIds: ['#kept'], supportNotes: 'Keep notes',
    areaId: 'area-live', areaTitle: 'Area', createdAt: AT, updatedAt: AT,
    rev: 7, revBy: 'duplicate-device', ...extra });
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, status: 'next',
    projectId: ID, sectionId: 'section-live', description: 'Keep task text',
    contexts: ['@home'], tags: ['#kept'], createdAt: AT, updatedAt: AT,
    rev: 3, revBy: 'duplicate-device', ...extra });
const area = (): Area => ({ id: 'area-live', name: 'Area', order: 0, createdAt: AT, updatedAt: AT });
const section = (id: string, extra: Partial<Section> = {}): Section => ({ id, projectId: ID,
    title: id, order: 0, createdAt: AT, updatedAt: AT, rev: 2, revBy: 'duplicate-device', ...extra });
const initial = (): AppData => ({
    projects: [project({ attachments: [
        { id: 'project-file', kind: 'file', title: 'Project brief', uri: 'file:///brief.pdf',
            createdAt: AT, updatedAt: AT, cloudKey: 'remote-project', fileHash: 'old-project-hash',
            localStatus: 'available', contentRev: 2, contentMtimeMs: 1234, contentSize: 4096 },
        { id: 'project-deleted-file', kind: 'file', title: 'Deleted file', uri: 'file:///old.pdf',
            createdAt: AT, updatedAt: AT, deletedAt: AT },
    ] }), project({ id: 'same-area', title: 'Other', order: 7 }),
        project({ id: 'other-area', areaId: undefined, areaTitle: undefined, title: 'Outside', order: 30 })],
    sections: [section('section-live'), section('section-deleted', { deletedAt: AT })],
    tasks: [task('reference', { status: 'reference', dueDate: '2030-01-01',
        checklist: [{ id: 'check-one', title: 'Keep checklist', isCompleted: true }],
        attachments: [{ id: 'task-link', kind: 'link', title: 'Link', uri: 'https://example.com',
            createdAt: AT, updatedAt: AT, cloudKey: 'remote-key', fileHash: 'old-hash' }] }),
    task('done', { status: 'done', completedAt: AT }),
    task('deleted', { deletedAt: AT })],
    areas: [area()], people: [], settings: { deviceId: 'duplicate-device', migrations: { version: 1 } },
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
    const request = (requestId = REQUEST_ID) => ({ requestId, projectId: ID,
        projectRevision: value(host.getProjectDetail({ projectId: ID, offset: 0, limit: 20 })).projectRevision });
    const prepare = () => {
        const input = request();
        const plan = value(host.prepareProjectDuplicate(input));
        expect(plan.kind).toBe('prepared');
        return { request: input, prepared: plan.prepared };
    };
    return { host, request, prepare, saves: () => saves, data: () => durable,
        reopen: async () => open(durable, shouldFail, recoveryLoad), state: () => useTaskStore.getState() };
}

afterEach(async () => { await flushPendingSave(); resetForTests(); vi.useRealTimers(); });

describe('prepared Project Duplicate', () => {
    it('copies only live children with RN resets, fresh IDs and same-Area tail order', async () => {
        const env = await open();
        const source = copy(env.data());
        const envelope = env.prepare();
        expect(envelope.prepared.ids).toHaveLength(new Set(envelope.prepared.ids).size);
        expect(value(env.host.validatePreparedProjectDuplicate(envelope))).toEqual(envelope.prepared.result);
        expect(value(await env.host.commitPreparedProjectDuplicate(envelope))).toEqual(envelope.prepared.result);
        const effect = envelope.prepared.effect;
        expect(effect.project).toMatchObject({ id: envelope.prepared.result.id,
            title: 'Template (Copy)', status: 'active', order: 8, isFocused: false,
            supportNotes: 'Keep notes', areaId: 'area-live', rev: 1 });
        expect(effect.project.attachments).toHaveLength(1);
        expect(effect.project.attachments?.[0]).toMatchObject({ title: 'Project brief', uri: 'file:///brief.pdf' });
        expect(effect.project.attachments?.[0].id).not.toBe('project-file');
        for (const key of ['cloudKey', 'fileHash', 'localStatus', 'contentRev',
            'contentMtimeMs', 'contentSize'] as const) {
            expect(effect.project.attachments?.[0][key]).toBeUndefined();
        }
        expect(effect.sections).toHaveLength(1);
        expect(effect.sections[0]).toMatchObject({ title: 'section-live', projectId: effect.project.id, rev: 1 });
        expect(effect.tasks).toHaveLength(2);
        const reference = effect.tasks.find((row) => row.title === 'reference')!;
        expect(reference).toMatchObject({ status: 'reference', sectionId: effect.sections[0].id,
            description: 'Keep task text', pushCount: 0,
            checklist: [{ title: 'Keep checklist', isCompleted: false }] });
        expect(reference.dueDate).toBeUndefined();
        expect(reference.checklist?.[0].id).not.toBe('check-one');
        expect(reference.attachments?.[0]).toMatchObject({ title: 'Link', uri: 'https://example.com' });
        expect(reference.attachments?.[0].id).not.toBe('task-link');
        expect(reference.attachments?.[0].cloudKey).toBeUndefined();
        expect(reference.attachments?.[0].fileHash).toBeUndefined();
        expect(effect.tasks.find((row) => row.title === 'done')).toMatchObject({
            status: 'next', description: 'Keep task text',
        });
        expect(effect.tasks.find((row) => row.title === 'done')?.completedAt).toBeUndefined();
        expect(env.data().projects.filter((row) => row.id !== effect.project.id)).toEqual(source.projects);
        expect(env.data().sections.filter((row) => row.projectId === ID)).toEqual(source.sections);
        expect(env.data().tasks.filter((row) => row.projectId === ID)).toEqual(source.tasks);
        expect(env.saves()).toBe(1);
    });

    it('cold exact-after replay reuses one copy and refuses a later source or copy edit', async () => {
        const env = await open();
        const envelope = env.prepare();
        value(await env.host.commitPreparedProjectDuplicate(envelope));
        const cold = await env.reopen();
        expect(value(await cold.host.commitPreparedProjectDuplicate(envelope))).toEqual(envelope.prepared.result);
        expect(cold.saves()).toBe(0);
        await useTaskStore.getState().updateProject(ID, { supportNotes: 'Later source edit' });
        await flushPendingSave();
        const changed = await cold.reopen();
        expect(await changed.host.commitPreparedProjectDuplicate(envelope)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(changed.saves()).toBe(0);
    });

    it('retries a failed save under the same UUID without changing any copy ID', async () => {
        let fail = false;
        const env = await open(initial(), () => fail);
        const envelope = env.prepare();
        fail = true;
        expect(await env.host.commitPreparedProjectDuplicate(envelope)).toMatchObject({
            ok: false, error: { code: 'SAVE_FAILED' },
        });
        const firstCopy = copy(env.state()._projectsById.get(envelope.prepared.result.id)!);
        fail = false;
        expect(value(await env.host.commitPreparedProjectDuplicate(envelope))).toEqual(envelope.prepared.result);
        expect(env.state()._projectsById.get(firstCopy.id)).toEqual(firstCopy);
        expect(env.state()._allProjects.filter((row) => row.id === firstCopy.id)).toHaveLength(1);
        expect(env.saves()).toBe(1);
    });

    it('rejects stale Area order, child membership and forged IDs before storage', async () => {
        const env = await open();
        const envelope = env.prepare();
        const forged = copy(envelope);
        forged.prepared.ids[0] = ID;
        expect(env.host.validatePreparedProjectDuplicate(forged)).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        expect(await env.host.commitPreparedProjectDuplicate(forged)).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        await useTaskStore.getState().updateProject('same-area', { order: 12 });
        await flushPendingSave();
        expect(await env.host.commitPreparedProjectDuplicate(envelope)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(env.state()._allProjects.filter((row) => row.title === 'Template (Copy)')).toHaveLength(0);

        const fresh = env.prepare();
        await useTaskStore.getState().updateTask('reference', { description: 'Changed source child' });
        await flushPendingSave();
        expect(await env.host.commitPreparedProjectDuplicate(fresh)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
    });

    it('duplicates an archived Project with RN status/date policy and replays under recovery load', async () => {
        const source = initial();
        source.projects[0] = project({ status: 'archived', archivedAt: AT });
        const env = await open(source, () => false, true);
        const envelope = env.prepare();
        const effect = envelope.prepared.effect;
        expect(effect.project).toMatchObject({ status: 'archived', title: 'Template (Copy)',
            archivedAt: envelope.prepared.updateAt });
        expect(effect.tasks.find((row) => row.title === 'reference')?.status).toBe('reference');
        expect(effect.tasks.find((row) => row.title === 'done')?.status).toBe('next');
        value(await env.host.commitPreparedProjectDuplicate(envelope));
        const cold = await env.reopen();
        expect(value(await cold.host.commitPreparedProjectDuplicate(envelope))).toEqual(envelope.prepared.result);
        expect(cold.saves()).toBe(0);
    });

    it('refuses orphan rows already pointing at the reserved new Project ID', async () => {
        const sectionEnv = await open();
        const sectionPlan = sectionEnv.prepare();
        const sectionRow = section('orphan-section', { projectId: sectionPlan.prepared.result.id });
        useTaskStore.setState({ _allSections: [...sectionEnv.state()._allSections, sectionRow] } as never);
        expect(await sectionEnv.host.commitPreparedProjectDuplicate(sectionPlan)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(sectionEnv.state()._projectsById.get(sectionPlan.prepared.result.id)).toBeUndefined();
        expect(sectionEnv.saves()).toBe(0);

        const taskEnv = await open();
        const taskPlan = taskEnv.prepare();
        const taskRow = task('orphan-task', { projectId: taskPlan.prepared.result.id, sectionId: undefined });
        useTaskStore.setState({ _allTasks: [...taskEnv.state()._allTasks, taskRow],
            _tasksById: new Map([...taskEnv.state()._tasksById, [taskRow.id, taskRow]]) } as never);
        expect(await taskEnv.host.commitPreparedProjectDuplicate(taskPlan)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(taskEnv.state()._projectsById.get(taskPlan.prepared.result.id)).toBeUndefined();
        expect(taskEnv.saves()).toBe(0);
    });

    it('matches the actual RN duplicateProject rows after only fresh IDs are normalized', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
        const source = initial();
        const summarize = (projectId: string) => {
            const state = useTaskStore.getState();
            const projectRow = state._projectsById.get(projectId)!;
            const sections = state._allSections.filter((row) => row.projectId === projectId);
            const tasks = state._allTasks.filter((row) => row.projectId === projectId);
            const ids = new Map<string, string>();
            const bind = (id: string) => { ids.set(id, `<new:${ids.size}>`); };
            for (const row of projectRow.attachments ?? []) bind(row.id);
            bind(projectRow.id);
            for (const row of sections) bind(row.id);
            for (const row of tasks) {
                for (const item of row.checklist ?? []) bind(item.id);
                for (const item of row.attachments ?? []) bind(item.id);
                bind(row.id);
            }
            return JSON.parse(JSON.stringify({ project: projectRow, sections, tasks }, (_key, item) =>
                typeof item === 'string' ? ids.get(item) ?? item : item));
        };
        const native = await open(source);
        const prepared = native.prepare();
        value(await native.host.commitPreparedProjectDuplicate(prepared));
        const nativeRows = summarize(prepared.prepared.result.id);

        const rn = await open(source);
        const created = await rn.state().duplicateProject(ID);
        expect(created).not.toBeNull();
        expect(summarize(created!.id)).toEqual(nativeRows);
    });

    it('refuses a changed Area or newly linked Section before the atomic copy', async () => {
        const areaEnv = await open();
        const areaPlan = areaEnv.prepare();
        await useTaskStore.getState().updateArea('area-live', { name: 'Renamed Area' });
        await flushPendingSave();
        expect(await areaEnv.host.commitPreparedProjectDuplicate(areaPlan)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(areaEnv.state()._projectsById.get(areaPlan.prepared.result.id)).toBeUndefined();

        const sectionEnv = await open();
        const sectionPlan = sectionEnv.prepare();
        const added = section('new-source-section');
        useTaskStore.setState({ _allSections: [...sectionEnv.state()._allSections, added] } as never);
        expect(await sectionEnv.host.commitPreparedProjectDuplicate(sectionPlan)).toMatchObject({
            ok: false, error: { code: 'STALE_REVISION' },
        });
        expect(sectionEnv.state()._projectsById.get(sectionPlan.prepared.result.id)).toBeUndefined();
        expect(sectionEnv.saves()).toBe(0);
    });
});
