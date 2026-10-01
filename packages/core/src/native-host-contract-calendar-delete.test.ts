import { afterEach, expect, it, vi } from 'vitest';
import { createCalendarRecorder, loadCalendarViewsFixture, seedCalendarStore } from './calendar-view-model.replay';
import { createNativeHostContract } from './native-host-contract';
import { taskRevisionOf } from './native-request-receipts';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { NativePreparedCalendarDelete } from './native-host-contract-board';
import type { Task } from './types';

const fixture = loadCalendarViewsFixture();
const taskId = 'n-email';
const requestId = '05fe3aca-f264-468e-9792-5a2ad7d2c7f0';
const copy = <T,>(item: T): T => JSON.parse(JSON.stringify(item)) as T;
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const open = async (options: { saveData?: (data: unknown) => Promise<void>; task?: Partial<Task> } = {}) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixture.now));
    const tasks = fixture.tasks.map((task) => task.id === taskId ? {
        ...task, projectId: 'p-launch', startTime: '2026-11-01T15:00:00.000Z',
        dueDate: '2026-11-02T15:00:00.000Z', timeEstimate: '30min' as const,
        checklist: [{ id: 'step-1', title: 'Keep this step', isCompleted: false }],
        attachments: [{ id: 'link-1', kind: 'link' as const, title: 'Keep this link', uri: 'https://example.invalid/',
            createdAt: fixture.now, updatedAt: fixture.now }],
        ...options.task,
    } : task);
    await seedCalendarStore({ ...fixture, tasks }, { name: 'calendar-delete', settings: 'month', actions: [] },
        createCalendarRecorder(), { saveData: options.saveData });
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await host.activate({ writeSafetyReady: true }));
    return host;
};
const request = () => ({ requestId, taskId, taskRevision: taskRevisionOf(useTaskStore.getState()._tasksById.get(taskId)!) });
const prepare = (host: ReturnType<typeof createNativeHostContract>) => {
    const result = value(host.prepareCalendarDelete(request()));
    expect(result.kind).toBe('prepared');
    return { request: result.prepared.request, prepared: result.prepared };
};
const archiveParent = () => useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((project) => project.id === 'p-launch'
    ? { ...project, status: 'archived' as const, rev: (project.rev ?? 0) + 1 } : project) }));
const restartHost = async () => {
    await flushPendingSave();
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await host.activate({ writeSafetyReady: true, recoveryLoad: true }));
    return host;
};

afterEach(async () => {
    await flushPendingSave();
    resetForTests();
    vi.useRealTimers();
});

