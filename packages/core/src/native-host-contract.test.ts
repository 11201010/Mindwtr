import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, NATIVE_HOST_EDITOR_FIELDS, NATIVE_HOST_MAX_WINDOW, type NativeEditableFields } from './native-host-contract';
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

const project = (id: string, status: Project['status'] = 'active', order = 0, extra: Partial<Project> = {}): Project => ({
    id,
    title: id,
    status,
    color: '#123456',
    order,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
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

    const activateWith = async (tasks: Task[], projects: Project[] = []) => {
        getData.mockResolvedValue({ tasks, projects, sections: [], areas: [], people: [], settings: {} });
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        return host;
    };

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
        expect(host.getTaskEditor({ id: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.createInboxTask({ title: 'x', captureId: CAPTURE_ID }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.completeTask({ id: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.updateTask({ id: 'x', base: { title: 'x' }, patch: { title: 'y' } }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
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

    it('returns raw task editor fields, archived read-only state, and store-ordered selectable projects', async () => {
        const currentArchivedProject = project('current-archived', 'archived', 2);
        const host = createNativeHostContract();
        expect(host.getTaskEditor({ id: 'raw' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        getData.mockResolvedValue({
            tasks: [
                task('raw', '2026-09-01T00:00:00.000Z', {
                    title: '  stored title  ', description: 'stored notes', status: 'archived', priority: 'high',
                    projectId: currentArchivedProject.id, startTime: '2026-09-23T09:15:00-04:00', dueDate: '2026-09-30',
                }),
                task('missing-fields', '2026-09-01T00:00:00.000Z'),
                task('deleted-task', '2026-09-01T00:00:00.000Z', { deletedAt: '2026-09-02T00:00:00.000Z' }),
            ],
            projects: [
                currentArchivedProject,
                project('active-later', 'active', 1),
                project('active-first', 'active', 0),
                project('other-archived', 'archived', 3),
                project('deleted-project', 'active', -1, { deletedAt: '2026-09-02T00:00:00.000Z' }),
                project('completed-project', 'completed', 4),
            ],
            sections: [], areas: [], people: [], settings: {},
        });
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });

        const rawEditor = host.getTaskEditor({ id: 'raw' });
        expect(rawEditor).toEqual({
            ok: true,
            value: {
                version: 1,
                id: 'raw',
                fields: {
                    title: '  stored title  ', description: 'stored notes', status: 'archived', priority: 'high',
                    projectId: currentArchivedProject.id, startTime: '2026-09-23T09:15:00-04:00', dueDate: '2026-09-30',
                },
                projects: [
                    { id: 'current-archived', title: 'current-archived' },
                    { id: 'active-later', title: 'active-later' },
                    { id: 'active-first', title: 'active-first' },
                ],
                readOnly: true,
                statuses: ['inbox', 'next', 'waiting', 'someday', 'reference', 'done'],
                priorities: ['low', 'medium', 'high', 'urgent'],
            },
        });
        if (rawEditor.ok) expect(Object.keys(rawEditor.value.fields)).toEqual(NATIVE_HOST_EDITOR_FIELDS);
        expect(host.getTaskEditor({ id: 'missing-fields' })).toMatchObject({
            ok: true,
            value: { fields: {
                title: 'missing-fields', description: null, status: 'inbox', priority: null,
                projectId: null, startTime: null, dueDate: null,
            }, readOnly: false },
        });
        expect(host.getTaskEditor({ id: 'deleted-task' })).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        expect(host.getTaskEditor({ id: '' })).toEqual({
            ok: false, error: { code: 'INVALID_INPUT', message: 'Task ID is required' },
        });
        expect(await host.updateTask({ id: '', base: {}, patch: {} })).toEqual({
            ok: false, error: { code: 'INVALID_INPUT', message: 'Task ID is required' },
        });
    });

    const editorFieldEdits: Array<{ field: keyof NativeEditableFields; value: unknown }> = [
        { field: 'title', value: '  Updated title  ' },
        { field: 'description', value: 'Updated notes' },
        { field: 'status', value: 'next' },
        { field: 'priority', value: 'urgent' },
        { field: 'projectId', value: 'assigned-project' },
        { field: 'startTime', value: '2026-10-02T09:15:00.000Z' },
        { field: 'dueDate', value: '2026-10-04' },
    ];

    it.each(editorFieldEdits)('persists $field only after its save is durable', async ({ field, value }) => {
        const host = await activateWith(
            [task('edit', '2026-09-01T00:00:00.000Z', { description: 'Old notes', priority: 'low' })],
            [project('assigned-project')],
        );
        const editor = host.getTaskEditor({ id: 'edit' });
        if (!editor.ok) throw new Error('Task editor did not load');
        const base = { [field]: editor.value.fields[field] } as Partial<NativeEditableFields>;
        const patch = { [field]: value } as Partial<NativeEditableFields>;
        let savedSnapshot: unknown;
        let releaseSave!: () => void;
        saveData.mockClear();
        saveData.mockImplementation((data: unknown) => {
            savedSnapshot = data;
            return new Promise<void>((resolve) => { releaseSave = resolve; });
        });

        let settled = false;
        const saving = host.updateTask({ id: 'edit', base, patch }).then((result) => {
            settled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
        expect(settled).toBe(false);
        releaseSave();
        expect(await saving).toEqual({ ok: true, value: { id: 'edit', changed: true } });

        const persistedTask = (savedSnapshot as { tasks: Task[] }).tasks.find(({ id }) => id === 'edit');
        expect(persistedTask?.[field as keyof Task]).toBe(value);
        if (field === 'dueDate') {
            getData.mockResolvedValue(savedSnapshot as never);
            await expect(useTaskStore.getState().fetchData({ throwOnError: true })).resolves.toBeUndefined();
            expect(host.getTaskEditor({ id: 'edit' })).toMatchObject({ ok: true, value: { fields: { dueDate: '2026-10-04' } } });
        }
    });

    it('clears descriptions the same way as the mobile task draft', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { description: 'Old notes' })]);
        saveData.mockClear();
        expect(await host.updateTask({ id: 'edit', base: { description: 'Old notes' }, patch: { description: '' } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: true } });
        const savedData = saveData.mock.calls.at(-1)?.[0] as { tasks: Task[] };
        expect(savedData.tasks.find(({ id }) => id === 'edit')?.description).toBeUndefined();
        expect(host.getTaskEditor({ id: 'edit' })).toMatchObject({ ok: true, value: { fields: { description: null } } });
        expect(await host.updateTask({ id: 'edit', base: { description: 'Old notes' }, patch: { description: null } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: false } });
    });

    const invalidEditorPatches: Array<{
        name: string;
        base: Record<string, unknown>;
        patch: Record<string, unknown>;
        messageFields: string[];
    }> = [
        { name: 'unknown key', base: { unknown: 'before' }, patch: { unknown: 'after' }, messageFields: ['title'] },
        { name: 'base and patch key mismatch', base: { title: 'edit' }, patch: { description: 'changed' }, messageFields: ['title', 'description'] },
        { name: 'blank title', base: { title: 'edit' }, patch: { title: '  ' }, messageFields: ['title'] },
        { name: 'bad status', base: { status: 'inbox' }, patch: { status: 'invalid' }, messageFields: ['status'] },
        { name: 'archived status', base: { status: 'inbox' }, patch: { status: 'archived' }, messageFields: ['status'] },
        { name: 'bad priority', base: { priority: null }, patch: { priority: 'critical' }, messageFields: ['priority'] },
        { name: 'deleted project', base: { projectId: 'current' }, patch: { projectId: 'deleted' }, messageFields: ['projectId'] },
        { name: 'another archived project', base: { projectId: 'current' }, patch: { projectId: 'archived' }, messageFields: ['projectId'] },
        { name: 'malformed date', base: { dueDate: null }, patch: { dueDate: '2026-02-30' }, messageFields: ['dueDate'] },
        { name: 'datetime with invalid time fields', base: { dueDate: null }, patch: { dueDate: '2026-09-23T25:99' }, messageFields: ['dueDate'] },
        { name: 'datetime with a space separator', base: { dueDate: null }, patch: { dueDate: '2026-09-23 10:00' }, messageFields: ['dueDate'] },
        { name: 'natural-language date', base: { dueDate: null }, patch: { dueDate: 'tomorrow' }, messageFields: ['dueDate'] },
        { name: 'date without zero padding', base: { dueDate: null }, patch: { dueDate: '2026-9-3' }, messageFields: ['dueDate'] },
    ];

    it.each(invalidEditorPatches)('rejects $name without writing', async ({ name, base, patch, messageFields }) => {
        const initial = task('edit', '2026-09-01T00:00:00.000Z', { projectId: 'current', rev: 7 });
        const host = await activateWith([initial], [
            project('current'),
            project('deleted', 'active', 1, { deletedAt: '2026-09-02T00:00:00.000Z' }),
            project('archived', 'archived', 2),
        ]);
        saveData.mockClear();

        const result = await host.updateTask({ id: 'edit', base, patch } as never);
        expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        if (!result.ok) {
            if (name === 'base and patch key mismatch') {
                expect(result.error.message).toBe('base and patch fields must match: title, description');
            }
            for (const field of messageFields) expect(result.error.message).toContain(field);
            for (const [key, value] of Object.entries(patch)) {
                if (!NATIVE_HOST_EDITOR_FIELDS.includes(key as typeof NATIVE_HOST_EDITOR_FIELDS[number])) {
                    expect(result.error.message).not.toContain(key);
                }
                if (typeof value === 'string' && value.trim()) expect(result.error.message).not.toContain(value);
            }
        }
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('edit')?.rev).toBe(7);
    });

    it('rejects an empty patch without writing', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { rev: 2 })]);
        saveData.mockClear();
        expect(await host.updateTask({ id: 'edit', base: {}, patch: {} })).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('edit')?.rev).toBe(2);
    });

    const referenceTaskFieldEdits: Array<{
        name: string;
        taskStatus: Task['status'];
        base: Partial<NativeEditableFields>;
        patch: Partial<NativeEditableFields>;
        field: 'priority' | 'startTime' | 'dueDate';
    }> = [
        {
            name: 'status reference with priority', taskStatus: 'next',
            base: { status: 'next', priority: null }, patch: { status: 'reference', priority: 'high' }, field: 'priority',
        },
        {
            name: 'status reference with due date', taskStatus: 'next',
            base: { status: 'next', dueDate: null }, patch: { status: 'reference', dueDate: '2026-09-30' }, field: 'dueDate',
        },
        {
            name: 'priority on an existing reference task', taskStatus: 'reference',
            base: { priority: null }, patch: { priority: 'high' }, field: 'priority',
        },
    ];

    it.each(referenceTaskFieldEdits)('rejects $name before the store can clear the field', async ({ taskStatus, base, patch, field }) => {
        const host = await activateWith([task('reference-edit', '2026-09-01T00:00:00.000Z', { status: taskStatus, rev: 11 })]);
        saveData.mockClear();

        const result = await host.updateTask({ id: 'reference-edit', base, patch });
        expect(result).toEqual({
            ok: false, error: { code: 'INVALID_INPUT', message: `${field} cannot be set while status is reference` },
        });
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('reference-edit')?.rev).toBe(11);
    });

    it('rejects updates to tasks in archived projects without writing', async () => {
        const host = await activateWith(
            [task('archived-project-task', '2026-09-01T00:00:00.000Z', { projectId: 'archived', rev: 12 })],
            [project('archived', 'archived')],
        );
        const revBefore = useTaskStore.getState()._tasksById.get('archived-project-task')?.rev;
        saveData.mockClear();

        expect(await host.updateTask({
            id: 'archived-project-task', base: { title: 'archived-project-task' }, patch: { title: 'Changed' },
        })).toEqual({
            ok: false,
            error: { code: 'INVALID_INPUT', message: 'Task is read-only while its project is archived' },
        });
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('archived-project-task')?.rev).toBe(revBefore);
    });

    it('accepts timezone datetimes and stores them unchanged', async () => {
        const value = '2026-09-23T10:00:00+05:30';
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z')]);

        expect(await host.updateTask({ id: 'edit', base: { dueDate: null }, patch: { dueDate: value } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: true } });
        const savedData = saveData.mock.calls.at(-1)?.[0] as { tasks: Task[] };
        expect(savedData.tasks.find(({ id }) => id === 'edit')?.dueDate).toBe(value);
    });

    it('rejects a conflict on a patched field without overwriting it', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { title: 'Original' })]);
        expect((await useTaskStore.getState().updateTask('edit', { title: 'Other writer' })).success).toBe(true);
        await flushPendingSave();
        const revAfterOtherWrite = useTaskStore.getState()._tasksById.get('edit')?.rev;
        saveData.mockClear();

        expect(await host.updateTask({ id: 'edit', base: { title: 'Original' }, patch: { title: 'My edit' } }))
            .toEqual({ ok: false, error: { code: 'STALE_REVISION', message: 'Task changed while editing: title' } });
        expect(useTaskStore.getState()._tasksById.get('edit')).toMatchObject({ title: 'Other writer', rev: revAfterOtherWrite });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('keeps an unrelated writer change while applying the requested field', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { title: 'Original', description: 'Old notes' })]);
        expect((await useTaskStore.getState().updateTask('edit', { description: 'Other notes' })).success).toBe(true);
        await flushPendingSave();

        expect(await host.updateTask({ id: 'edit', base: { title: 'Original' }, patch: { title: 'My edit' } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: true } });
        expect(useTaskStore.getState()._tasksById.get('edit')).toMatchObject({ title: 'My edit', description: 'Other notes' });
    });

    it('acknowledges a repeated edit without a second store write', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { title: 'Original' })]);
        const input = { id: 'edit', base: { title: 'Original' }, patch: { title: 'My edit' } };
        saveData.mockClear();
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'edit', changed: true } });
        const revAfterFirstWrite = useTaskStore.getState()._tasksById.get('edit')?.rev;
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'edit', changed: false } });
        expect(useTaskStore.getState()._tasksById.get('edit')?.rev).toBe(revAfterFirstWrite);
        expect(saveData).toHaveBeenCalledTimes(1);
    });

    it('creates one recurring follow-up through core and does not duplicate it on retry', async () => {
        const host = await activateWith([task('recurring', '2026-09-01T00:00:00.000Z', {
            status: 'next', recurrence: { rule: 'daily', strategy: 'fluid' }, dueDate: '2026-09-20',
        })]);
        const input = { id: 'recurring', base: { status: 'next' }, patch: { status: 'done' } };
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'recurring', changed: true } });
        const afterFirst = useTaskStore.getState()._allTasks;
        const followUps = afterFirst.filter((item) => item.id !== 'recurring' && item.status !== 'done' && item.status !== 'archived');
        expect(afterFirst.find(({ id }) => id === 'recurring')?.completedAt).toEqual(expect.any(String));
        expect(followUps).toHaveLength(1);
        const completedRev = afterFirst.find(({ id }) => id === 'recurring')?.rev;

        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'recurring', changed: false } });
        expect(useTaskStore.getState()._allTasks).toHaveLength(2);
        expect(useTaskStore.getState()._allTasks.find(({ id }) => id === 'recurring')?.rev).toBe(completedRev);
    });

    it('reports a failed recurring save and retries it without another update or follow-up', async () => {
        const host = await activateWith([task('recurring', '2026-09-01T00:00:00.000Z', {
            status: 'next', recurrence: { rule: 'daily', strategy: 'fluid' }, dueDate: '2026-09-20',
        })]);
        const input = { id: 'recurring', base: { status: 'next' }, patch: { status: 'done' } };
        saveData.mockClear();
        saveData.mockRejectedValue(new Error('disk unavailable'));

        expect(await host.updateTask(input)).toMatchObject({
            ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' },
        });
        const completed = useTaskStore.getState()._tasksById.get('recurring');
        const revAfterFailure = completed?.rev;
        expect(useTaskStore.getState()._allTasks).toHaveLength(2);
        expect(useTaskStore.getState()._allTasks.filter((item) => item.id !== 'recurring' && item.status !== 'done' && item.status !== 'archived')).toHaveLength(1);

        saveData.mockResolvedValue(undefined);
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'recurring', changed: false } });
        const savedData = saveData.mock.calls.at(-1)?.[0] as { tasks: Task[] };
        expect(savedData.tasks.find(({ id }) => id === 'recurring')?.status).toBe('done');
        expect(savedData.tasks.filter((item) => item.id !== 'recurring' && item.status !== 'done' && item.status !== 'archived'))
            .toHaveLength(1);
        expect(useTaskStore.getState()._allTasks).toHaveLength(2);
        expect(useTaskStore.getState()._tasksById.get('recurring')?.rev).toBe(revAfterFailure);
    });
});
