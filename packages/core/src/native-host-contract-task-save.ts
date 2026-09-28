import type { NativeHostResult } from './native-host-contract';
import type { PreparedTaskEdit } from './store-types';
import type { Task } from './types';
import { useTaskStore } from './store';
import { applyTaskUpdates, createProjectOrderReserver, findTaskProjectReactivationTarget, normalizeTaskUpdate } from './store-helpers';
import { applyPreparedTaskEditChanges, buildPreparedTaskEditChanges, prepareTaskUpdatesForStore, taskEditValuesEqual } from './store-tasks';
import { createTaskDraft, resolveTaskDraftTitle, taskDraftToUpdatePatch, type TaskDraft, type TaskDraftField } from './task-draft';
import { applyTaskDraftPatch, buildTaskEditUpdatePatch } from './task-editor-model';
import { isStatusListTaskReadOnly } from './menu-views-model';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { normalizeRelativeStartOffset } from './task-relative-start';
import { normalizeCancellationTimestamp } from './task-status';
import { normalizeRecurrenceForLoad } from './recurrence';
import { hasTimeComponent } from './date';
import { logInfo } from './logger';

export type NativeTaskScheduleBase = {
    startTime: string | null;
    dueDate: string | null;
    relativeStartOffset: Exclude<Task['relativeStartOffset'], undefined> | null;
    reviewAt: string | null;
};
export type NativeTaskRecurrenceBase = {
    recurrence: Exclude<Task['recurrence'], undefined> | null;
    showFutureRecurrence: boolean | null;
};
type SaveField = 'title' | 'description' | 'priority' | 'energyLevel' | 'timeEstimate' | 'contexts' | 'tags' | 'status'
    | 'projectId' | 'areaId' | 'sectionId' | 'startTime' | 'dueDate' | 'reviewAt' | 'relativeStartOffset'
    | 'recurrence' | 'recurrenceStrategy' | 'recurrenceRRule' | 'showFutureRecurrence';
type SaveFields = Partial<{ [K in SaveField]: Exclude<TaskDraft[K], undefined> | (K extends 'relativeStartOffset' ? null : never) }>;
export type NativeTaskDraftSaveRequest = {
    id: string;
    base: SaveFields;
    patch: SaveFields;
    scheduleBase: NativeTaskScheduleBase;
    /** Required exactly when the complete recurrence draft tuple is supplied. */
    recurrenceBase?: NativeTaskRecurrenceBase;
};
/** Private journal payload. The host persists this exact result before commit. */
export type NativePreparedTaskDraftSave = PreparedTaskEdit & { version: 1; request: NativeTaskDraftSaveRequest };

const FIELDS: readonly SaveField[] = ['title', 'description', 'priority', 'energyLevel', 'timeEstimate', 'contexts', 'tags', 'status',
    'projectId', 'areaId', 'sectionId', 'startTime', 'dueDate', 'reviewAt', 'relativeStartOffset',
    'recurrence', 'recurrenceStrategy', 'recurrenceRRule', 'showFutureRecurrence'];
const STORED_FIELDS = FIELDS.filter((field) => field !== 'recurrenceStrategy' && field !== 'recurrenceRRule');
const SCHEDULE = ['startTime', 'dueDate', 'relativeStartOffset', 'reviewAt'] as const;
const RECURRENCE = ['recurrence', 'recurrenceStrategy', 'recurrenceRRule', 'showFutureRecurrence'] as const;
const ASSOCIATIONS = ['projectId', 'areaId', 'sectionId'] as const;
const EFFECTS = ['status', 'isFocusedToday', 'focusOrder', 'boardOrder', 'order', 'orderNum', 'pushCount',
    'completedAt', 'cancelledAt', 'statusBeforeProjectArchive', 'completedAtBeforeProjectArchive',
    'isFocusedTodayBeforeProjectArchive', 'projectArchivedAt'];
