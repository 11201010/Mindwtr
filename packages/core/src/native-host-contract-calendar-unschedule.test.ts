import { afterEach, expect, it, vi } from 'vitest';
import { createCalendarRecorder, loadCalendarViewsFixture, seedCalendarStore } from './calendar-view-model.replay';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { taskRevisionOf } from './native-request-receipts';
import type { Task } from './types';

const fixture = loadCalendarViewsFixture();
const taskId = 'n-email';
const startTime = '2026-11-01T15:00:00.000Z';
const requestId = '84182b7a-b4e9-461f-96bf-1b0d88e2ef91';
const copy = <T,>(item: T): T => JSON.parse(JSON.stringify(item)) as T;
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const open = async (options: { saveData?: (data: unknown) => Promise<void>; task?: Partial<Task> } = {}) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixture.now));
    const tasks = fixture.tasks.map((task) => task.id === taskId ? {
        ...task, startTime, dueDate: '2026-11-02T15:00:00.000Z', timeEstimate: '30min' as const,
        ...options.task,
    } : task);
    await seedCalendarStore({ ...fixture, tasks }, { name: 'unschedule', settings: 'month', actions: [] },
        createCalendarRecorder(), { saveData: options.saveData });
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await host.activate({ writeSafetyReady: true }));
    return host;
};
const request = () => ({ requestId, taskId, taskRevision: taskRevisionOf(useTaskStore.getState()._tasksById.get(taskId)!) });
const prepare = async (host: ReturnType<typeof createNativeHostContract>) => {
    const answer = value(await host.prepareCalendarUnschedule(request()));
    expect(answer.kind).toBe('prepared');
    if (answer.kind !== 'prepared') throw new Error('Expected prepared Unschedule');
    return { request: answer.prepared.request, prepared: answer.prepared };
};

afterEach(async () => {
    await flushPendingSave();
    resetForTests();
    vi.useRealTimers();
});

it('prepares without writing, then clears the start through the shared policy while preserving due date and estimate', async () => {
    const saveData = vi.fn(async () => undefined);
    const recurrence = fixture.tasks.find((task) => task.id === 't-water')!.recurrence;
    const host = await open({ saveData, task: { recurrence } });
    saveData.mockClear();
    const before = copy(useTaskStore.getState()._tasksById.get(taskId)!);
    const command = await prepare(host);
    expect(saveData).not.toHaveBeenCalled();
    expect(useTaskStore.getState()._tasksById.get(taskId)).toEqual(before);
    expect(value(host.validatePreparedCalendarUnschedule(command))).toEqual(command.prepared.result);
    expect(value(await host.commitPreparedCalendarUnschedule(command))).toEqual(command.prepared.result);
    expect(saveData).toHaveBeenCalledTimes(1);
    const after = useTaskStore.getState()._tasksById.get(taskId)!;
    expect(after.startTime).toBeUndefined();
    expect(after.dueDate).toBe(before.dueDate);
    expect(after.timeEstimate).toBe(before.timeEstimate);
    expect(after.recurrence).toEqual(before.recurrence);
    expect(after.title).toBe(before.title);
    expect(after.status).toBe(before.status);
    expect(after.rev).toBe(command.prepared.after.rev);
    expect(value(await host.commitPreparedCalendarUnschedule(command))).toEqual(command.prepared.result);
    expect(saveData).toHaveBeenCalledTimes(1);
});

it('replays from a fresh store adapter and refuses a later same-value revision', async () => {
    let persisted: unknown = null;
    const host = await open({ saveData: async (data) => { persisted = copy(data); } });
    const command = await prepare(host);
    value(await host.commitPreparedCalendarUnschedule(command));
    expect(persisted).not.toBeNull();
    resetForTests();
    setStorageAdapter({ getData: async () => copy(persisted), saveData: async (data) => { persisted = copy(data); } });
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const restarted = createNativeHostContract();
    value(await restarted.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await restarted.activate({ writeSafetyReady: true }));
    expect(value(await restarted.commitPreparedCalendarUnschedule(command))).toEqual(command.prepared.result);
    await useTaskStore.getState().updateTask(taskId, { startTime });
    await useTaskStore.getState().updateTask(taskId, { startTime: undefined });
    const newer = useTaskStore.getState()._tasksById.get(taskId)!;
    expect(newer.startTime).toBeUndefined();
    expect(newer.rev).toBeGreaterThan(command.prepared.after.rev);
    expect(await restarted.commitPreparedCalendarUnschedule(command)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.rev).toBe(newer.rev);
});

it('refuses a later rename or delete rather than resurrecting the old row', async () => {
    const host = await open();
    const command = await prepare(host);
    value(await host.commitPreparedCalendarUnschedule(command));
    await useTaskStore.getState().updateTask(taskId, { title: 'Renamed after Unschedule' });
    expect(await host.commitPreparedCalendarUnschedule(command)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.title).toBe('Renamed after Unschedule');
    await useTaskStore.getState().deleteTask(taskId);
    expect(await host.commitPreparedCalendarUnschedule(command)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.deletedAt).toBeTruthy();
});

