import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, NATIVE_HOST_MAX_WINDOW } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { noopStorage, type StorageAdapter } from './storage';
import type { Project, Task } from './types';

const CAPTURE_ID = '123e4567-e89b-12d3-a456-426614174000';

const task = (id: string, createdAt: string, extra: Partial<Task> = {}): Task => ({
    id,
    title: id,
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt,
    updatedAt: createdAt,
    ...extra,
});

describe('native host contract', () => {
    let saveData: ReturnType<typeof vi.fn>;
    let getData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        getData = vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} });
        setStorageAdapter({
            getData,
            saveData,
        } satisfies StorageAdapter);
        useTaskStore.setState({
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
        });
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });

    it('pages deterministic visible Inbox rows and rejects a stale revision after order or membership changes', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        useTaskStore.setState({ _allTasks: [
            task('later', '2026-09-03T00:00:00.000Z'),
            task('first', '2026-09-01T00:00:00.000Z'),
            task('middle', '2026-09-02T00:00:00.000Z'),
            task('other-status', '2026-09-01T00:00:00.000Z', { status: 'next' }),
        ] });
        const first = host.getInboxWindow({ offset: 0, limit: 2 });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.value.total).toBe(3);
        expect(first.value.rows.map(({ id }) => id)).toEqual(['first', 'middle']);
        expect(first.value.rows[0]).toEqual({
            id: 'first', title: 'first', status: 'inbox', priority: null, dueDate: null,
            startTime: null, isFocusedToday: false, projectTitle: null, hasNotes: false,
        });
        expect(host.getInboxWindow({ offset: 2, limit: 2, revision: first.value.revision }))
            .toMatchObject({ ok: true, value: { rows: [{ id: 'later' }], total: 3 } });

        expect((await useTaskStore.getState().updateTask('later', { dueDate: '2026-09-01' })).success).toBe(true);
        await flushPendingSave();
        expect(host.getInboxWindow({ offset: 2, limit: 2, revision: first.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const reordered = host.getInboxWindow({ offset: 0, limit: 2 });
        expect(reordered).toMatchObject({ ok: true, value: { rows: [{ id: 'later' }, { id: 'first' }] } });
        if (!reordered.ok) return;

        expect((await useTaskStore.getState().updateTask('first', { status: 'next' })).success).toBe(true);
        await flushPendingSave();
        expect(host.getInboxWindow({ offset: 2, limit: 2, revision: reordered.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxWindow({ offset: 0, limit: 2 })).toMatchObject({ ok: true, value: { total: 2 } });
        expect(host.getInboxWindow({ offset: 1, limit: 2 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getInboxWindow({ offset: 0, limit: NATIVE_HOST_MAX_WINDOW + 1 }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.createInboxTask({ title: 'New', captureId: 'bad' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        const beforeSort = host.getInboxWindow({ offset: 0, limit: 1 });
        if (!beforeSort.ok) return;
        useTaskStore.setState({ settings: { taskSortBy: 'created-desc' } });
        expect(host.getInboxWindow({ offset: 1, limit: 1, revision: beforeSort.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxWindow({ offset: 0, limit: 2 }))
            .toMatchObject({ ok: true, value: { rows: [{ id: 'later' }, { id: 'middle' }] } });
    });

    it('invalidates Inbox paging when a project becomes inactive', async () => {
        const project: Project = {
            id: 'project', title: 'Project', status: 'active', color: '#123456', order: 0,
            tagIds: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        };
        getData.mockResolvedValue({
            tasks: [task('in-project', '2026-09-01T00:00:00.000Z', { projectId: project.id })],
            projects: [project], sections: [], areas: [], people: [], settings: {},
        });
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        const first = host.getInboxWindow({ offset: 0, limit: 1 });
        expect(first).toMatchObject({ ok: true, value: { total: 1, rows: [{ projectTitle: 'Project' }] } });
        if (!first.ok) return;
        useTaskStore.setState({ _allProjects: [{ ...project, status: 'archived' }] });
        expect(host.getInboxWindow({ offset: 1, limit: 1, revision: first.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxWindow({ offset: 0, limit: 1 }))
            .toMatchObject({ ok: true, value: { total: 0, rows: [] } });
    });

    it('acknowledges create and complete only when their store snapshots are durable', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        let releaseSave!: () => void;
        saveData.mockImplementation(() => new Promise<void>((resolve) => { releaseSave = resolve; }));

        let createdSettled = false;
        const creating = host.createInboxTask({ title: '  Captured thought  ', captureId: CAPTURE_ID }).then((result) => {
            createdSettled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
        expect(createdSettled).toBe(false);
        releaseSave();
        const created = await creating;
        expect(created).toMatchObject({ ok: true, value: { id: expect.any(String) } });
        if (!created.ok) return;
        expect(host.getTask({ id: created.value.id })).toMatchObject({
            ok: true, value: { title: 'Captured thought', status: 'inbox' },
        });

        let completedSettled = false;
        const completing = host.completeTask({ id: created.value.id }).then((result) => {
            completedSettled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(2));
        expect(completedSettled).toBe(false);
        releaseSave();
        expect(await completing).toEqual({ ok: true, value: { id: created.value.id } });
        expect(host.getTask({ id: created.value.id })).toMatchObject({
            ok: true, value: { status: 'done', completedAt: expect.any(String) },
        });
    });

    it('reports a failed save without a successful task ID', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        saveData.mockRejectedValue(new Error('disk unavailable'));
        const input = { title: 'Unsaved thought', captureId: CAPTURE_ID };
        const result = await host.createInboxTask(input);
        expect(result).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        expect(result).not.toHaveProperty('value.id');
        saveData.mockResolvedValue(undefined);
        expect(await host.createInboxTask(input)).toEqual({ ok: true, value: { id: CAPTURE_ID } });
        expect(useTaskStore.getState()._allTasks).toHaveLength(1);
    });

    it('reports failed completion persistence and retries the optimistic completion without repeating it', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        useTaskStore.setState({ _allTasks: [task('to-complete', '2026-09-01T00:00:00.000Z')] });
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.completeTask({ id: 'to-complete' }))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        const completedAt = useTaskStore.getState()._tasksById.get('to-complete')?.completedAt;
        expect(completedAt).toEqual(expect.any(String));
        saveData.mockResolvedValue(undefined);
        expect(await host.completeTask({ id: 'to-complete' })).toEqual({ ok: true, value: { id: 'to-complete' } });
        expect(useTaskStore.getState()._tasksById.get('to-complete')?.completedAt).toBe(completedAt);
    });

    it('rejects every entry point until a real adapter, load, and write-safety gate succeed', async () => {
        setStorageAdapter(noopStorage);
        const host = createNativeHostContract();
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getTask({ id: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.createInboxTask({ title: 'x', captureId: CAPTURE_ID }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.completeTask({ id: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(saveData).not.toHaveBeenCalled();
        setStorageAdapter({ getData, saveData });
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        setStorageAdapter(noopStorage);
        expect(host.getInboxWindow({ offset: 0, limit: 1 }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });

    it('keeps the contract closed when the initial store load fails', async () => {
        getData.mockRejectedValue(new Error('database unreadable'));
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: false })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(getData).not.toHaveBeenCalled();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(useTaskStore.getState().error).toContain('database unreadable');
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.createInboxTask({ title: 'Must not save', captureId: CAPTURE_ID }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('acknowledges a lost completion reply without completing twice, after flushing pending work', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        useTaskStore.setState({ _allTasks: [task('replay', '2026-09-01T00:00:00.000Z')] });
        expect(await host.completeTask({ id: 'replay' })).toEqual({ ok: true, value: { id: 'replay' } });
        const completedAt = useTaskStore.getState()._tasksById.get('replay')?.completedAt;
        expect(saveData).toHaveBeenCalledTimes(1);

        let releaseSave!: () => void;
        saveData.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseSave = resolve; }));
        expect((await useTaskStore.getState().updateTask('replay', { description: 'Pending edit' })).success).toBe(true);
        let replaySettled = false;
        const replay = host.completeTask({ id: 'replay' }).then((result) => {
            replaySettled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(2));
        expect(replaySettled).toBe(false);
        releaseSave();
        expect(await replay).toEqual({ ok: true, value: { id: 'replay' } });
        expect(useTaskStore.getState()._tasksById.get('replay')?.completedAt).toBe(completedAt);
    });

    it('closes an activated contract after a later store load error', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        getData.mockRejectedValue(new Error('database unreadable'));
        await expect(useTaskStore.getState().fetchData({ throwOnError: true })).rejects.toThrow('database unreadable');
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        useTaskStore.getState().setError(null);
        expect(await host.createInboxTask({ title: 'Must not save', captureId: CAPTURE_ID }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('fails closed when a task changes during the initial storage read', async () => {
        let releaseRead!: (data: unknown) => void;
        getData.mockImplementation(() => new Promise((resolve) => { releaseRead = resolve; }));
        const host = createNativeHostContract();
        const activating = host.activate({ writeSafetyReady: true });
        await vi.waitFor(() => expect(getData).toHaveBeenCalledTimes(1));
        expect((await useTaskStore.getState().addTask('Concurrent capture')).success).toBe(true);
        releaseRead({
            tasks: [task('stored', '2026-09-01T00:00:00.000Z')],
            projects: [], sections: [], areas: [], people: [], settings: {},
        });
        expect(await activating).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });
});