const own = (value: object, field: string) => Object.prototype.hasOwnProperty.call(value, field);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every((field) => own(value, field));
const fail = (code: 'INVALID_INPUT' | 'STALE_REVISION' | 'TASK_NOT_FOUND' | 'SAVE_FAILED', message: string): NativeHostResult<never> => ({ ok: false, error: { code, message } });

// Strict JSON, including explicit null clears. Do not silently lose undefined,
// non-finite numbers, prototypes, or cyclic/oversized journal content.
const detach = (value: unknown, limit: number): unknown => {
    const check = (item: unknown, depth: number): boolean => {
        if (depth > 30) return false;
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
        if (typeof item === 'number') return Number.isFinite(item);
        if (Array.isArray(item)) return item.length <= 10_000 && item.every((entry) => check(entry, depth + 1));
        return record(item) && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)
            && Object.keys(item).length <= 256 && Object.entries(item).every(([name, entry]) =>
                !['__proto__', 'constructor', 'prototype'].includes(name) && check(entry, depth + 1));
    };
    if (!check(value, 0)) return null;
    const text = JSON.stringify(value);
    return text.length <= limit ? JSON.parse(text) : null;
};

/** Raw saved representation, detached from the task. Retain the opening model's baseline. */
export const getNativeTaskScheduleBase = (task: Task): NativeTaskScheduleBase => JSON.parse(JSON.stringify({
    startTime: task.startTime ?? null, dueDate: task.dueDate ?? null,
    relativeStartOffset: task.relativeStartOffset ?? null, reviewAt: task.reviewAt ?? null,
}));
export const getNativeTaskRecurrenceBase = (task: Task): NativeTaskRecurrenceBase => JSON.parse(JSON.stringify({
    recurrence: task.recurrence ?? null, showFutureRecurrence: task.showFutureRecurrence ?? null,
}));

export const nativeTaskDraftPatchValues = (request: NativeTaskDraftSaveRequest): Partial<TaskDraft> => Object.fromEntries(
    Object.entries(request.patch).map(([field, value]) => [field, value === null ? undefined : value]),
);
export const readNativeTaskDraftSaveRequest = (input: unknown, validateField: (field: TaskDraftField, value: unknown) => boolean, allowChecklist = false): NativeTaskDraftSaveRequest | null => {
    const value = detach(input, 1_000_000);
    if (!record(value)
        || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 500
        || !record(value.base) || !record(value.patch) || !record(value.scheduleBase)) return null;
    const fields = Object.keys(value.patch);
    const editsRecurrence = RECURRENCE.some((field) => own(value.patch as object, field));
    if (!keys(value, ['id', 'base', 'patch', 'scheduleBase', ...(editsRecurrence ? ['recurrenceBase'] : [])])
        || (!allowChecklist && !(editsRecurrence || fields.some((field) => (SCHEDULE as readonly string[]).includes(field))))
        || !keys(value.base, fields) || fields.some((field) => !(FIELDS as readonly string[]).includes(field) || (!allowChecklist && field === 'status'))) return null;
    if (editsRecurrence && (!RECURRENCE.every((field) => own(value.patch as object, field))
        || !record(value.recurrenceBase) || !keys(value.recurrenceBase, ['recurrence', 'showFutureRecurrence'])
        || !(value.recurrenceBase.recurrence === null || typeof value.recurrenceBase.recurrence === 'string' || record(value.recurrenceBase.recurrence))
        || !(value.recurrenceBase.showFutureRecurrence === null || typeof value.recurrenceBase.showFutureRecurrence === 'boolean'))) return null;
    if (ASSOCIATIONS.some((field) => own(value.patch as object, field))
        && !ASSOCIATIONS.every((field) => own(value.patch as object, field))) return null;
    const scheduleBase = value.scheduleBase;
    if (!keys(scheduleBase, SCHEDULE)
        || !['startTime', 'dueDate', 'reviewAt'].every((field) => scheduleBase[field] === null || typeof scheduleBase[field] === 'string')
        || !(value.scheduleBase.relativeStartOffset === null || record(value.scheduleBase.relativeStartOffset))) return null;
    for (const field of fields as SaveField[]) {
        const next = value.patch[field];
        const base = value.base[field];
        if ((RECURRENCE as readonly string[]).includes(field)
            ? !validateField(field, base)
            : field === 'relativeStartOffset' ? !(base === null || record(base)) : typeof base !== 'string') return null;
        if (!validateField(field, next === null && field === 'relativeStartOffset' ? undefined : next)) return null;
    }
    return value as unknown as NativeTaskDraftSaveRequest;
};
export const serializeNativeTaskDraftDirect = (before: Task, request: NativeTaskDraftSaveRequest) => taskDraftToUpdatePatch({
    ...createTaskDraft(before), ...nativeTaskDraftPatchValues(request),
    ...(own(request.patch, 'title') ? { title: resolveTaskDraftTitle(request.patch.title!, request.base.title!) } : {}),
}, before);
export const validNativeTaskDraftBases = (before: Task, request: NativeTaskDraftSaveRequest): boolean => {
    if (!taskEditValuesEqual(getNativeTaskScheduleBase(before), request.scheduleBase)) return false;
    if (request.recurrenceBase && !taskEditValuesEqual(getNativeTaskRecurrenceBase(before), request.recurrenceBase)) return false;
    const serialized = serializeNativeTaskDraftDirect(before, request);
    if (!serialized) return false;
    const current = createTaskDraft(before);
    const next = createTaskDraft({ ...before, ...serialized });
    return (Object.keys(request.patch) as SaveField[]).every((field) => (SCHEDULE as readonly string[]).includes(field)
        || taskEditValuesEqual(current[field], request.base[field])
        || (!(RECURRENCE as readonly string[]).includes(field) && taskEditValuesEqual(current[field], next[field])));
};