it('retries a failed save with its original stamp', async () => {
    const saveData = vi.fn(async () => undefined);
    const host = await open({ saveData });
    const command = await prepare(host);
    saveData.mockRejectedValue(new Error('disk unavailable'));
    expect(await host.commitPreparedCalendarUnschedule(command)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
    expect(useTaskStore.getState()._tasksById.get(taskId)?.rev).toBe(command.prepared.after.rev);
    saveData.mockResolvedValue(undefined);
    expect(value(await host.commitPreparedCalendarUnschedule(command))).toEqual(command.prepared.result);
    expect(useTaskStore.getState()._tasksById.get(taskId)?.rev).toBe(command.prepared.after.rev);
});

it('reapplies the journal after a failed save and a cold store reload', async () => {
    const saveData = vi.fn(async () => undefined);
    const host = await open({ saveData });
    const state = useTaskStore.getState();
    const durableBefore = copy({ tasks: state._allTasks, projects: state._allProjects, sections: state._allSections,
        areas: state._allAreas, people: state._allPeople, settings: state.settings });
    const command = await prepare(host);
    saveData.mockRejectedValue(new Error('disk unavailable'));
    expect(await host.commitPreparedCalendarUnschedule(command)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
    resetForTests();
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, persistenceFailure: null, error: null, editLockCount: 0, lastDataChangeAt: 0 });
    let persisted: unknown = durableBefore;
    setStorageAdapter({ getData: async () => copy(persisted), saveData: async (data) => { persisted = copy(data); } });
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const restarted = createNativeHostContract();
    value(await restarted.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await restarted.activate({ writeSafetyReady: true }));
    expect(value(await restarted.commitPreparedCalendarUnschedule(command))).toEqual(command.prepared.result);
    expect(useTaskStore.getState()._tasksById.get(taskId)?.rev).toBe(command.prepared.after.rev);
    expect(persisted).not.toEqual(durableBefore);
});

it('rejects malformed journal changes before SQLite/store readiness', async () => {
    const host = await open();
    const command = await prepare(host);
    resetForTests();
    vi.setSystemTime(new Date('2037-01-01T01:00:00.000Z'));
    const detached = createNativeHostContract();
    expect(value(detached.validatePreparedCalendarUnschedule(command))).toEqual(command.prepared.result);
    const mutations = [
        (item: typeof command) => { item.request.requestId = '24182b7a-b4e9-461f-96bf-1b0d88e2ef91'; },
        (item: typeof command) => { item.request.taskRevision = '1:forged:date'; },
        (item: typeof command) => { item.prepared.after.title = 'forged'; },
        (item: typeof command) => { item.prepared.after.rev += 1; },
        (item: typeof command) => { item.prepared.policy.normalizedUpdates.status = 'done'; },
        (item: typeof command) => { item.prepared.policy.endOfLocalTodayUTC = '2037-01-01T23:59:59.999Z'; },
        (item: typeof command) => { item.prepared.result.changed = false; },
        (item: typeof command) => { item.prepared.result.taskId = 'other'; },
        (item: typeof command) => { item.prepared.kind = 'other' as 'unschedule'; },
    ];
    for (const mutate of mutations) {
        const forged = copy(command);
        mutate(forged);
        expect(detached.validatePreparedCalendarUnschedule(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await detached.commitPreparedCalendarUnschedule(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    const oversized = copy(command);
    oversized.prepared.before.description = 'é'.repeat(1_000_001);
    expect(detached.validatePreparedCalendarUnschedule(oversized)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('validates the view revision before no-op and refuses projected, archived, or missing targets', async () => {
    const host = await open({ task: { startTime: undefined } });
    const current = request();
    expect(value(await host.prepareCalendarUnschedule(current))).toEqual({ kind: 'noop', result: {
        taskId, changed: false, toast: null, next: null, scrollToMinutes: null, composer: null,
    } });
    expect(await host.prepareCalendarUnschedule({ ...current, taskRevision: 'old' })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(await host.prepareCalendarUnschedule({ ...current, taskId: `${taskId}:projected-recurrence` })).toMatchObject({ ok: false });
    expect(await host.prepareCalendarUnschedule({ ...current, taskId: 'missing' })).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
    const archived = useTaskStore.getState()._tasksById.get(taskId)!;
    useTaskStore.setState({ _allTasks: useTaskStore.getState()._allTasks.map((task) => task.id === taskId
        ? { ...archived, projectId: 'p-shipped', startTime } : task) });
    const archivedRequest = request();
    expect(await host.prepareCalendarUnschedule(archivedRequest)).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
});
