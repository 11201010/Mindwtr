import { isTaskVisibleInInbox } from './area-filter';
import { flushPendingSave, getPersistenceStatus, getStorageAdapter, useTaskStore } from './store';
import { noopStorage, type StorageAdapter } from './storage';
import { resolveNonDoneTaskSortBy } from './task-list-sort-options';
import { sortTasksBy } from './task-utils';
import type { Task } from './types';
import { generateUUID } from './uuid';

export const NATIVE_HOST_CONTRACT_VERSION = 1;
export const NATIVE_HOST_MAX_WINDOW = 100;
const CAPTURE_ID_PATTERN = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;

export type NativeHostErrorCode = 'NOT_READY' | 'INVALID_INPUT' | 'STALE_REVISION' | 'TASK_NOT_FOUND' | 'ACTION_FAILED' | 'SAVE_FAILED';
export type NativeHostResult<T> = { ok: true; value: T } | {
    ok: false;
    error: { code: NativeHostErrorCode; message: string };
};

export type NativeInboxRow = Pick<Task, 'id' | 'title' | 'status'> & {
    priority: Task['priority'] | null;
    dueDate: string | null;
    startTime: string | null;
    isFocusedToday: boolean;
    projectTitle: string | null;
    hasNotes: boolean;
};
export type NativeInboxWindow = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Opaque within this host instance; send it back on later pages. */
    revision: string;
    total: number;
    rows: NativeInboxRow[];
};

const fail = (code: NativeHostErrorCode, message: string): NativeHostResult<never> => ({
    ok: false,
    error: { code, message },
});
const hasLoadError = (message: string | null): boolean => (
    message?.startsWith('Failed to fetch data') === true || message === 'Storage request timed out. Try again.'
);