/** Bind direct dates and frozen linked-start shape without reparsing in a new zone. */
export const validNativeTaskDraftScheduleEffect = (before: Task, request: NativeTaskDraftSaveRequest, after: Task,
    validateField: (field: TaskDraftField, value: unknown) => boolean): boolean => {
    for (const field of ['dueDate', 'reviewAt'] as const) {
        const expected = own(request.patch, field) ? request.patch[field] || undefined : before[field];
        if (!taskEditValuesEqual(after[field], expected)) return false;
    }
    const linkedEdit = ['dueDate', 'startTime', 'relativeStartOffset'].some((field) => own(request.patch, field));
    const offset = normalizeRelativeStartOffset(own(request.patch, 'relativeStartOffset') ? request.patch.relativeStartOffset : before.relativeStartOffset);
    const mustClearOffset = own(request.patch, 'relativeStartOffset') && request.patch.relativeStartOffset === null
        || !after.dueDate || Boolean(offset && !hasTimeComponent(after.dueDate) && ['minute', 'hour'].includes(offset.unit));
    if (!linkedEdit) {
        if (!taskEditValuesEqual(after.startTime, before.startTime) || !taskEditValuesEqual(after.relativeStartOffset, before.relativeStartOffset)) return false;
    } else {
        if (mustClearOffset && after.relativeStartOffset != null) return false;
        if (after.relativeStartOffset != null && !taskEditValuesEqual(after.relativeStartOffset, offset)) return false;
        // A due-only edit retains a usable existing link. Only an explicit
        // start edit can break it without one of the deterministic clears.
        const retainsOffset = own(request.patch, 'relativeStartOffset') || !own(request.patch, 'startTime');
        if (!mustClearOffset && retainsOffset && offset && !taskEditValuesEqual(after.relativeStartOffset, offset)) return false;
        if (after.relativeStartOffset) {
            // Frozen derived output: validate shape/representation, not a
            // second calculation in the recovery process's timezone.
            if (!after.startTime || !validateField('startTime', after.startTime)
                || hasTimeComponent(after.startTime) !== hasTimeComponent(after.dueDate)
                || (/Z$|[+-]\d{2}:?\d{2}$/.test(after.startTime) !== /Z$|[+-]\d{2}:?\d{2}$/.test(after.dueDate!))) return false;
        } else if (!taskEditValuesEqual(after.startTime, own(request.patch, 'startTime') ? request.patch.startTime || undefined : before.startTime)) return false;
    }
    return true;
};

