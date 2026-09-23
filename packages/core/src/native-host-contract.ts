import { isTaskVisibleInArea, isTaskVisibleInInbox, resolveAreaFilterSelection } from './area-filter';
import { flushPendingSave, getPersistenceStatus, getStorageAdapter, useTaskStore } from './store';
import { noopStorage, type StorageAdapter } from './storage';
import { resolveNonDoneTaskSortBy } from './task-list-sort-options';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { sortTasksBy, splitTodayTasksByStartTime } from './task-utils';
import { hasTimeComponent, safeParseDate } from './date';
import { buildFocusPools, buildFocusTaskSections, DEFAULT_FOCUS_SORT_BY, deriveFocusTaskLists, type FocusTaskSection, type FocusTaskSectionKey } from './focus-sections';
import { formatLocalDate } from './import-source-reader';
import { resolveFeatureFlags } from './resolve-feature-flags';
import { isTaskActionable } from './task-status';
import { getEnglishI18nValue, getTranslator } from './i18n';
import { isSupportedLanguage } from './i18n/i18n-constants';
import { loadTranslations } from './i18n/i18n-loader';
import { resolveLanguageFromLocale } from './i18n/i18n-storage';
import type { Language } from './i18n/i18n-types';
import type { Project, Task, TaskPriority, TaskStatus } from './types';
import { generateUUID } from './uuid';

export const NATIVE_HOST_CONTRACT_VERSION = 1;
export const NATIVE_HOST_MAX_WINDOW = 100;
export const NATIVE_HOST_EDITOR_FIELDS = ['title', 'description', 'status', 'priority', 'projectId', 'startTime', 'dueDate'] as const;
export type NativeEditableFields = {
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority | null;
    projectId: string | null;
    startTime: string | null;
    dueDate: string | null;
};
export type NativeTaskEditor = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    id: string;
    fields: NativeEditableFields;
    projects: Array<Pick<Project, 'id' | 'title'>>;
    readOnly: boolean;
    statuses: TaskStatus[];
    priorities: TaskPriority[];
};

const CAPTURE_ID_PATTERN = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;
const EDITOR_FIELD_SET = new Set<string>(NATIVE_HOST_EDITOR_FIELDS);
const EDITOR_STATUSES = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done'] as const satisfies readonly TaskStatus[];
const EDITOR_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const satisfies readonly TaskPriority[];
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EDITOR_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/;

export type NativeHostErrorCode = 'NOT_READY' | 'INVALID_INPUT' | 'STALE_REVISION' | 'TASK_NOT_FOUND' | 'ACTION_FAILED' | 'SAVE_FAILED';
export type NativeHostResult<T> = { ok: true; value: T } | {
    ok: false;
    error: { code: NativeHostErrorCode; message: string };
};

export type NativeTaskRow = Pick<Task, 'id' | 'title' | 'status'> & {
    priority: Task['priority'] | null;
    dueDate: string | null;
    startTime: string | null;
    isFocusedToday: boolean;
    projectTitle: string | null;
    hasNotes: boolean;
    revealDate: string | null;
    laterToday: boolean;
};
export type NativeInboxRow = NativeTaskRow;
export type NativeInboxWindow = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Opaque within this host instance; send it back on later pages. */
    revision: string;
    total: number;
    rows: NativeInboxRow[];
};
export type NativeFocusSection = {
    key: FocusTaskSectionKey;
    title: string;
    total: number;
    rows: NativeTaskRow[];
};
export type NativeFocusView = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    revision: string;
    sections: NativeFocusSection[];
};

const toNativeTaskRow = (task: Task, projectTitles: Map<string, string>): NativeTaskRow => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority ?? null,
    dueDate: task.dueDate ?? null,
    startTime: task.startTime ?? null,
    isFocusedToday: task.isFocusedToday === true,
    projectTitle: task.projectId ? projectTitles.get(task.projectId) ?? null : null,
    hasNotes: typeof task.description === 'string' && task.description.length > 0,
    revealDate: null,
    laterToday: false,
});

const fail = (code: NativeHostErrorCode, message: string): NativeHostResult<never> => ({
    ok: false,
    error: { code, message },
});
const hasLoadError = (message: string | null): boolean => (
    message?.startsWith('Failed to fetch data') === true || message === 'Storage request timed out. Try again.'
);
const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);
const isValidEditorDate = (value: unknown): value is string => (
    typeof value === 'string'
    && safeParseDate(value) !== null
    && (DATE_ONLY_PATTERN.test(value) || (EDITOR_DATETIME_PATTERN.test(value) && hasTimeComponent(value)))
);
const normalizeEditorValue = (field: keyof NativeEditableFields, value: unknown): unknown => (
    value == null || (field === 'description' && value === '') ? null : value
);