/** One instance per serial native JS host. All reads and commands use the shared store. */
export function createNativeHostContract() {
    const processId = generateUUID();
    let readyAdapter: StorageAdapter | null = null;
    let generation = 0;
    let lastTasks = useTaskStore.getState()._allTasks;
    let lastProjects = useTaskStore.getState()._allProjects;
    let lastSections = useTaskStore.getState()._allSections;
    let lastSortBy = resolveNonDoneTaskSortBy(useTaskStore.getState().settings.taskSortBy, useTaskStore.getState().settings);
    let cachedRevision = '';
    let cachedInbox: Task[] = [];
    let cachedProjectTitles = new Map<string, string>();
    useTaskStore.subscribe((state) => {
        if (hasLoadError(state.error)) readyAdapter = null;
    });

    const readiness = (): NativeHostResult<null> => {
        const state = useTaskStore.getState();
        if (readyAdapter && (getStorageAdapter() !== readyAdapter || hasLoadError(state.error))) readyAdapter = null;
        if (!readyAdapter || readyAdapter === noopStorage || state.isLoading) {
            return fail('NOT_READY', 'Native storage has not been loaded and validated');
        }
        return { ok: true, value: null };
    };

    const revision = () => {
        const state = useTaskStore.getState();
        const sortBy = resolveNonDoneTaskSortBy(state.settings.taskSortBy, state.settings);
        if (state._allTasks !== lastTasks || state._allProjects !== lastProjects
            || state._allSections !== lastSections || sortBy !== lastSortBy) {
            generation += 1;
            lastTasks = state._allTasks;
            lastProjects = state._allProjects;
            lastSections = state._allSections;
            lastSortBy = sortBy;
        }
        return `${processId}:${generation}`;
    };

    const save = async (): Promise<NativeHostResult<null>> => {
        const before = readiness();
        if (!before.ok) return before;
        try {
            await flushPendingSave();
            const after = readiness();
            if (!after.ok) return after;
            const failure = useTaskStore.getState().persistenceFailure;
            if (failure) return fail('SAVE_FAILED', failure.message);
            return { ok: true, value: null };
        } catch (error) {
            return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
        }
    };

    return {
        version: NATIVE_HOST_CONTRACT_VERSION,

        /** Call only after the host validates its adapter and any required recovery checkpoint. */
        async activate(input: { writeSafetyReady: boolean }): Promise<NativeHostResult<null>> {
            readyAdapter = null;
            const adapter = getStorageAdapter();
            if (!input || input.writeSafetyReady !== true || adapter === noopStorage) {
                return fail('NOT_READY', 'Native storage and write safety must be validated first');
            }
            const pending = getPersistenceStatus();
            if (pending.queued || pending.inFlight || pending.immediate || pending.retrying || pending.failed
                || useTaskStore.getState().isLoading || useTaskStore.getState().editLockCount > 0) {
                return fail('NOT_READY', 'Native storage cannot load while save or edit work is pending');
            }
            const loadStartedAt = useTaskStore.getState().lastDataChangeAt;
            let loadInvalidated = false;
            let relevanceChecks = 0;
            try {
                await useTaskStore.getState().fetchData({
                    throwOnError: true,
                    isResultStillRelevant: () => {
                        relevanceChecks += 1;
                        if (getStorageAdapter() !== adapter || useTaskStore.getState().lastDataChangeAt !== loadStartedAt) {
                            loadInvalidated = true;
                            return false;
                        }
                        return true;
                    },
                });
                // fetchData's third relevance check is inside the state producer.
                // Earlier exits (including a concurrent edit) never reach its apply gate.
                if (loadInvalidated || relevanceChecks < 3) {
                    return fail('NOT_READY', 'Native storage load was not applied');
                }
                await flushPendingSave();
            } catch (error) {
                return fail('NOT_READY', error instanceof Error ? error.message : String(error));
            }
            if (getStorageAdapter() !== adapter || useTaskStore.getState().isLoading
                || useTaskStore.getState().error || useTaskStore.getState().editLockCount > 0) {
                return fail('NOT_READY', 'Native storage load did not finish cleanly');
            }
            readyAdapter = adapter;
            return { ok: true, value: null };
        },

        getInboxWindow(input: { offset: number; limit: number; revision?: string }): NativeHostResult<NativeInboxWindow> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || !Number.isSafeInteger(input.offset) || input.offset < 0
                || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > NATIVE_HOST_MAX_WINDOW
                || (input.offset > 0 && typeof input.revision !== 'string')
                || (input.revision !== undefined && typeof input.revision !== 'string')) {
                return fail('INVALID_INPUT', 'A valid offset, bounded limit, and revision for later pages are required');
            }
            const currentRevision = revision();
            if (input.revision !== undefined && input.revision !== currentRevision) {
                return fail('STALE_REVISION', 'Inbox changed; restart paging from offset zero');
            }
            const state = useTaskStore.getState();
            if (cachedRevision !== currentRevision) {
                cachedInbox = sortTasksBy(state.tasks.filter((task) => (
                    task.status === 'inbox' && isTaskVisibleInInbox(task, { projectById: state._projectsById })
                )), resolveNonDoneTaskSortBy(state.settings.taskSortBy, state.settings));
                cachedProjectTitles = new Map(state.projects.map((project) => [project.id, project.title]));
                cachedRevision = currentRevision;
            }
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision: currentRevision,
                    total: cachedInbox.length,
                    rows: cachedInbox.slice(input.offset, input.offset + input.limit).map((task) => ({
                        id: task.id,
                        title: task.title,
                        status: task.status,
                        priority: task.priority ?? null,
                        dueDate: task.dueDate ?? null,
                        startTime: task.startTime ?? null,
                        isFocusedToday: task.isFocusedToday === true,
                        projectTitle: task.projectId ? cachedProjectTitles.get(task.projectId) ?? null : null,
                        hasNotes: typeof task.description === 'string' && task.description.length > 0,
                    })),
                },
            };
        },

        getTask(input: { id: string }): NativeHostResult<Task> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || typeof input.id !== 'string' || !input.id.trim()) return fail('INVALID_INPUT', 'Task ID is required');
            const task = useTaskStore.getState()._tasksById.get(input.id);
            if (!task || task.deletedAt) return fail('TASK_NOT_FOUND', 'Task not found');
            return { ok: true, value: JSON.parse(JSON.stringify(task)) as Task };
        },

        /** Reuse captureId for retries so a failed save cannot create a duplicate. */
        async createInboxTask(input: { title: string; captureId: string }): Promise<NativeHostResult<{ id: string }>> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || typeof input.title !== 'string' || !input.title.trim()
                || typeof input.captureId !== 'string' || !CAPTURE_ID_PATTERN.test(input.captureId)) {
                return fail('INVALID_INPUT', 'Task title and capture UUID are required');
            }
            try {
                const result = await useTaskStore.getState().addTask(input.title, { status: 'inbox' }, { captureId: input.captureId });
                if (!result.success || !result.id) {
                    const failure = useTaskStore.getState().persistenceFailure;
                    return fail(failure ? 'SAVE_FAILED' : 'ACTION_FAILED', failure?.message ?? result.error ?? 'Task creation failed');
                }
                const saved = await save();
                if (!saved.ok) return saved;
                return { ok: true, value: { id: result.id } };
            } catch (error) {
                return fail('ACTION_FAILED', error instanceof Error ? error.message : String(error));
            }
        },

        async completeTask(input: { id: string }): Promise<NativeHostResult<{ id: string }>> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || typeof input.id !== 'string' || !input.id.trim()) return fail('INVALID_INPUT', 'Task ID is required');
            const state = useTaskStore.getState();
            const task = state._tasksById.get(input.id);
            if (!task || task.deletedAt) return fail('TASK_NOT_FOUND', 'Task not found');
            try {
                if (task.status === 'done' && state.persistenceFailure) {
                    await state.retryPersistence();
                } else if (task.status !== 'done') {
                    const result = await state.updateTask(input.id, { status: 'done' });
                    if (!result.success) {
                        const failure = useTaskStore.getState().persistenceFailure;
                        return fail(failure ? 'SAVE_FAILED' : 'ACTION_FAILED', failure?.message ?? result.error ?? 'Task completion failed');
                    }
                }
                const saved = await save();
                if (!saved.ok) return saved;
                return { ok: true, value: { id: input.id } };
            } catch (error) {
                return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
            }
        },
    };
}