export function createTaskDraftSaveMethods(deps: {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    validateField: (field: TaskDraftField, value: unknown) => boolean;
}) {
    const patchValues = nativeTaskDraftPatchValues;
    const readRequest = (input: unknown) => readNativeTaskDraftSaveRequest(input, deps.validateField);
    const serializedDirect = serializeNativeTaskDraftDirect;
    const validBases = validNativeTaskDraftBases;

    /** Check semantic authority without rerunning calendar or clock-dependent effects. */
    const validPrepared = (prepared: NativePreparedTaskDraftSave): boolean => {
        const { before, changes, request } = prepared;
        if (before.id !== request.id || typeof before.title !== 'string' || typeof before.createdAt !== 'string'
            || typeof before.updatedAt !== 'string' || !['inbox', 'next', 'waiting', 'someday', 'done', 'archived'].includes(before.status)
            || before.deletedAt || before.purgedAt || !validBases(before, request)) return false;
        if (Object.keys(changes).some((field) => !(STORED_FIELDS as readonly string[]).includes(field) && !EFFECTS.includes(field))) return false;
        const after = applyPreparedTaskEditChanges(prepared);
        if (!taskEditValuesEqual(changes, buildPreparedTaskEditChanges(before, after))) return false;
        const direct = serializedDirect(before, request);
        if (!direct) return false;
        for (const field of FIELDS) {
            if (field === 'status') continue; // The older date route may induce status promotion, but cannot request it.
            if ((SCHEDULE as readonly string[]).includes(field) || (ASSOCIATIONS as readonly string[]).includes(field)
                || (RECURRENCE as readonly string[]).includes(field)) continue;
            if (own(changes, field) && !own(request.patch, field)) return false;
            if (own(request.patch, field) && !taskEditValuesEqual(after[field as keyof Task], direct[field as keyof Task])) return false;
        }
        // Match RN's narrowed recurrence write, preserving untouched legacy raw
        // values. Only the recurrence projection is normalized here; clock and
        // timezone-dependent schedule/focus effects remain frozen in changes.
        const recurrenceUpdates = request.recurrenceBase ? buildTaskEditUpdatePatch({
            draft: applyTaskDraftPatch(createTaskDraft(before), patchValues(request)),
            checklist: before.checklist, attachments: before.attachments,
        }, before) : null;
        const changesRecurrence = recurrenceUpdates && own(recurrenceUpdates, 'recurrence');
        const recurrence = changesRecurrence
            ? normalizeTaskUpdate(before, { recurrence: recurrenceUpdates.recurrence }).recurrence : before.recurrence;
        if (changesRecurrence && recurrence && (typeof recurrence !== 'object'
            || recurrence.seriesId !== (normalizeRecurrenceForLoad(before.recurrence)?.seriesId ?? before.id))) return false;
        const showFutureRecurrence = recurrenceUpdates && own(recurrenceUpdates, 'showFutureRecurrence')
            ? recurrenceUpdates.showFutureRecurrence : before.showFutureRecurrence;
        if (!taskEditValuesEqual(after.recurrence, recurrence) || !taskEditValuesEqual(after.showFutureRecurrence, showFutureRecurrence)) return false;
        if (!validNativeTaskDraftScheduleEffect(before, request, after, deps.validateField)) return false;
        const moves = ASSOCIATIONS.some((field) => own(request.patch, field));
        const projectId = moves ? request.patch.projectId || undefined : before.projectId;
        const sectionId = moves ? (projectId ? request.patch.sectionId || undefined : undefined) : before.sectionId;
        const areaId = projectId ? undefined : moves ? request.patch.areaId || undefined : before.areaId;
        if (!taskEditValuesEqual(after.projectId, projectId) || !taskEditValuesEqual(after.sectionId, sectionId) || !taskEditValuesEqual(after.areaId, areaId)) return false;
        const promotes = before.status === 'inbox' && Boolean(after.startTime) && !taskEditValuesEqual(before.startTime, after.startTime);
        if (after.status !== (promotes ? 'next' : before.status)) return false;
        if (own(changes, 'isFocusedToday') && after.isFocusedToday !== false) return false;
        if (own(changes, 'focusOrder') && after.focusOrder !== undefined) return false;
        if (own(changes, 'boardOrder') && (after.boardOrder !== undefined || after.status === before.status)) return false;
        if (['done', 'archived'].includes(after.status) && (after.isFocusedToday !== false || after.focusOrder !== undefined)) return false;
        for (const field of ['order', 'orderNum'] as const) {
            if (!own(changes, field)) continue;
            if (taskEditValuesEqual(before.projectId, after.projectId) || (after.projectId
                ? typeof after[field] !== 'number' || !Number.isFinite(after[field]) || !taskEditValuesEqual(after.order, after.orderNum)
                : after[field] !== undefined)) return false;
        }
        if (own(changes, 'pushCount') && (!own(request.patch, 'dueDate') || after.pushCount !== (before.pushCount ?? 0) + 1)) return false;
        const cancelledAt = after.status === 'archived' ? normalizeCancellationTimestamp(before.cancelledAt) : undefined;
        if (!taskEditValuesEqual(after.cancelledAt, cancelledAt)) return false;
        const completed = ['done', 'archived'].includes(after.status) && !cancelledAt;
        if (!completed ? after.completedAt !== undefined : before.completedAt
            ? after.completedAt !== before.completedAt : !after.completedAt || !deps.validateField('completedAt', after.completedAt)) return false;
        for (const field of ['statusBeforeProjectArchive', 'completedAtBeforeProjectArchive', 'isFocusedTodayBeforeProjectArchive', 'projectArchivedAt'] as const) {
            if (!taskEditValuesEqual(after[field], before.projectArchivedAt ? undefined : before[field])) return false;
        }
        return true;
    };
    const readPrepared = (input: unknown): NativePreparedTaskDraftSave | null => {
        const value = detach(input, 2_000_000);
        if (!record(value) || !keys(value, ['version', 'request', 'before', 'changes']) || value.version !== 1
            || !record(value.before) || !record(value.changes)) return null;
        const request = readRequest(value.request);
        if (!request) return null;
        const prepared = { ...value, request } as unknown as NativePreparedTaskDraftSave;
        try {
            return validPrepared(prepared) ? prepared : null;
        } catch {
            // A journal is untrusted JSON; typed draft helpers may reject a
            // malformed raw before value by throwing. Refuse it without writes.
            return null;
        }
    };

    return {
        prepareTaskDraftSave(input: NativeTaskDraftSaveRequest): NativeHostResult<NativePreparedTaskDraftSave> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A complete date or recurrence save request and raw baselines are required');
            const state = useTaskStore.getState();
            const task = state._tasksById.get(request.id);
            if (!task || task.deletedAt || task.purgedAt) return fail('TASK_NOT_FOUND', 'Task not found');
            if (task.status === 'reference' || isStatusListTaskReadOnly(task, state._allProjects)) return fail('INVALID_INPUT', 'Task is not editable');
            if (!validBases(task, request)) return fail('STALE_REVISION', 'Task changed while editing');
            if (own(request.patch, 'projectId') && request.patch.projectId
                && !state._allProjects.some((project) => project.id === request.patch.projectId && isSelectableProjectForTaskAssignment(project))) {
                return fail('INVALID_INPUT', 'Project is not available');
            }
            if (request.patch.areaId && !state._allAreas.some((area) => area.id === request.patch.areaId && !area.deletedAt)) {
                return fail('INVALID_INPUT', 'Area is not available');
            }
            if (request.patch.sectionId && !state._allSections.some((section) => section.id === request.patch.sectionId
                && section.projectId === request.patch.projectId && !section.deletedAt)) {
                return fail('INVALID_INPUT', 'Section is not available');
            }
            const draft = applyTaskDraftPatch(createTaskDraft(task), patchValues(request));
            const updates = buildTaskEditUpdatePatch({ draft, checklist: task.checklist, attachments: task.attachments }, task);
            if (!updates) return fail('INVALID_INPUT', 'title must not be blank');
            // An explicit date requests its raw representation, even if it is
            // textually equal to the current ISO value's display projection.
            for (const field of SCHEDULE) {
                if (own(request.patch, field)) Object.assign(updates, { [field]: draft[field] || undefined });
            }
            if (findTaskProjectReactivationTarget(task, updates, state._allProjects)) return fail('INVALID_INPUT', 'Project reactivation is outside this edit');
            const resolved = prepareTaskUpdatesForStore({ task, updates, allProjects: state._allProjects,
                allSections: state._allSections, allAreas: state._allAreas, settings: state.settings,
                projectOrderReserver: createProjectOrderReserver(state._allTasks) });
            if (!resolved.ok) return fail('INVALID_INPUT', resolved.error);
            const applied = applyTaskUpdates(task, resolved.updates, new Date().toISOString());
            if (applied.nextRecurringTask) return fail('INVALID_INPUT', 'Recurring task creation is outside this edit');
            const before = JSON.parse(JSON.stringify(task)) as Task;
            const prepared = readPrepared({ version: 1, request, before, changes: buildPreparedTaskEditChanges(before, applied.updatedTask) });
            return prepared ? { ok: true, value: prepared } : fail('INVALID_INPUT', 'Task edit cannot produce a valid prepared journal');
        },

        async commitPreparedTaskDraftSave(input: { request: NativeTaskDraftSaveRequest; prepared: NativePreparedTaskDraftSave }): Promise<NativeHostResult<{ id: string; draft: TaskDraft }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!record(input) || !keys(input, ['request', 'prepared'])) return fail('INVALID_INPUT', 'A prepared task edit is required');
            const request = readRequest(input.request);
            const prepared = readPrepared(input.prepared);
            if (!request || !prepared || !taskEditValuesEqual(request, prepared.request)) return fail('INVALID_INPUT', 'Prepared task edit request or journal does not match');
            const result = await useTaskStore.getState().commitPreparedTaskEdit(prepared);
            if (!result.success) return fail(result.reason === 'missing' ? 'TASK_NOT_FOUND' : result.reason === 'conflict' ? 'STALE_REVISION' : 'INVALID_INPUT', result.error ?? 'Prepared task edit refused');
            try {
                if (useTaskStore.getState().persistenceFailure) await useTaskStore.getState().retryPersistence();
            } catch (error) {
                return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
            }
            const saved = await deps.save();
            if (!saved.ok) return saved;
            const task = useTaskStore.getState()._tasksById.get(request.id);
            if (!task) return fail('TASK_NOT_FOUND', 'Task not found');
            try {
                logInfo(request.recurrenceBase ? 'Native prepared recurrence save result' : 'Native prepared date save result', {
                    scope: 'native-host', category: 'storage', context: {
                        releaseCheck: request.recurrenceBase ? 'v1.3.3/native-prepared-recurrence-save' : 'v1.3.3/native-prepared-date-save',
                        outcome: result.outcome,
                    },
                });
            } catch { /* Diagnostics cannot invalidate a durable acknowledgment. */ }
            return { ok: true, value: { id: request.id, draft: createTaskDraft(task) } };
        },
    };
}