it('prepares without writes and soft-deletes only the selected task, preserving its metadata', async () => {
    const saveData = vi.fn(async () => undefined);
    const host = await open({ saveData });
    saveData.mockClear();
    const beforeTasks = copy(useTaskStore.getState()._allTasks);
    const command = prepare(host);
    expect(command.prepared.board.request).toEqual({ requestId, action: { type: 'trashTask', taskId } });
    expect(command.prepared.board.prepared.request).toEqual(command.prepared.board.request);
    expect(saveData).not.toHaveBeenCalled();
    expect(useTaskStore.getState()._allTasks).toEqual(beforeTasks);
    expect(value(host.validatePreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
    expect(value(await host.commitPreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
    expect(saveData).toHaveBeenCalledTimes(1);
    const after = useTaskStore.getState()._tasksById.get(taskId)!;
    expect(after.deletedAt).toBe(command.prepared.board.prepared.after.deletedAt);
    expect(after.checklist).toEqual(beforeTasks.find((task) => task.id === taskId)!.checklist);
    expect(after.attachments).toEqual(beforeTasks.find((task) => task.id === taskId)!.attachments);
    expect(after.startTime).toBe(beforeTasks.find((task) => task.id === taskId)!.startTime);
    expect(after.dueDate).toBe(beforeTasks.find((task) => task.id === taskId)!.dueDate);
    expect(useTaskStore.getState()._allTasks.filter((task) => task.id !== taskId)).toEqual(beforeTasks.filter((task) => task.id !== taskId));
});

it('replays the exact deleted row from a fresh adapter but refuses a restored or edited newer row', async () => {
    let persisted: unknown = null;
    const host = await open({ saveData: async (data) => { persisted = copy(data); } });
    const command = prepare(host);
    value(await host.commitPreparedCalendarDelete(command));
    resetForTests();
    setStorageAdapter({ getData: async () => copy(persisted), saveData: async (data) => { persisted = copy(data); } });
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const restarted = await restartHost();
    expect(value(await restarted.commitPreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
    await useTaskStore.getState().restoreTask(taskId);
    expect(await (await restartHost()).commitPreparedCalendarDelete(command)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    await useTaskStore.getState().updateTask(taskId, { title: 'Changed after restore' });
    expect(await (await restartHost()).commitPreparedCalendarDelete(command)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.title).toBe('Changed after restore');
    await useTaskStore.getState().deleteTask(taskId);
    const newerDelete = useTaskStore.getState()._tasksById.get(taskId)!;
    expect(newerDelete.rev).toBeGreaterThan(command.prepared.board.prepared.after.rev);
    expect(await (await restartHost()).commitPreparedCalendarDelete(command)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.rev).toBe(newerDelete.rev);
});

it('refuses a parent archived after preparation but replays after an acknowledged delete and later archive', async () => {
    const host = await open();
    const blocked = prepare(host);
    archiveParent();
    expect(await host.commitPreparedCalendarDelete(blocked)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.deletedAt).toBeUndefined();
    useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((project) => project.id === 'p-launch'
        ? { ...project, status: 'active' as const, rev: (project.rev ?? 0) + 1 } : project) }));
    const command = prepare(host);
    value(await host.commitPreparedCalendarDelete(command));
    archiveParent();
    const beforeReplay = copy(useTaskStore.getState()._allTasks);
    const restarted = createNativeHostContract();
    value(await restarted.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await restarted.activate({ writeSafetyReady: true }));
    expect(value(await restarted.commitPreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
    expect(useTaskStore.getState()._allTasks).toEqual(beforeReplay);
});

it('retries an owed save without a second deletion, then accepts a fresh host replay', async () => {
    const saveData = vi.fn(async () => undefined);
    const host = await open({ saveData });
    const command = prepare(host);
    saveData.mockRejectedValue(new Error('disk unavailable'));
    expect(await host.commitPreparedCalendarDelete(command)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
    const optimistic = copy(useTaskStore.getState()._tasksById.get(taskId)!);
    saveData.mockResolvedValue(undefined);
    expect(value(await host.commitPreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
    expect(useTaskStore.getState()._tasksById.get(taskId)).toEqual(optimistic);
    const restarted = createNativeHostContract();
    value(await restarted.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await restarted.activate({ writeSafetyReady: true }));
    expect(value(await restarted.commitPreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
});

it('reapplies the original journal after a failed save and cold store reload', async () => {
    const saveData = vi.fn(async () => undefined);
    const host = await open({ saveData });
    const state = useTaskStore.getState();
    const durableBefore = copy({ tasks: state._allTasks, projects: state._allProjects, sections: state._allSections,
        areas: state._allAreas, people: state._allPeople, settings: state.settings });
    const command = prepare(host);
    saveData.mockRejectedValue(new Error('disk unavailable'));
    expect(await host.commitPreparedCalendarDelete(command)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
    resetForTests();
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, persistenceFailure: null, error: null, editLockCount: 0, lastDataChangeAt: 0 });
    let persisted: unknown = durableBefore;
    setStorageAdapter({ getData: async () => copy(persisted), saveData: async (data) => { persisted = copy(data); } });
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const restarted = await restartHost();
    expect(value(await restarted.commitPreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.rev).toBe(command.prepared.board.prepared.after.rev);
    expect(persisted).not.toEqual(durableBefore);
});

it('validates the nested Board authority before activation, without store reads', async () => {
    const host = await open();
    const command = prepare(host);
    resetForTests();
    const detached = createNativeHostContract();
    const read = vi.spyOn(useTaskStore, 'getState').mockImplementation(() => { throw new Error('No store reads'); });
    try {
        expect(value(detached.validatePreparedCalendarDelete(command))).toEqual({ changed: true, open: null });
        const mutations: ((item: { request: typeof command.request; prepared: NativePreparedCalendarDelete }) => void)[] = [
            (item) => { item.request.taskRevision = 'forged'; },
            (item) => { item.prepared.board.request.action.taskId = 'other'; },
            (item) => { item.prepared.board.prepared.request.action.type = 'duplicateTask'; },
            (item) => { item.prepared.board.prepared.after.title = 'forged'; },
            (item) => { item.prepared.board.prepared.after.rev += 1; },
            (item) => { item.prepared.board.prepared.result.changed = false; },
            (item) => { item.prepared.version = 2 as 1; },
            (item) => { Object.assign(item.prepared, { extra: true }); },
        ];
        for (const mutate of mutations) {
            const forged = copy(command);
            mutate(forged);
            expect(detached.validatePreparedCalendarDelete(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(await detached.commitPreparedCalendarDelete(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        const oversized = copy(command);
        oversized.prepared.board.prepared.before.description = 'é'.repeat(1_000_001);
        expect(detached.validatePreparedCalendarDelete(oversized)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    } finally { read.mockRestore(); }
});

it('refuses stale, deleted, reference, projected, archived-parent, and missing requests at preparation', async () => {
    const host = await open();
    const current = request();
    expect(host.prepareCalendarDelete({ ...current, taskRevision: 'old' })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(host.prepareCalendarDelete({ ...current, taskId: 'missing' })).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
    expect(host.prepareCalendarDelete({ ...current, taskId: `${taskId}:projected-recurrence` })).toMatchObject({ ok: false });
    archiveParent();
    expect(host.prepareCalendarDelete(current)).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
    useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((project) => project.id === 'p-launch'
        ? { ...project, status: 'active' as const } : project) }));
    useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((task) => task.id === taskId
        ? { ...task, status: 'reference' as const } : task) }));
    expect(host.prepareCalendarDelete(request())).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
    useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((task) => task.id === taskId
        ? { ...task, status: 'next' as const, deletedAt: fixture.now } : task) }));
    expect(host.prepareCalendarDelete(request())).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
});
