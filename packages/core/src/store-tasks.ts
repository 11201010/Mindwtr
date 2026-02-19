import type { AppData, Task, TaskStatus } from './types';
import type { StorageAdapter, TaskQueryOptions } from './storage';
import type { TaskStore } from './store-types';
import {
    applyTaskUpdates,
    buildSaveSnapshot,
    ensureDeviceId,
    getNextProjectOrder,
    getReferenceTaskFieldClears,
    normalizeRevision,
    updateVisibleTasks,
} from './store-helpers';
import { generateUUID as uuidv4 } from './uuid';

type TaskActions = Pick<
    TaskStore,
    | 'addTask'
    | 'updateTask'
    | 'deleteTask'
    | 'restoreTask'
    | 'purgeTask'
    | 'purgeDeletedTasks'
    | 'duplicateTask'
    | 'resetTaskChecklist'
    | 'moveTask'
    | 'batchUpdateTasks'
    | 'batchMoveTasks'
    | 'batchDeleteTasks'
    | 'queryTasks'
>;

type TaskActionContext = {
    set: (partial: Partial<TaskStore> | ((state: TaskStore) => Partial<TaskStore> | TaskStore)) => void;
    get: () => TaskStore;
    getStorage: () => StorageAdapter;
    debouncedSave: (data: AppData, onError?: (msg: string) => void) => void;
};