/** One instance per serial native JS host. All reads and commands use the shared store. */
export function createNativeHostContract() {
    const processId = generateUUID();
    let language: Language = 'en';
    let translate = getTranslator(language);
    let readyAdapter: StorageAdapter | null = null;
    let generation = 0;
    let lastTasks = useTaskStore.getState()._allTasks;
    let lastProjects = useTaskStore.getState()._allProjects;
    let lastSections = useTaskStore.getState()._allSections;
    let lastSortBy = resolveNonDoneTaskSortBy(useTaskStore.getState().settings.taskSortBy, useTaskStore.getState().settings);
    let lastSettings = useTaskStore.getState().settings;
    let settingsGeneration = 0;
    let cachedRevision = '';
    let cachedInbox: Task[] = [];
    let cachedProjectTitles = new Map<string, string>();
    let cachedFocusRevision = '';
    let cachedFocusSections: FocusTaskSection[] = [];
    let cachedFocusProjectTitles = new Map<string, string>();
    let cachedRevealDates = new Map<string, string>();
    let cachedLaterTodayIds = new Set<string>();
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

    const focusRevision = (now: Date) => {
        const storeRevision = revision();
        const settings = useTaskStore.getState().settings;
        if (settings !== lastSettings) {
            settingsGeneration += 1;
            lastSettings = settings;
        }
        return `${storeRevision}:${settingsGeneration}:${formatLocalDate(now)}:${Math.floor(now.getTime() / 60_000)}:${language}`;
    };

    const focusSections = (currentRevision: string, now: Date): FocusTaskSection[] => {
        if (cachedFocusRevision !== currentRevision) {
            const state = useTaskStore.getState();
            const tasks = state.tasks.filter(isTaskActionable);
            const projectById = new Map(state.projects.map((project) => [project.id, project]));
            const resolvedAreaFilter = resolveAreaFilterSelection(undefined, state.areas);
            const visibleTasks = tasks.filter((task) => isTaskVisibleInArea(task, { projectById, resolvedAreaFilter }));
            const pools = buildFocusPools({ tasks, visibleTasks, projects: state.projects, criteria: undefined, now });
            const lists = deriveFocusTaskLists(pools, {
                now,
                projects: state.projects,
                sections: state.sections,
                sortBy: DEFAULT_FOCUS_SORT_BY,
                prioritiesEnabled: resolveFeatureFlags(state.settings).priorities,
                sortOrder: undefined,
            });
            const schedule = splitTodayTasksByStartTime(lists.schedule, now);
            cachedLaterTodayIds = new Set(schedule.laterToday.map((task) => task.id));
            cachedFocusSections = buildFocusTaskSections(lists, (key) => {
                const value = translate(key);
                return value === key ? undefined : value;
            }).map((section) => (
                section.key === 'schedule'
                    ? { ...section, items: [...schedule.ready, ...schedule.laterToday] }
                    : section
            ));
            cachedFocusProjectTitles = new Map(state.projects.map((project) => [project.id, project.title]));
            cachedRevealDates = new Map(pools.upcoming.map(({ task, appearsAt }) => [task.id, formatLocalDate(appearsAt)]));
            cachedFocusRevision = currentRevision;
        }
        return cachedFocusSections;
    };

    const focusRows = (section: FocusTaskSection, offset: number, limit: number): NativeTaskRow[] => (
        section.items.slice(offset, offset + limit).map((task) => ({
            ...toNativeTaskRow(task, cachedFocusProjectTitles),
            revealDate: section.key === 'upcoming' ? cachedRevealDates.get(task.id) ?? null : null,
            laterToday: section.key === 'schedule' && cachedLaterTodayIds.has(task.id),
        }))
    );

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

        async setLanguage(input: { storedLanguage: string | null; systemLocale: string | null }): Promise<NativeHostResult<{ language: Language }>> {
            if (!input || (input.storedLanguage !== null && typeof input.storedLanguage !== 'string')
                || (input.systemLocale !== null && typeof input.systemLocale !== 'string')) {
                return fail('INVALID_INPUT', 'Stored language and system locale must be strings or null');
            }
            const nextLanguage = isSupportedLanguage(input.storedLanguage)
                ? input.storedLanguage
                : resolveLanguageFromLocale(input.systemLocale);
            try {
                await loadTranslations('en');
                await loadTranslations(nextLanguage);
                language = nextLanguage;
                translate = getTranslator(language);
                return { ok: true, value: { language } };
            } catch (error) {
                return fail('ACTION_FAILED', error instanceof Error ? error.message : String(error));
            }
        },

        getStrings(input: { keys: string[] }): NativeHostResult<{ language: Language; strings: Record<string, string>; missing: string[] }> {
            if (!input || !Array.isArray(input.keys) || input.keys.length > 500
                || input.keys.some((key) => typeof key !== 'string')) {
                return fail('INVALID_INPUT', 'Up to 500 string keys are required');
            }
            const strings: Record<string, string> = {};
            const missing: string[] = [];
            for (const key of input.keys) {
                if (getEnglishI18nValue(key) === undefined) missing.push(key);
                else strings[key] = translate(key);
            }
            return { ok: true, value: { language, strings, missing } };
        },

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
                    rows: cachedInbox.slice(input.offset, input.offset + input.limit).map((task) => toNativeTaskRow(task, cachedProjectTitles)),
                },
            };
        },

        getFocus(input: { limit: number }): NativeHostResult<NativeFocusView> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > NATIVE_HOST_MAX_WINDOW) {
                return fail('INVALID_INPUT', 'A bounded limit is required');
            }
            const now = new Date();
            const currentRevision = focusRevision(now);
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision: currentRevision,
                    sections: focusSections(currentRevision, now).map((section) => ({
                        key: section.key,
                        title: section.title,
                        total: section.items.length,
                        rows: focusRows(section, 0, input.limit),
                    })),
                },
            };
        },

        getFocusSectionWindow(input: {
            key: FocusTaskSectionKey; offset: number; limit: number; revision: string;
        }): NativeHostResult<{
            version: typeof NATIVE_HOST_CONTRACT_VERSION;
            revision: string;
            key: FocusTaskSectionKey;
            total: number;
            rows: NativeTaskRow[];
        }> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || typeof input.key !== 'string'
                || !Number.isSafeInteger(input.offset) || input.offset < 0
                || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > NATIVE_HOST_MAX_WINDOW
                || typeof input.revision !== 'string') {
                return fail('INVALID_INPUT', 'A valid section, offset, bounded limit, and revision are required');
            }
            const now = new Date();
            const currentRevision = focusRevision(now);
            if (input.revision !== currentRevision) return fail('STALE_REVISION', 'Focus changed; restart paging');
            const section = focusSections(currentRevision, now).find(({ key }) => key === input.key);
            if (!section) return fail('INVALID_INPUT', 'Focus section is not available');
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision: currentRevision,
                    key: section.key,
                    total: section.items.length,
                    rows: focusRows(section, input.offset, input.limit),
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

        getTaskEditor(input: { id: string }): NativeHostResult<NativeTaskEditor> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || typeof input.id !== 'string' || !input.id.trim()) return fail('INVALID_INPUT', 'Task ID is required');
            const state = useTaskStore.getState();
            const task = state._tasksById.get(input.id);
            if (!task || task.deletedAt) return fail('TASK_NOT_FOUND', 'Task not found');
            const taskProject = task.projectId
                ? state._allProjects.find((project) => project.id === task.projectId)
                : undefined;
            const projects = state._allProjects
                .filter((project) => isSelectableProjectForTaskAssignment(project)
                    || (project.id === task.projectId && !project.deletedAt && project.status === 'archived'))
                .map(({ id, title }) => ({ id, title }));
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    id: task.id,
                    fields: {
                        title: task.title,
                        description: task.description ?? null,
                        status: task.status,
                        priority: task.priority ?? null,
                        projectId: task.projectId ?? null,
                        startTime: task.startTime ?? null,
                        dueDate: task.dueDate ?? null,
                    },
                    projects,
                    readOnly: taskProject?.status === 'archived',
                    statuses: [...EDITOR_STATUSES],
                    priorities: [...EDITOR_PRIORITIES],
                },
            };
        },

        async updateTask(input: {
            id: string;
            base: Partial<NativeEditableFields>;
            patch: Partial<NativeEditableFields>;
        }): Promise<NativeHostResult<{ id: string; changed: boolean }>> {
            const ready = readiness();
            if (!ready.ok) return ready;
            if (!input || typeof input.id !== 'string' || !input.id.trim()) return fail('INVALID_INPUT', 'Task ID is required');
            if (!isObjectRecord(input.base) || !isObjectRecord(input.patch)) {
                return fail('INVALID_INPUT', 'base and patch must be objects');
            }
            const patchKeys = Object.keys(input.patch);
            if (patchKeys.length === 0) return fail('INVALID_INPUT', 'patch must include an editor field');
            if (patchKeys.some((key) => !EDITOR_FIELD_SET.has(key))) {
                return fail('INVALID_INPUT', 'patch fields must be title, description, status, priority, projectId, startTime, or dueDate');
            }
            const baseKeys = Object.keys(input.base);
            const mismatchedFields = NATIVE_HOST_EDITOR_FIELDS.filter((field) =>
                Object.prototype.hasOwnProperty.call(input.base, field)
                !== Object.prototype.hasOwnProperty.call(input.patch, field));
            if (baseKeys.length !== patchKeys.length || mismatchedFields.length > 0) {
                const fields = mismatchedFields.length > 0 ? `: ${mismatchedFields.join(', ')}` : '';
                return fail('INVALID_INPUT', `base and patch fields must match${fields}`);
            }

            const state = useTaskStore.getState();
            const task = state._tasksById.get(input.id);
            if (!task || task.deletedAt) return fail('TASK_NOT_FOUND', 'Task not found');
            const taskProject = task.projectId
                ? state._allProjects.find((project) => project.id === task.projectId)
                : undefined;
            if (taskProject?.status === 'archived') {
                return fail('INVALID_INPUT', 'Task is read-only while its project is archived');
            }

            for (const key of patchKeys) {
                const field = key as keyof NativeEditableFields;
                const value = input.patch[field];
                switch (field) {
                    case 'title':
                        if (typeof value !== 'string' || !value.trim()) return fail('INVALID_INPUT', 'title must be a non-blank string');
                        break;
                    case 'status':
                        if (typeof value !== 'string' || !EDITOR_STATUSES.some((status) => status === value)) {
                            return fail('INVALID_INPUT', 'status must be an editable status');
                        }
                        break;
                    case 'description':
                        if (value != null && typeof value !== 'string') return fail('INVALID_INPUT', 'description must be a string or null');
                        break;
                    case 'priority':
                        if (value != null && !EDITOR_PRIORITIES.some((priority) => priority === value)) {
                            return fail('INVALID_INPUT', 'priority must be an editable priority or null');
                        }
                        break;
                    case 'projectId':
                        if (value != null) {
                            const project = typeof value === 'string'
                                ? state._allProjects.find((candidate) => candidate.id === value)
                                : undefined;
                            if (!project || !isSelectableProjectForTaskAssignment(project)) {
                                return fail('INVALID_INPUT', 'projectId must reference an editable project or null');
                            }
                        }
                        break;
                    case 'startTime':
                    case 'dueDate':
                        if (value != null && !isValidEditorDate(value)) {
                            return fail('INVALID_INPUT', `${field} must be a valid date or datetime`);
                        }
                        break;
                }
            }

            const resultingStatus = Object.prototype.hasOwnProperty.call(input.patch, 'status')
                ? input.patch.status
                : task.status;
            if (resultingStatus === 'reference') {
                for (const field of ['priority', 'startTime', 'dueDate'] as const) {
                    if (Object.prototype.hasOwnProperty.call(input.patch, field) && input.patch[field] != null) {
                        return fail('INVALID_INPUT', `${field} cannot be set while status is reference`);
                    }
                }
            }

            const updates: Partial<Task> = {};
            const conflicts: string[] = [];
            for (const key of patchKeys) {
                const field = key as keyof NativeEditableFields;
                const current = normalizeEditorValue(field, task[field]);
                const base = normalizeEditorValue(field, input.base[field]);
                const next = normalizeEditorValue(field, input.patch[field]);
                if (current === base) {
                    if (current !== next) Object.assign(updates, { [field]: next === null ? undefined : next });
                } else if (current !== next) {
                    conflicts.push(field);
                }
            }
            if (conflicts.length > 0) {
                return fail('STALE_REVISION', `Task changed while editing: ${conflicts.join(', ')}`);
            }

            const changed = Object.keys(updates).length > 0;
            try {
                if (changed) {
                    const result = await useTaskStore.getState().updateTask(input.id, updates);
                    if (!result.success) {
                        const failure = useTaskStore.getState().persistenceFailure;
                        return fail(failure ? 'SAVE_FAILED' : 'ACTION_FAILED', failure?.message ?? result.error ?? 'Task update failed');
                    }
                } else if (useTaskStore.getState().persistenceFailure) {
                    await useTaskStore.getState().retryPersistence();
                }
                const saved = await save();
                if (!saved.ok) return saved;
                return { ok: true, value: { id: input.id, changed } };
            } catch (error) {
                const failure = useTaskStore.getState().persistenceFailure;
                return fail(failure ? 'SAVE_FAILED' : 'ACTION_FAILED', failure?.message ?? (error instanceof Error ? error.message : String(error)));
            }
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
