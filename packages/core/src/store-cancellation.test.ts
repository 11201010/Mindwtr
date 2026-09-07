import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consoleLogger, setLogger, type LogPayload } from './logger';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { StorageAdapter } from './storage';
import { repairMergedSyncReferences, validateMergedSyncData } from './sync-normalization';

const WRITE_NOW = '2026-09-07T14:00:00.000Z';

describe('cancellation store lifecycle', () => {
    let saveData: ReturnType<typeof vi.fn>;
    let logs: LogPayload[];

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        logs = [];
        setLogger((payload) => logs.push(payload));
        const storage: StorageAdapter = {
            getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} }),
            saveData,
        };
        setStorageAdapter(storage);
        useTaskStore.setState({
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            people: [],
            settings: { deviceId: 'device-a' },
            isLoading: false,
            error: null,
            persistenceFailure: null,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _allPeople: [],
            _tasksById: new Map(),
            _projectsById: new Map(),
            _sectionsById: new Map(),
            _areasById: new Map(),
            _peopleById: new Map(),
            lastDataChangeAt: 0,
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Date(WRITE_NOW));
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        setLogger(consoleLogger);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('cancels strict and fluid recurring tasks without completing or generating a next occurrence', async () => {
        const { addTask, cancelTask } = useTaskStore.getState();
        const strict = await addTask('Strict series', {
            status: 'next',
            startTime: '2026-09-08',
            recurrence: { rule: 'daily', strategy: 'strict' },
            isFocusedToday: true,
            focusOrder: 3,
        });
        const fluid = await addTask('Fluid series', {
            status: 'waiting',
            dueDate: '2026-09-08T17:30:00.000Z',
            recurrence: { rule: 'weekly', strategy: 'fluid' },
        });

        await expect(cancelTask(strict.id!)).resolves.toEqual({ success: true, id: strict.id });
        await expect(cancelTask(fluid.id!)).resolves.toEqual({ success: true, id: fluid.id });

        const allTasks = useTaskStore.getState()._allTasks;
        expect(allTasks).toHaveLength(2);
        expect(allTasks.find((task) => task.id === strict.id)).toMatchObject({
            status: 'archived',
            cancelledAt: WRITE_NOW,
            startTime: '2026-09-08',
            recurrence: { rule: 'daily', strategy: 'strict' },
            isFocusedToday: false,
        });
        expect(allTasks.find((task) => task.id === strict.id)?.completedAt).toBeUndefined();
        expect(allTasks.find((task) => task.id === strict.id)?.focusOrder).toBeUndefined();
        expect(allTasks.find((task) => task.id === fluid.id)).toMatchObject({
            status: 'archived',
            cancelledAt: WRITE_NOW,
            dueDate: '2026-09-08T17:30:00.000Z',
            recurrence: { rule: 'weekly', strategy: 'fluid' },
        });
        expect(allTasks.find((task) => task.id === fluid.id)?.completedAt).toBeUndefined();
    });

    it('enforces cancellation precedence for creation and updates', async () => {
        const { addTask, updateTask } = useTaskStore.getState();
        const created = await addTask('Imported cancellation', { cancelledAt: WRITE_NOW });
        const createdTask = useTaskStore.getState()._tasksById.get(created.id!);
        expect(createdTask).toMatchObject({ status: 'archived', cancelledAt: WRITE_NOW });
        expect(createdTask?.completedAt).toBeUndefined();

        const active = await addTask('Active task', { status: 'next' });
        await updateTask(active.id!, { cancelledAt: WRITE_NOW });
        expect(useTaskStore.getState()._tasksById.get(active.id!)).toMatchObject({
            status: 'archived',
            cancelledAt: WRITE_NOW,
        });

        await updateTask(active.id!, { status: 'done', cancelledAt: WRITE_NOW });
        const completed = useTaskStore.getState()._tasksById.get(active.id!);
        expect(completed?.status).toBe('done');
        expect(completed?.cancelledAt).toBeUndefined();
        expect(completed?.completedAt).toBe(WRITE_NOW);

        await updateTask(active.id!, { status: 'next' });
        const reactivated = useTaskStore.getState()._tasksById.get(active.id!);
        expect(reactivated?.status).toBe('next');
        expect(reactivated?.cancelledAt).toBeUndefined();
        expect(reactivated?.completedAt).toBeUndefined();

        await expect(updateTask(active.id!, { cancelledAt: '2026-02-30T10:00:00.000Z' }))
            .resolves.toEqual({
                success: false,
                error: 'Cancellation timestamp must be an ISO datetime with timezone',
            });
    });

    it('cancels only unfinished project children and restores only untouched operation-owned children', async () => {
        const { addProject, addSection, addTask, cancelProject, deleteTask, updateProject, updateTask } = useTaskStore.getState();
        const project = await addProject('Cancelled project', '#123456');
        const target = await addProject('Target project', '#654321');
        expect(project).not.toBeNull();
        expect(target).not.toBeNull();
        if (!project || !target) return;
        const section = await addSection(project.id, 'Kept section');
        expect(section).not.toBeNull();

        const untouched = await addTask('Untouched', { status: 'next', projectId: project.id, sectionId: section!.id });
        const edited = await addTask('Edited', { status: 'waiting', projectId: project.id });
        const moved = await addTask('Moved', { status: 'next', projectId: project.id });
        const completedLater = await addTask('Completed later', { status: 'someday', projectId: project.id });
        const reference = await addTask('Reference', { status: 'reference', projectId: project.id });
        const done = await addTask('Done', { status: 'done', completedAt: '2026-09-01T10:00:00.000Z', projectId: project.id });
        const archived = await addTask('Archived', { status: 'archived', completedAt: '2026-08-01T10:00:00.000Z', projectId: project.id });
        const preCancelled = await addTask('Pre-cancelled', {
            status: 'archived',
            cancelledAt: '2026-08-02T10:00:00.000Z',
            projectId: project.id,
        });
        const deleted = await addTask('Deleted', { status: 'next', projectId: project.id });
        await deleteTask(deleted.id!);
        const deletedAt = useTaskStore.getState()._tasksById.get(deleted.id!)?.deletedAt;

        await cancelProject(project.id);

        const afterCancel = useTaskStore.getState()._tasksById;
        for (const id of [untouched.id!, edited.id!, moved.id!, completedLater.id!]) {
            expect(afterCancel.get(id)).toMatchObject({ status: 'archived', cancelledAt: WRITE_NOW });
            expect(afterCancel.get(id)?.completedAt).toBeUndefined();
            expect(afterCancel.get(id)?.projectArchivedAt).toBe(WRITE_NOW);
        }
        expect(afterCancel.get(reference.id!)?.status).toBe('reference');
        expect(afterCancel.get(done.id!)).toMatchObject({ status: 'done', completedAt: '2026-09-01T10:00:00.000Z' });
        expect(afterCancel.get(archived.id!)).toMatchObject({ status: 'archived', completedAt: '2026-08-01T10:00:00.000Z' });
        expect(afterCancel.get(preCancelled.id!)).toMatchObject({
            status: 'archived',
            cancelledAt: '2026-08-02T10:00:00.000Z',
        });
        expect(afterCancel.get(deleted.id!)?.deletedAt).toBe(deletedAt);
        expect(useTaskStore.getState()._sectionsById.get(section!.id)?.deletedAt).toBe(WRITE_NOW);

        vi.setSystemTime(new Date('2026-09-07T15:00:00.000Z'));
        await updateTask(edited.id!, { title: 'Edited independently' });
        await updateTask(moved.id!, { projectId: target.id });
        await updateTask(completedLater.id!, { status: 'done' });
        await updateProject(project.id, { status: 'active' });

        const restored = useTaskStore.getState()._tasksById;
        expect(restored.get(untouched.id!)).toMatchObject({ status: 'next', projectId: project.id, sectionId: section!.id });
        expect(restored.get(untouched.id!)?.cancelledAt).toBeUndefined();
        expect(restored.get(edited.id!)).toMatchObject({ status: 'archived', cancelledAt: WRITE_NOW, title: 'Edited independently' });
        expect(restored.get(moved.id!)).toMatchObject({ status: 'archived', cancelledAt: WRITE_NOW, projectId: target.id });
        expect(restored.get(completedLater.id!)).toMatchObject({ status: 'done', cancelledAt: undefined });
        expect(restored.get(reference.id!)?.status).toBe('reference');
        expect(restored.get(done.id!)?.status).toBe('done');
        expect(restored.get(preCancelled.id!)?.cancelledAt).toBe('2026-08-02T10:00:00.000Z');
        expect(useTaskStore.getState()._sectionsById.get(section!.id)?.deletedAt).toBeUndefined();
        expect(useTaskStore.getState()._projectsById.get(project.id)).toMatchObject({ status: 'active' });
        expect(useTaskStore.getState()._projectsById.get(project.id)?.cancelledAt).toBeUndefined();
    });

    it('uses write time for restore ownership while preserving a historical project cancellation time', async () => {
        const { addProject, addTask, updateProject } = useTaskStore.getState();
        const project = await addProject('Historical cancellation', '#123456');
        expect(project).not.toBeNull();
        if (!project) return;
        const child = await addTask('Child', { status: 'next', projectId: project.id });
        const historical = '2026-08-01T09:00:00.000Z';

        await updateProject(project.id, { cancelledAt: historical });
        const cancelledChild = useTaskStore.getState()._tasksById.get(child.id!);
        expect(cancelledChild).toMatchObject({
            status: 'archived',
            cancelledAt: historical,
            projectArchivedAt: WRITE_NOW,
            updatedAt: WRITE_NOW,
        });

        vi.setSystemTime(new Date('2026-09-07T15:00:00.000Z'));
        await updateProject(project.id, { status: 'active' });
        expect(useTaskStore.getState()._tasksById.get(child.id!)).toMatchObject({
            status: 'next',
            cancelledAt: undefined,
            updatedAt: '2026-09-07T15:00:00.000Z',
        });
    });

    it('keeps mixed child history, section membership, and order through canonical reload and reactivation', async () => {
        const { addProject, addSection, addTask, cancelProject, updateProject, updateSection } = useTaskStore.getState();
        const project = await addProject('Round-trip cancellation', '#123456');
        expect(project).not.toBeNull();
        if (!project) return;
        const section = await addSection(project.id, 'Ordered section');
        expect(section).not.toBeNull();
        if (!section) return;
        await updateSection(section.id, { order: 4 });
        const task = await addTask('Ordered child', {
            status: 'next',
            projectId: project.id,
            sectionId: section.id,
            order: 7,
        });
        const completedAt = '2026-09-01T10:00:00.000Z';
        const completed = await addTask('Completed child', {
            status: 'done',
            completedAt,
            projectId: project.id,
            sectionId: section.id,
            order: 8,
        });
        const reference = await addTask('Reference child', {
            status: 'reference',
            projectId: project.id,
            sectionId: section.id,
            order: 9,
        });
        const previousCancelledAt = '2026-08-15T10:00:00.000Z';
        const previouslyCancelled = await addTask('Previously cancelled child', {
            status: 'archived',
            cancelledAt: previousCancelledAt,
            projectId: project.id,
            sectionId: section.id,
            order: 10,
        });
        const previousCancelledRev = useTaskStore.getState()._tasksById.get(previouslyCancelled.id!)?.rev;

        await cancelProject(project.id);
        const written = structuredClone(saveData.mock.calls.at(-1)?.[0]);
        const repaired = repairMergedSyncReferences(written, '2026-09-07T14:30:00.000Z');
        expect(validateMergedSyncData(repaired)).toEqual([]);
        expect(repaired.tasks.find((candidate) => candidate.id === task.id)).toMatchObject({ status: 'archived', sectionId: section.id, order: 7 });
        expect(repaired.tasks.find((candidate) => candidate.id === completed.id)).toMatchObject({ status: 'done', completedAt, sectionId: section.id, order: 8 });
        expect(repaired.tasks.find((candidate) => candidate.id === reference.id)).toMatchObject({ status: 'reference', sectionId: section.id, order: 9 });
        expect(repaired.tasks.find((candidate) => candidate.id === previouslyCancelled.id)).toMatchObject({
            status: 'archived',
            cancelledAt: previousCancelledAt,
            sectionId: section.id,
            order: 10,
            rev: previousCancelledRev,
        });
        expect(repaired.sections.find((candidate) => candidate.id === section.id)).toMatchObject({
            order: 4,
            deletedAt: WRITE_NOW,
            projectArchivedAt: WRITE_NOW,
        });

        setStorageAdapter({
            getData: vi.fn().mockResolvedValue(structuredClone(repaired)),
            saveData,
        });
        await useTaskStore.getState().fetchData({ silent: true });
        expect(useTaskStore.getState()._tasksById.get(completed.id!)).toMatchObject({ status: 'done', completedAt, sectionId: section.id, order: 8 });
        expect(useTaskStore.getState()._tasksById.get(reference.id!)).toMatchObject({ status: 'reference', sectionId: section.id, order: 9 });
        expect(useTaskStore.getState()._tasksById.get(previouslyCancelled.id!)).toMatchObject({
            status: 'archived',
            cancelledAt: previousCancelledAt,
            sectionId: section.id,
            order: 10,
            rev: previousCancelledRev,
        });
        vi.setSystemTime(new Date('2026-09-07T15:00:00.000Z'));
        await updateProject(project.id, { status: 'active' });

        expect(useTaskStore.getState()._tasksById.get(task.id!)).toMatchObject({
            status: 'next',
            sectionId: section.id,
            order: 7,
        });
        expect(useTaskStore.getState()._tasksById.get(completed.id!)).toMatchObject({ status: 'done', completedAt, sectionId: section.id, order: 8 });
        expect(useTaskStore.getState()._tasksById.get(reference.id!)).toMatchObject({ status: 'reference', sectionId: section.id, order: 9 });
        expect(useTaskStore.getState()._tasksById.get(previouslyCancelled.id!)).toMatchObject({
            status: 'archived',
            cancelledAt: previousCancelledAt,
            sectionId: section.id,
            order: 10,
            rev: previousCancelledRev,
        });
        expect(useTaskStore.getState()._sectionsById.get(section.id)).toMatchObject({
            order: 4,
            deletedAt: undefined,
            projectArchivedAt: undefined,
        });
    });

    it('acknowledges and logs task and project cancellation only after durable saves', async () => {
        const task = await useTaskStore.getState().addTask('Task', { status: 'next' });
        const project = await useTaskStore.getState().addProject('Project', '#123456');
        await flushPendingSave();
        logs = [];
        saveData.mockClear();

        await expect(useTaskStore.getState().cancelTask(task.id!)).resolves.toEqual({ success: true, id: task.id });
        await expect(useTaskStore.getState().cancelProject(project!.id)).resolves.toEqual({ success: true, id: project!.id });

        expect(saveData).toHaveBeenCalledTimes(2);
        expect(logs.filter((entry) => entry.message === 'Commitment cancellation saved')).toEqual([
            expect.objectContaining({
                level: 'info',
                context: {
                    releaseCheck: 'v1.3.0/commitment-cancelled',
                    kind: 'task',
                    outcome: 'cancelled',
                    count: 1,
                },
            }),
            expect.objectContaining({
                level: 'info',
                context: {
                    releaseCheck: 'v1.3.0/commitment-cancelled',
                    kind: 'project',
                    outcome: 'cancelled',
                    count: 1,
                },
            }),
        ]);
    });

    it('keeps task cancellation failed until its unchanged snapshot is durably retried', async () => {
        const task = await useTaskStore.getState().addTask('Task', { status: 'next' });
        await flushPendingSave();
        logs = [];
        const saveTask = vi.fn().mockRejectedValue(new Error('disk unavailable'));
        saveData.mockRejectedValue(new Error('disk unavailable'));
        setStorageAdapter({
            getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} }),
            saveData,
            saveTask,
        });

        const firstCancellation = useTaskStore.getState().cancelTask(task.id!);
        await vi.runAllTimersAsync();
        await expect(firstCancellation).resolves.toEqual({
            success: false,
            error: 'Failed to save task cancellation: disk unavailable',
        });
        expect(logs.some((entry) => entry.message === 'Commitment cancellation saved')).toBe(false);
        const failedState = useTaskStore.getState()._tasksById.get(task.id!);

        const secondCancellation = useTaskStore.getState().cancelTask(task.id!);
        await vi.runAllTimersAsync();
        await expect(secondCancellation).resolves.toEqual({
            success: false,
            error: 'Failed to save task cancellation: disk unavailable',
        });
        expect(useTaskStore.getState()._tasksById.get(task.id!)).toEqual(failedState);
        expect(logs.some((entry) => entry.message === 'Commitment cancellation saved')).toBe(false);

        saveData.mockResolvedValue(undefined);
        saveTask.mockResolvedValue(undefined);
        await expect(useTaskStore.getState().cancelTask(task.id!)).resolves.toEqual({ success: true, id: task.id });
        expect(useTaskStore.getState()._tasksById.get(task.id!)).toEqual(failedState);
        const savedSnapshot = saveData.mock.calls.at(-1)?.[0];
        expect(savedSnapshot?.tasks.find((candidate) => candidate.id === task.id)).toMatchObject({
            status: 'archived',
            cancelledAt: WRITE_NOW,
        });
        expect(logs.filter((entry) => entry.message === 'Commitment cancellation saved')).toHaveLength(1);
    });

    it('keeps project cancellation failed until its unchanged snapshot is durably retried', async () => {
        const project = await useTaskStore.getState().addProject('Project', '#123456');
        await flushPendingSave();
        logs = [];
        saveData.mockRejectedValue(new Error('disk unavailable'));

        const firstCancellation = useTaskStore.getState().cancelProject(project!.id);
        await vi.runAllTimersAsync();
        await expect(firstCancellation).resolves.toEqual({
            success: false,
            error: 'Failed to save project cancellation: disk unavailable',
        });
        expect(logs.some((entry) => entry.message === 'Commitment cancellation saved')).toBe(false);
        const failedState = useTaskStore.getState()._projectsById.get(project!.id);

        const secondCancellation = useTaskStore.getState().cancelProject(project!.id);
        await vi.runAllTimersAsync();
        await expect(secondCancellation).resolves.toEqual({
            success: false,
            error: 'Failed to save project cancellation: disk unavailable',
        });
        expect(useTaskStore.getState()._projectsById.get(project!.id)).toEqual(failedState);
        expect(logs.some((entry) => entry.message === 'Commitment cancellation saved')).toBe(false);

        saveData.mockResolvedValue(undefined);
        await expect(useTaskStore.getState().cancelProject(project!.id)).resolves.toEqual({ success: true, id: project!.id });
        expect(useTaskStore.getState()._projectsById.get(project!.id)).toEqual(failedState);
        const savedSnapshot = saveData.mock.calls.at(-1)?.[0];
        expect(savedSnapshot?.projects.find((candidate) => candidate.id === project!.id)).toMatchObject({
            status: 'archived',
            cancelledAt: WRITE_NOW,
        });
        expect(logs.filter((entry) => entry.message === 'Commitment cancellation saved')).toHaveLength(1);
    });

    it('flushes already-cancelled task and project writes before reporting idempotent success', async () => {
        const task = await useTaskStore.getState().addTask('Task', { status: 'next' });
        const project = await useTaskStore.getState().addProject('Project', '#123456');
        await flushPendingSave();
        saveData.mockClear();
        await useTaskStore.getState().updateTask(task.id!, { cancelledAt: WRITE_NOW });
        expect(useTaskStore.getState()._tasksById.get(task.id!)?.cancelledAt).toBe(WRITE_NOW);

        await expect(useTaskStore.getState().cancelTask(task.id!)).resolves.toEqual({ success: true, id: task.id });
        expect(saveData).toHaveBeenCalledTimes(1);

        saveData.mockClear();
        await useTaskStore.getState().updateProject(project!.id, { cancelledAt: WRITE_NOW });
        expect(useTaskStore.getState()._projectsById.get(project!.id)?.cancelledAt).toBe(WRITE_NOW);

        await expect(useTaskStore.getState().cancelProject(project!.id)).resolves.toEqual({ success: true, id: project!.id });
        expect(saveData).toHaveBeenCalledTimes(1);
    });
});