export const createTaskActions = ({ set, get, getStorage, debouncedSave }: TaskActionContext): TaskActions => ({
    /**
     * Add a new task to the store and persist to storage.
     * @param title Task title
     * @param initialProps Optional initial properties
     */
    addTask: async (title: string, initialProps?: Partial<Task>) => {
        const changeAt = Date.now();
        const trimmedTitle = typeof title === 'string' ? title.trim() : '';
        if (!trimmedTitle) {
            set({ error: 'Task title is required' });
            return;
        }
        const resolvedStatus = (initialProps?.status ?? 'inbox') as TaskStatus;
        const hasOrderNum = Object.prototype.hasOwnProperty.call(initialProps ?? {}, 'orderNum');
        const resolvedProjectId = initialProps?.projectId;
        const resolvedSectionId = resolvedProjectId ? initialProps?.sectionId : undefined;
        const resolvedAreaId = resolvedProjectId ? undefined : initialProps?.areaId;
        const referenceClears = resolvedStatus === 'reference'
            ? getReferenceTaskFieldClears()
            : {};
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;

        set((state) => {
            const deviceState = ensureDeviceId(state.settings);
            const deviceId = deviceState.deviceId;
            const resolvedOrderNum = !hasOrderNum && resolvedProjectId
                ? getNextProjectOrder(resolvedProjectId, state._allTasks, state.lastDataChangeAt)
                : initialProps?.orderNum;
            const newTask: Task = {
                id: uuidv4(),
                title: trimmedTitle,
                status: resolvedStatus,
                taskMode: 'task',
                tags: [],
                contexts: [],
                pushCount: 0,
                rev: 1,
                revBy: deviceId,
                createdAt: now,
                updatedAt: now,
                ...initialProps,
                ...referenceClears,
                areaId: resolvedAreaId,
                projectId: resolvedProjectId,
                sectionId: resolvedSectionId,
                orderNum: resolvedOrderNum,
            };

            const newAllTasks = [...state._allTasks, newTask];
            const newVisibleTasks = updateVisibleTasks(state.tasks, null, newTask);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });

        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Update an existing task.
     * @param id Task ID
     * @param updates Properties to update
     */
    updateTask: async (id: string, updates: Partial<Task>) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;
        set((state) => {
            const oldTask = state._allTasks.find((t) => t.id === id);
            if (!oldTask) return state;
            const deviceState = ensureDeviceId(state.settings);
            const nextRevision = {
                rev: normalizeRevision(oldTask.rev) + 1,
                revBy: deviceState.deviceId,
            };

            let adjustedUpdates = updates;
            if (Object.prototype.hasOwnProperty.call(updates, 'projectId')) {
                const rawProjectId = updates.projectId;
                const normalizedProjectId =
                    typeof rawProjectId === 'string' && rawProjectId.trim().length > 0
                        ? rawProjectId
                        : undefined;
                const nextProjectId = normalizedProjectId ?? undefined;
                const projectChanged = (oldTask.projectId ?? undefined) !== nextProjectId;
                if (projectChanged) {
                    const shouldClearSection = !Object.prototype.hasOwnProperty.call(updates, 'sectionId');
                    const hasOrderNum = Object.prototype.hasOwnProperty.call(updates, 'orderNum');
                    if (nextProjectId) {
                        if (!hasOrderNum) {
                            adjustedUpdates = {
                                ...adjustedUpdates,
                                orderNum: getNextProjectOrder(nextProjectId, state._allTasks, state.lastDataChangeAt),
                            };
                        }
                        if (!Object.prototype.hasOwnProperty.call(updates, 'areaId')) {
                            adjustedUpdates = {
                                ...adjustedUpdates,
                                areaId: undefined,
                            };
                        }
                        if (shouldClearSection) {
                            adjustedUpdates = {
                                ...adjustedUpdates,
                                sectionId: undefined,
                            };
                        }
                    } else {
                        adjustedUpdates = {
                            ...adjustedUpdates,
                            projectId: undefined,
                            orderNum: undefined,
                            sectionId: undefined,
                        };
                    }
                } else if (normalizedProjectId !== updates.projectId) {
                    adjustedUpdates = {
                        ...adjustedUpdates,
                        projectId: normalizedProjectId,
                    };
                }
            }

            const { updatedTask, nextRecurringTask } = applyTaskUpdates(
                oldTask,
                { ...adjustedUpdates, ...nextRevision },
                now
            );

            const updatedAllTasks = state._allTasks.map((task) =>
                task.id === id ? updatedTask : task
            );

            if (nextRecurringTask) updatedAllTasks.push(nextRecurringTask);

            let updatedVisibleTasks = updateVisibleTasks(state.tasks, oldTask, updatedTask);
            if (nextRecurringTask) {
                updatedVisibleTasks = updateVisibleTasks(updatedVisibleTasks, null, nextRecurringTask);
            }
            snapshot = buildSaveSnapshot(state, {
                tasks: updatedAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: updatedVisibleTasks,
                _allTasks: updatedAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });

        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Soft-delete a task by setting deletedAt.
     * @param id Task ID
     */
    deleteTask: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;
        set((state) => {
            const oldTask = state._allTasks.find((task) => task.id === id);
            if (!oldTask) return state;
            const deviceState = ensureDeviceId(state.settings);
            const updatedTask = {
                ...oldTask,
                deletedAt: now,
                updatedAt: now,
                rev: normalizeRevision(oldTask.rev) + 1,
                revBy: deviceState.deviceId,
            };
            // Update in full data (set tombstone)
            const newAllTasks = state._allTasks.map((task) =>
                task.id === id ? updatedTask : task
            );
            // Filter for UI state (hide deleted)
            const newVisibleTasks = updateVisibleTasks(state.tasks, oldTask, updatedTask);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Restore a soft-deleted task.
     */
    restoreTask: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;
        set((state) => {
            const oldTask = state._allTasks.find((task) => task.id === id);
            if (!oldTask) return state;
            const deviceState = ensureDeviceId(state.settings);
            const updatedTask = {
                ...oldTask,
                deletedAt: undefined,
                purgedAt: undefined,
                updatedAt: now,
                rev: normalizeRevision(oldTask.rev) + 1,
                revBy: deviceState.deviceId,
            };
            const newAllTasks = state._allTasks.map((task) =>
                task.id === id ? updatedTask : task
            );
            const newVisibleTasks = updateVisibleTasks(state.tasks, oldTask, updatedTask);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Permanently delete a task (removes from storage).
     */
    purgeTask: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;
        set((state) => {
            const oldTask = state._allTasks.find((task) => task.id === id);
            if (!oldTask) return state;
            const deviceState = ensureDeviceId(state.settings);
            const updatedTask = {
                ...oldTask,
                deletedAt: oldTask.deletedAt ?? now,
                purgedAt: now,
                updatedAt: now,
                rev: normalizeRevision(oldTask.rev) + 1,
                revBy: deviceState.deviceId,
            };
            const newAllTasks = state._allTasks.map((task) =>
                task.id === id ? updatedTask : task
            );
            const newVisibleTasks = updateVisibleTasks(state.tasks, oldTask, updatedTask);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Permanently delete all soft-deleted tasks.
     */
    purgeDeletedTasks: async () => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;
        set((state) => {
            const deviceState = ensureDeviceId(state.settings);
            const newAllTasks = state._allTasks.map((task) =>
                task.deletedAt
                    ? {
                        ...task,
                        purgedAt: now,
                        updatedAt: now,
                        rev: normalizeRevision(task.rev) + 1,
                        revBy: deviceState.deviceId,
                    }
                    : task
            );
            const newVisibleTasks = newAllTasks.filter((task) => !task.deletedAt && task.status !== 'archived');
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Duplicate a task for reusable lists/templates.
     */
    duplicateTask: async (id: string, asNextAction?: boolean) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;
        set((state) => {
            const sourceTask = state._allTasks.find((task) => task.id === id && !task.deletedAt);
            if (!sourceTask) return state;
            const deviceState = ensureDeviceId(state.settings);

            const duplicatedChecklist = (sourceTask.checklist || []).map((item) => ({
                ...item,
                id: uuidv4(),
                isCompleted: false,
            }));
            const duplicatedAttachments = (sourceTask.attachments || []).map((attachment) => ({
                ...attachment,
                id: uuidv4(),
                createdAt: now,
                updatedAt: now,
                deletedAt: undefined,
            }));

            const newTask: Task = {
                ...sourceTask,
                id: uuidv4(),
                title: `${sourceTask.title} (Copy)`,
                status: asNextAction ? 'next' : 'inbox',
                checklist: duplicatedChecklist.length > 0 ? duplicatedChecklist : undefined,
                attachments: duplicatedAttachments.length > 0 ? duplicatedAttachments : undefined,
                startTime: undefined,
                dueDate: undefined,
                recurrence: undefined,
                reviewAt: undefined,
                completedAt: undefined,
                isFocusedToday: false,
                pushCount: 0,
                deletedAt: undefined,
                createdAt: now,
                updatedAt: now,
                rev: 1,
                revBy: deviceState.deviceId,
                orderNum: sourceTask.projectId
                    ? getNextProjectOrder(sourceTask.projectId, state._allTasks, state.lastDataChangeAt)
                    : undefined,
            };

            const newAllTasks = [...state._allTasks, newTask];
            const newVisibleTasks = updateVisibleTasks(state.tasks, null, newTask);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Reset checklist items to unchecked (useful for reusable lists).
     */
    resetTaskChecklist: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot: AppData | null = null;
        set((state) => {
            const sourceTask = state._allTasks.find((task) => task.id === id && !task.deletedAt);
            if (!sourceTask || !sourceTask.checklist || sourceTask.checklist.length === 0) return state;
            const deviceState = ensureDeviceId(state.settings);

            const resetChecklist = sourceTask.checklist.map((item) => ({
                ...item,
                isCompleted: false,
            }));
            const wasDone = sourceTask.status === 'done';
            const nextStatus: TaskStatus = wasDone ? 'next' : sourceTask.status;

            const updatedTask: Task = {
                ...sourceTask,
                checklist: resetChecklist,
                status: nextStatus,
                completedAt: wasDone ? undefined : sourceTask.completedAt,
                isFocusedToday: wasDone ? false : sourceTask.isFocusedToday,
                updatedAt: now,
                rev: normalizeRevision(sourceTask.rev) + 1,
                revBy: deviceState.deviceId,
            };

            const newAllTasks = state._allTasks.map((task) => (task.id === id ? updatedTask : task));
            const newVisibleTasks = updateVisibleTasks(state.tasks, sourceTask, updatedTask);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    /**
     * Move a task to a different status.
     * @param id Task ID
     * @param newStatus New status
     */
    moveTask: async (id: string, newStatus: TaskStatus) => {
        // Delegate to updateTask to ensure recurrence/metadata logic is applied
        await get().updateTask(id, { status: newStatus });
    },

    /**
     * Batch update tasks in a single save cycle.
     */
    batchUpdateTasks: async (updatesList: Array<{ id: string; updates: Partial<Task> }>) => {
        if (updatesList.length === 0) return;
        const changeAt = Date.now();
        const now = new Date().toISOString();
        const updatesById = new Map(updatesList.map((u) => [u.id, u.updates]));
        const nextRecurringTasks: Task[] = [];
        let snapshot: AppData | null = null;

        set((state) => {
            const deviceState = ensureDeviceId(state.settings);
            let newVisibleTasks = state.tasks;
            const newAllTasks = state._allTasks.map((task) => {
                const updates = updatesById.get(task.id);
                if (!updates) return task;
                const { updatedTask, nextRecurringTask } = applyTaskUpdates(
                    task,
                    {
                        ...updates,
                        rev: normalizeRevision(task.rev) + 1,
                        revBy: deviceState.deviceId,
                    },
                    now
                );
                if (nextRecurringTask) nextRecurringTasks.push(nextRecurringTask);
                newVisibleTasks = updateVisibleTasks(newVisibleTasks, task, updatedTask);
                return updatedTask;
            });

            if (nextRecurringTasks.length > 0) {
                newAllTasks.push(...nextRecurringTasks);
                nextRecurringTasks.forEach((task) => {
                    newVisibleTasks = updateVisibleTasks(newVisibleTasks, null, task);
                });
            }

            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });

            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });

        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    batchMoveTasks: async (ids: string[], newStatus: TaskStatus) => {
        await get().batchUpdateTasks(ids.map((id) => ({ id, updates: { status: newStatus } })));
    },

    batchDeleteTasks: async (ids: string[]) => {
        if (ids.length === 0) return;
        const changeAt = Date.now();
        const now = new Date().toISOString();
        const idSet = new Set(ids);
        let snapshot: AppData | null = null;
        set((state) => {
            const deviceState = ensureDeviceId(state.settings);
            let newVisibleTasks = state.tasks;
            const newAllTasks = state._allTasks.map((task) => {
                if (!idSet.has(task.id)) return task;
                const updatedTask = {
                    ...task,
                    deletedAt: now,
                    updatedAt: now,
                    rev: normalizeRevision(task.rev) + 1,
                    revBy: deviceState.deviceId,
                };
                newVisibleTasks = updateVisibleTasks(newVisibleTasks, task, updatedTask);
                return updatedTask;
            });
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: changeAt,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    queryTasks: async (options: TaskQueryOptions) => {
        const storage = getStorage();
        if (storage.queryTasks) {
            return storage.queryTasks(options);
        }
        const tasks = get()._allTasks;
        const statusFilter = options.status;
        const excludeStatuses = options.excludeStatuses ?? [];
        const includeArchived = options.includeArchived === true;
        const includeDeleted = options.includeDeleted === true;
        return tasks.filter((task) => {
            if (!includeDeleted && task.deletedAt) return false;
            if (!includeArchived && task.status === 'archived') return false;
            if (statusFilter && statusFilter !== 'all' && task.status !== statusFilter) return false;
            if (excludeStatuses.length > 0 && excludeStatuses.includes(task.status)) return false;
            if (options.projectId && task.projectId !== options.projectId) return false;
            return true;
        });
    },
});
