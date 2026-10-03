import type { NativeHostResult } from './native-host-contract';
import { getStorageAdapter, useTaskStore } from './store';
import type { PreparedAreaAuthority, PreparedChecklistEffect, PreparedNativeSaveBoundary, TaskStore } from './store-types';
import type { AppData, Area, ChecklistItem, Project, Section, Task } from './types';
import type { TaskDraftField } from './task-draft';
import { createTaskDraft } from './task-draft';
import { applyTaskDraftPatch, buildTaskEditUpdatePatch, getTaskEditorBackdatedCompletionStart,
    resolveTaskEditorBackdatedCompletion } from './task-editor-model';
import {
    nativeTaskDraftPatchValues, readNativeTaskDraftSaveRequest,
    getNativeTaskScheduleBase, validNativeTaskDraftBases, validNativeTaskDraftScheduleEffect, validRawTask, type NativeTaskDraftSaveRequest,
} from './native-host-contract-task-save';
import { isNativeJsonWithinBytes, readChecklist, toChecklist } from './native-host-contract-task-view';
import { buildResetTaskChecklistUpdates, planTaskUpdateEffects, prepareTaskUpdatesForStore,
    planSkippedRecurringOccurrence, samePreparedTask, taskEditValuesEqual } from './store-tasks';
import { createProjectOrderReserver, ensureDeviceId, getNextProjectOrder, getTaskOrder,
    nextRevision } from './store-helpers';
import { createNativeRequestReceipts, taskRevisionOf, type NativeRequestReceipts } from './native-request-receipts';
import { countFocusedTasksBeforeBoundary } from './task-utils';
import { normalizeFocusTaskLimit } from './focus-utils';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { isStatusListTaskReadOnly } from './menu-views-model';
import { mergeNativeTaskLinkHalf } from './native-host-contract-attachments';
import { canSkipRecurringTaskOccurrence, matchesAdvanceOneCalendarProjection,
    projectNextRecurringTask, type RecurrenceProjection } from './recurrence';
import { generateUUID } from './uuid';
import { getTranslator, resolveI18nText } from './i18n';
import { isTaskActionable, isTaskCancelled, normalizeTaskForLoad } from './task-status';
import { normalizeProjectLifecycleFields } from './project-status';
import { mapSqliteTaskRow, TASK_SQLITE_COLUMNS, taskToSqliteRow } from './sqlite-adapter';
import { sameSectionDeleteJson, sameTaskSqliteRow } from './store-projects/section-actions';
import { createAreaSaveGuard, readAreaDurableData } from './native-host-contract-area-durable';
import { isProjectedRecurringTaskId } from './recurrence';
import { taskCancellationRestoreFields } from './undo-task-cancellation';
import { formatTaskMarkedDoneMessage } from './undo-task-completion';
import { logInfo } from './logger';

export type NativeChecklistSaveRequest = NativeTaskDraftSaveRequest & {
    requestId: string;
    checklist: { base: ChecklistItem[]; value: ChecklistItem[] };
    intent?: 'cancel' | 'skip' | 'doneStatus' | 'doneCompletedAt' | 'archiveCompletedAt';
};
export type NativeChecklistResetRequest = { id: string; requestId: string; checklistBase: ChecklistItem[] };
export type NativeChecklistWriteRequest = NativeChecklistSaveRequest | NativeChecklistResetRequest;
export type NativeChecklistResult = { id: string } | {
    id: string; cancellation: { cancelledAt: string; undoEnabled: boolean; message: string; undoLabel: string };
} | {
    id: string; checklistBase: ChecklistItem[]; status: Task['status']; completedAt: string | null; isFocusedToday: boolean;
};
type Lists = { tasks: Task[]; projects: Project[]; sections: Section[]; areas: Area[] };
type Witness = {
    source: Task;
    lists: Lists;
    settings: AppData['settings'];
    preparedAt: string;
    preparedLocalDay: string;
    preparedOffsetMinutes: number;
    boundaryOffsetMinutes: number;
    futureBoundary: string;
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    recurrenceProjection: RecurrenceProjection | null;
    calendarTimeZone?: string;
    ids: string[];
    /** Undefined top-level direct update fields are explicit clears. */
    directClears: string[];
    direct: Partial<Task>;
    focusCount: number;
    focusLimit: number;
    cancelMessage?: string;
    cancelUndoLabel?: string;
};
export type NativePreparedChecklistWrite = {
    version: 1;
    kind: 'save' | 'reset';
    request: NativeChecklistWriteRequest;
    witness: Witness;
    effect: PreparedChecklistEffect;
    result: NativeChecklistResult;
};
export type NativeChecklistPreparation = { kind: 'prepared'; prepared: NativePreparedChecklistWrite }
    | { kind: 'unchanged'; result: NativeChecklistResult };
export type NativeChecklistCancellationEnvelope = {
    request: NativeChecklistSaveRequest & { intent: 'cancel' };
    prepared: NativePreparedChecklistWrite;
};
export type NativeTaskCancellationUndoRequest = { requestId: string; cancelRequestId: string };
export type NativePreparedTaskCancellationUndo = {
    version: 1; kind: 'undo'; request: NativeTaskCancellationUndoRequest;
    cancel: NativeChecklistCancellationEnvelope;
    witness: Witness; effect: PreparedChecklistEffect; result: { id: string };
};
export type NativeTaskCancellationUndoEnvelope = {
    request: NativeTaskCancellationUndoRequest; prepared: NativePreparedTaskCancellationUndo;
};
export type NativeTaskCompletionRequest = { id: string; requestId: string; taskRevision: string };
export type NativeTaskCompletionResult = { id: string; completion: {
    completedAt: string; undoEnabled: boolean; message: string; undoLabel: string;
} };
export type NativePreparedTaskCompletion = {
    version: 1; kind: 'complete'; request: NativeTaskCompletionRequest;
    checklist: NativePreparedChecklistWrite;
    notice: { message: string; undoLabel: string };
    result: NativeTaskCompletionResult;
};
export type NativeTaskCompletionEnvelope = {
    request: NativeTaskCompletionRequest; prepared: NativePreparedTaskCompletion;
};
export type NativeTaskCompletionUndoRequest = { requestId: string; completionRequestId: string };
export type NativePreparedTaskCompletionUndo = {
    version: 1; kind: 'undo'; request: NativeTaskCompletionUndoRequest;
    completion: NativeTaskCompletionEnvelope;
    witness: Witness; effect: PreparedChecklistEffect; result: { id: string };
};
export type NativeTaskCompletionUndoEnvelope = {
    request: NativeTaskCompletionUndoRequest; prepared: NativePreparedTaskCompletionUndo;
};
export type NativeDoneTaskStatus = 'inbox' | 'next' | 'waiting' | 'someday' | 'done' | 'reference';
export type NativeDoneTaskStatusRequest = NativeTaskCompletionRequest & { status: NativeDoneTaskStatus };
type NativePreparedDoneTaskStatusBase = {
    kind: 'doneStatus'; request: NativeDoneTaskStatusRequest;
    checklist: NativePreparedChecklistWrite; result: { id: string };
};
export type NativePreparedDoneTaskStatus = NativePreparedDoneTaskStatusBase & (
    { version: 1 } | { version: 2; rawBefore: Task }
);
export type NativeDoneTaskStatusEnvelope = {
    request: NativeDoneTaskStatusRequest; prepared: NativePreparedDoneTaskStatus;
};
export type NativeDoneTaskCompletedAtRequest = NativeTaskCompletionRequest & { completedAt: string };
export type NativePreparedDoneTaskCompletedAt = {
    version: 2; kind: 'doneCompletedAt'; request: NativeDoneTaskCompletedAtRequest;
    rawBefore: Task; checklist: NativePreparedChecklistWrite; result: { id: string };
};
export type NativeDoneTaskCompletedAtEnvelope = {
    request: NativeDoneTaskCompletedAtRequest; prepared: NativePreparedDoneTaskCompletedAt;
};
export type NativeArchiveTaskCompletedAtRequest = NativeTaskCompletionRequest & { completedAt: string };
export type NativePreparedArchiveTaskCompletedAt = {
    version: 2; kind: 'archiveCompletedAt'; request: NativeArchiveTaskCompletedAtRequest;
    rawBefore: Task; checklist: NativePreparedChecklistWrite; result: { id: string };
};
export type NativeArchiveTaskCompletedAtEnvelope = {
    request: NativeArchiveTaskCompletedAtRequest; prepared: NativePreparedArchiveTaskCompletedAt;
};
type NativeHistoryRowEnvelope = NativeDoneTaskStatusEnvelope | NativeDoneTaskCompletedAtEnvelope | NativeArchiveTaskCompletedAtEnvelope;
type NativeBoundHistoryRowEnvelope = (NativeDoneTaskStatusEnvelope & {
    prepared: NativePreparedDoneTaskStatus & { version: 2; rawBefore: Task } }) | NativeDoneTaskCompletedAtEnvelope | NativeArchiveTaskCompletedAtEnvelope;

const LIMIT_BYTES = 2_000_000;
const COMPLETION_BYTES = 2_100_000;
const COMPLETION_UNDO_BYTES = 4_500_000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const DONE_STATUS_OPTIONS: readonly NativeDoneTaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done', 'reference'];
const validCancelText = (value: unknown, maxLength: number): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
    && value.trim() === value && Array.from(value).every((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code !== 127;
    });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const same = taskEditValuesEqual;
const fail = (code: 'INVALID_INPUT' | 'STALE_REVISION' | 'TASK_NOT_FOUND' | 'SAVE_FAILED', message: string): NativeHostResult<never> =>
    ({ ok: false, error: { code, message } });

const detach = <T>(value: T, limit = LIMIT_BYTES): T | null => {
    const safe = (item: unknown, depth: number): boolean => {
        if (depth > 30) return false;
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
        if (typeof item === 'number') return Number.isFinite(item);
        if (Array.isArray(item)) return item.length <= limit && item.every((entry) => safe(entry, depth + 1));
        return isRecord(item) && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)
            && Object.keys(item).length <= 256 && Object.entries(item).every(([key, entry]) =>
                !['__proto__', 'prototype', 'constructor'].includes(key) && safe(entry, depth + 1));
    };
    if (!safe(value, 0)) return null;
    const encoded = JSON.stringify(value);
    return isNativeJsonWithinBytes(value, limit) ? JSON.parse(encoded) as T : null;
};
const canonicalJSON = (input: unknown): string => JSON.stringify(input, (_name, value) =>
    isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
const isSave = (value: NativeChecklistWriteRequest): value is NativeChecklistSaveRequest => 'checklist' in value;
const readUndoRequest = (value: unknown): NativeTaskCancellationUndoRequest | null => {
    const input = detach(value);
    return isRecord(input) && exact(input, ['requestId', 'cancelRequestId'])
        && typeof input.requestId === 'string' && UUID.test(input.requestId)
        && typeof input.cancelRequestId === 'string' && UUID.test(input.cancelRequestId)
        && input.requestId !== input.cancelRequestId ? input as NativeTaskCancellationUndoRequest : null;
};
const readCompletionRequest = (value: unknown): NativeTaskCompletionRequest | null => {
    const input = detach(value);
    return isRecord(input) && exact(input, ['id', 'requestId', 'taskRevision'])
        && typeof input.id === 'string' && Boolean(input.id.trim()) && input.id.length <= 500
        && typeof input.requestId === 'string' && UUID.test(input.requestId)
        && typeof input.taskRevision === 'string' && Boolean(input.taskRevision)
        && input.taskRevision.length <= 200 ? input as NativeTaskCompletionRequest : null;
};
const readDoneStatusRequest = (value: unknown): NativeDoneTaskStatusRequest | null => {
    const input = detach(value);
    if (!isRecord(input) || !exact(input, ['id', 'requestId', 'taskRevision', 'status'])
        || !DONE_STATUS_OPTIONS.includes(input.status as NativeDoneTaskStatus)) return null;
    const request = readCompletionRequest({ id: input.id, requestId: input.requestId, taskRevision: input.taskRevision });
    return request ? { ...request, status: input.status as NativeDoneTaskStatus } : null;
};
const readDoneCompletedAtRequest = (value: unknown): NativeDoneTaskCompletedAtRequest | null => {
    const input = detach(value);
    if (!isRecord(input) || !exact(input, ['id', 'requestId', 'taskRevision', 'completedAt'])
        || typeof input.completedAt !== 'string' || input.completedAt.length > 200
        || !resolveTaskEditorBackdatedCompletion({ completedAt: input.completedAt })) return null;
    const request = readCompletionRequest({ id: input.id, requestId: input.requestId, taskRevision: input.taskRevision });
    return request ? { ...request, completedAt: input.completedAt } : null;
};
const readCompletionUndoRequest = (value: unknown): NativeTaskCompletionUndoRequest | null => {
    const input = detach(value);
    return isRecord(input) && exact(input, ['requestId', 'completionRequestId'])
        && typeof input.requestId === 'string' && UUID.test(input.requestId)
        && typeof input.completionRequestId === 'string' && UUID.test(input.completionRequestId)
        && input.requestId !== input.completionRequestId ? input as NativeTaskCompletionUndoRequest : null;
};
const completionSaveRequest = (source: Task, requestId: string): NativeChecklistSaveRequest => ({
    id: source.id, requestId, base: { status: source.status }, patch: { status: 'done' },
    scheduleBase: getNativeTaskScheduleBase(source),
    checklist: { base: toChecklist(source.checklist), value: toChecklist(source.checklist) },
});
const doneStatusSaveRequest = (source: Task, request: NativeDoneTaskStatusRequest): NativeChecklistSaveRequest => ({
    ...completionSaveRequest(source, request.requestId), patch: { status: request.status }, intent: 'doneStatus',
});
const completedAtSaveRequest = (source: Task, request: NativeDoneTaskCompletedAtRequest,
    intent: 'doneCompletedAt' | 'archiveCompletedAt'): NativeChecklistSaveRequest => ({
    ...completionSaveRequest(source, request.requestId), base: { completedAt: source.completedAt || '' },
    patch: { completedAt: request.completedAt }, intent,
});
const isHistoryRowRequest = (request: NativeChecklistWriteRequest | null | undefined): boolean =>
    request != null && isSave(request) && (request.intent === 'doneStatus' || request.intent === 'doneCompletedAt' || request.intent === 'archiveCompletedAt');
const isArchiveCompletedAtRequest = (request: NativeChecklistWriteRequest): boolean =>
    isSave(request) && request.intent === 'archiveCompletedAt';
const isArchiveCompletedAtSource = (task: Task): boolean => task.status === 'archived'
    && !task.deletedAt && !task.purgedAt && !isTaskCancelled(task) && !isProjectedRecurringTaskId(task.id);
const validHistoryRowSource = (task: Task, request: NativeChecklistWriteRequest): boolean =>
    isArchiveCompletedAtRequest(request) ? isArchiveCompletedAtSource(task)
        : task.status === 'done' && !isProjectedRecurringTaskId(task.id);
export const canCompleteNativeTask = (task: Task, projects: readonly Project[], readOnly = false): boolean =>
    !readOnly && !task.deletedAt && !task.purgedAt && isTaskActionable(task)
    && !isProjectedRecurringTaskId(task.id) && !isStatusListTaskReadOnly(task, projects);
export const canCancelNativeTask = (task: Task, projects: readonly Project[], readOnly = false): boolean =>
    !readOnly && !task.deletedAt && !task.purgedAt && isTaskActionable(task)
    && !isProjectedRecurringTaskId(task.id) && !isStatusListTaskReadOnly(task, projects);
export const canSkipNativeTaskOccurrence = (task: Task, projects: readonly Project[], readOnly = false): boolean =>
    !readOnly && !isProjectedRecurringTaskId(task.id) && !isStatusListTaskReadOnly(task, projects)
    && canSkipRecurringTaskOccurrence(task);
const draftRequest = (request: NativeChecklistSaveRequest): NativeTaskDraftSaveRequest => ({
    id: request.id, base: request.base, patch: request.patch, scheduleBase: request.scheduleBase,
    ...(request.recurrenceBase ? { recurrenceBase: request.recurrenceBase } : {}),
    ...(request.attachments ? { attachments: request.attachments } : {}),
});
const readRequest = (value: unknown, validateField: (field: TaskDraftField, value: unknown) => boolean): NativeChecklistWriteRequest | null => {
    const input = detach(value);
    if (!isRecord(input) || typeof input.id !== 'string' || !input.id.trim() || input.id.length > 500
        || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) return null;
    if (!own(input, 'checklist')) {
        const checklistBase = readChecklist(input.checklistBase, true);
        return exact(input, ['id', 'requestId', 'checklistBase']) && checklistBase
            ? { id: input.id, requestId: input.requestId, checklistBase } : null;
    }
    if (!isRecord(input.checklist) || !exact(input.checklist, ['base', 'value'])) return null;
    const base = readChecklist(input.checklist.base, true);
    const selected = readChecklist(input.checklist.value, true);
    const bare = { id: input.id, base: input.base, patch: input.patch, scheduleBase: input.scheduleBase,
        ...(own(input, 'recurrenceBase') ? { recurrenceBase: input.recurrenceBase } : {}),
        ...(own(input, 'attachments') ? { attachments: input.attachments } : {}) };
    // This row action uses shared canonical instant validation, independently
    // of the general editor date format. Only its prior string baseline may be
    // invalid; the outer wrapper binds the complete source and new instant.
    const fields = (input.intent === 'doneCompletedAt' || input.intent === 'archiveCompletedAt')
        ? (field: TaskDraftField, value: unknown) => field === 'completedAt'
            ? typeof value === 'string' && value.length <= 200
                && ((isRecord(input.base) && value === input.base.completedAt)
                    || resolveTaskEditorBackdatedCompletion({ completedAt: value }) !== null)
            : validateField(field, value)
        : validateField;
    const parsed = readNativeTaskDraftSaveRequest(bare, fields, true, false, true);
    if (!base || !selected || !parsed || (own(input, 'intent') && input.intent !== 'cancel' && input.intent !== 'skip' && input.intent !== 'doneStatus' && input.intent !== 'doneCompletedAt' && input.intent !== 'archiveCompletedAt')
        || !exact(input, ['id', 'requestId', 'base', 'patch', 'scheduleBase', 'checklist',
            ...(parsed.recurrenceBase ? ['recurrenceBase'] : []), ...(parsed.attachments ? ['attachments'] : []),
            ...(input.intent === 'cancel' || input.intent === 'skip' || input.intent === 'doneStatus' || input.intent === 'doneCompletedAt' || input.intent === 'archiveCompletedAt' ? ['intent'] : [])])) return null;
    if (input.intent === 'doneStatus' && (!exact(parsed.base, ['status']) || parsed.base.status !== 'done'
        || !exact(parsed.patch, ['status']) || parsed.patch.status === 'done'
        || !DONE_STATUS_OPTIONS.includes(parsed.patch.status as NativeDoneTaskStatus)
        || parsed.recurrenceBase || parsed.attachments || !same(base, selected))) return null;
    if ((input.intent === 'doneCompletedAt' || input.intent === 'archiveCompletedAt') && (!exact(parsed.base, ['completedAt'])
        || !exact(parsed.patch, ['completedAt']) || typeof parsed.patch.completedAt !== 'string'
        || !resolveTaskEditorBackdatedCompletion({ completedAt: parsed.patch.completedAt })
        || parsed.recurrenceBase || parsed.attachments || !same(base, selected))) return null;
    return { ...parsed, requestId: input.requestId, checklist: { base, value: selected },
        ...(input.intent === 'cancel' || input.intent === 'skip' || input.intent === 'doneStatus' || input.intent === 'doneCompletedAt' || input.intent === 'archiveCompletedAt' ? { intent: input.intent } : {}) };
};

const futureBoundary = (preparedAt: string) => {
    const end = new Date(preparedAt);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
};
const changedRows = <T extends { id: string }>(before: T[], after: T[]): Array<{ before: T | null; after: T }> => {
    const old = new Map(before.map((row) => [row.id, row]));
    return after.filter((row) => !same(old.get(row.id), row)).map((row) => ({ before: old.get(row.id) ?? null, after: row }));
};
const resetResult = (task: Task): NativeChecklistResult => ({ id: task.id,
    checklistBase: toChecklist(task.checklist), status: task.status,
    completedAt: task.completedAt ?? null, isFocusedToday: task.isFocusedToday === true });

const cleared = (value: Partial<Task>) => Object.keys(value).filter((key) => value[key as keyof Task] === undefined).sort();
const restoreClears = (value: Partial<Task>, fields: string[]): Partial<Task> => ({ ...value,
    ...Object.fromEntries(fields.map((field) => [field, undefined])) });
const validClears = (value: Partial<Task>, fields: string[]) => fields.every((field) =>
    typeof field === 'string' && field.length <= 100 && !own(value, field))
    && new Set(fields).size === fields.length;
const directSaveUpdates = (source: Task, request: NativeChecklistSaveRequest, preparedAt?: string): Partial<Task> | null => {
    // Done metadata actions use the exact RN row patch, without editor cleanup.
    if (request.intent === 'doneStatus') return { status: request.patch.status };
    if (request.intent === 'doneCompletedAt' || request.intent === 'archiveCompletedAt') return { completedAt: request.patch.completedAt };
    const attachments = request.attachments
        ? mergeNativeTaskLinkHalf(source.attachments ?? [], request.attachments) : source.attachments;
    if (attachments === null) return null;
    const draft = applyTaskDraftPatch(createTaskDraft(source), nativeTaskDraftPatchValues(draftRequest(request)));
    // Swift's sorted JSON keys must not turn an unchanged checklist into a draft edit.
    const editSource = { ...source, checklist: toChecklist(source.checklist) };
    const updates = buildTaskEditUpdatePatch({ draft, checklist: request.checklist.value,
        attachments }, editSource);
    if (!updates) return null;
    if (request.attachments && !same(source.attachments ?? [], attachments)) updates.attachments = attachments;
    for (const field of ['startTime', 'dueDate', 'relativeStartOffset', 'reviewAt'] as const) {
        if (own(request.patch, field)) Object.assign(updates, { [field]: draft[field] || undefined });
    }
    if (request.intent === 'cancel') {
        if (!preparedAt) return null;
        Object.assign(updates, { status: 'archived', cancelledAt: preparedAt, completedAt: undefined });
    }
    return updates;
};
const temporal = new Set(['startTime', 'dueDate', 'relativeStartOffset', 'reviewAt']);
const directIsBound = (source: Task, request: NativeChecklistSaveRequest, witness: Witness): boolean => {
    const expected = directSaveUpdates(source, request, witness.preparedAt);
    if (!expected || !validClears(witness.direct, witness.directClears)) return false;
    const frozen = restoreClears(witness.direct, witness.directClears);
    const names = new Set([...Object.keys(expected), ...Object.keys(frozen)]);
    for (const name of names) {
        if (temporal.has(name)) {
            // Date/link projections can depend on the preparing process's zone.
            // Only fields actually requested (and their linked start) may vary.
            if (!own(request.patch, name)
                && !(name === 'startTime' && (own(request.patch, 'dueDate') || own(request.patch, 'relativeStartOffset')))
                && !same(expected[name as keyof Task], frozen[name as keyof Task])) return false;
        } else if (!same(expected[name as keyof Task], frozen[name as keyof Task])
            || own(expected, name) !== own(frozen, name)) return false;
    }
    return true;
};
const deviceId = (witness: Witness) => witness.deviceIdBefore ?? witness.deviceIdToInitialize!;
const effectResult = (kind: 'save' | 'reset', effect: PreparedChecklistEffect,
    request: NativeChecklistWriteRequest, witness: Witness): NativeChecklistResult => {
    const updated = effect.tasks.find((row) => row.after.id === effect.sourceBefore.id)?.after;
    if (!updated) throw new Error('Missing checklist source effect');
    if (kind === 'reset') return resetResult(updated);
    if (isSave(request) && request.intent === 'cancel') {
        if (updated.status !== 'archived' || updated.cancelledAt !== witness.preparedAt
            || !validCancelText(witness.cancelMessage, 512) || !validCancelText(witness.cancelUndoLabel, 80))
            throw new Error('Invalid cancellation effect');
        return { id: updated.id, cancellation: {
            cancelledAt: updated.cancelledAt,
            undoEnabled: witness.settings.undoNotificationsEnabled !== false,
            message: witness.cancelMessage,
            undoLabel: witness.cancelUndoLabel,
        } };
    }
    return { id: updated.id };
};

const plan = (kind: 'save' | 'reset', request: NativeChecklistWriteRequest, witness: Witness,
    allowIds = false, undo = false): {
    effect: PreparedChecklistEffect; result: NativeChecklistResult;
} => {
    const source = witness.source;
    const lists = witness.lists;
    let tasks: Task[];
    let projects: Project[];
    let sections: Section[];
    let recurringCandidate: Task | null = null;
    let recurringDuplicate: Task | null = null;
    let generated = 0;
    let direct: Partial<Task> = {};
    if (kind === 'save' && isSave(request)) {
        direct = restoreClears(witness.direct, witness.directClears);
        const prepared = prepareTaskUpdatesForStore({ task: source, updates: direct,
            allProjects: lists.projects, allSections: lists.sections, allAreas: lists.areas,
            settings: witness.settings, futureBoundary: witness.futureBoundary,
            nowMs: Date.parse(witness.preparedAt), reserveProjectOrder: true,
            projectOrderReserver: createProjectOrderReserver(lists.tasks) });
        if (!prepared.ok) throw new Error(prepared.error);
        const skip = request.intent === 'skip';
        if (skip && (!canSkipNativeTaskOccurrence(source, lists.projects)
            || !canSkipRecurringTaskOccurrence({ ...source, ...prepared.updates }))) {
            throw new Error('Task draft cannot skip an occurrence');
        }
        const createId = () => {
            let id = witness.ids[generated++];
            if (!id && allowIds && witness.ids.length < Math.floor(LIMIT_BYTES / 38)) {
                id = generateUUID();
                witness.ids.push(id);
            }
            if (!id) throw new Error('Missing frozen checklist child ID');
            return id;
        };
        // A clean Skip has one lifecycle transition. A dirty Skip first resolves
        // the ordinary Save, then archives that row in the same atomic effect.
        const hasDraftUpdate = !skip || Object.keys(direct).length > 0;
        const effects = hasDraftUpdate ? planTaskUpdateEffects({ task: source, preparedUpdates: prepared.updates,
            allTasks: lists.tasks, allProjects: lists.projects, allSections: lists.sections,
            now: witness.preparedAt, deviceId: deviceId(witness), createId,
            recurrenceProjection: !skip && prepared.updates.status === 'done' && source.status !== 'done'
                && source.status !== 'archived' ? witness.recurrenceProjection : undefined }) : null;
        tasks = effects?.tasks ?? lists.tasks;
        projects = effects?.projects ?? lists.projects;
        sections = effects?.sections ?? lists.sections;
        recurringCandidate = effects?.recurringCandidateTask ?? null;
        recurringDuplicate = effects?.recurringDuplicateTask ?? null;
        if (skip) {
            const draftResolved = effects?.updatedTask ?? source;
            if (!canSkipRecurringTaskOccurrence(draftResolved)) throw new Error('Task draft cannot skip an occurrence');
            if (allowIds) witness.recurrenceProjection = projectNextRecurringTask(draftResolved, witness.preparedAt, true);
            if (!matchesAdvanceOneCalendarProjection(draftResolved, witness.preparedAt,
                witness.recurrenceProjection, witness.calendarTimeZone ?? '')) {
                throw new Error('Invalid frozen recurrence calendar step');
            }
            const skipped = planSkippedRecurringOccurrence({ task: draftResolved, allTasks: tasks,
                now: witness.preparedAt, deviceId: deviceId(witness),
                projection: witness.recurrenceProjection, createId });
            tasks = skipped.tasks;
            recurringCandidate = skipped.recurringCandidateTask;
            recurringDuplicate = skipped.recurringDuplicateTask;
        }
    } else if (kind === 'reset' && !isSave(request)) {
        const after: Task = { ...source, ...buildResetTaskChecklistUpdates(source),
            updatedAt: witness.preparedAt, rev: nextRevision(source.rev), revBy: deviceId(witness) };
        tasks = lists.tasks.map((task) => task.id === source.id ? after : task);
        projects = lists.projects;
        sections = lists.sections;
    } else throw new Error('Checklist request kind does not match');
    if (generated !== witness.ids.length) throw new Error('Unused checklist child IDs');
    const taskRows = changedRows(lists.tasks, tasks);
    const projectRows = changedRows(lists.projects, projects);
    const sectionRows = changedRows(lists.sections, sections);
    const reopened = projectRows.find((row) => row.before?.status === 'archived' && row.after.status === 'active');
    const afterSource = taskRows.find((row) => row.after.id === source.id)?.after;
    if (!afterSource) throw new Error('Checklist write has no task effect');
    const targetProject = afterSource.projectId ? lists.projects.find((project) => project.id === afterSource.projectId) ?? null : null;
    const selectedArea = afterSource.areaId ? lists.areas.find((area) => area.id === afterSource.areaId) ?? null : null;
    const orderProjectIds = Array.from(new Set(taskRows.filter((row) => row.after.projectId
        && (!row.before || row.after.order !== row.before.order || row.after.orderNum !== row.before.orderNum))
        .map((row) => row.after.projectId!)));
    const guards: PreparedChecklistEffect['guards'] = {
        selectedProject: targetProject && !projectRows.some((row) => row.after.id === targetProject.id) ? targetProject : null,
        selectedArea,
        taskOrders: orderProjectIds.map((projectId) => ({ projectId,
            max: (getNextProjectOrder(projectId, lists.tasks) ?? 0) - 1 })),
        reactivation: reopened ? { projectId: reopened.after.id,
            taskIds: lists.tasks.filter((task) => task.projectId === reopened.after.id).map((task) => task.id).sort(),
            sectionIds: lists.sections.filter((section) => section.projectId === reopened.after.id).map((section) => section.id).sort() } : null,
        recurringCandidate,
        recurringDuplicate,
        focusCount: direct.isFocusedToday === true && source.isFocusedToday !== true ? witness.focusCount : null,
        focusLimit: direct.isFocusedToday === true && source.isFocusedToday !== true ? witness.focusLimit : null,
        focusBoundary: direct.isFocusedToday === true && source.isFocusedToday !== true ? witness.futureBoundary : null,
        autoArchiveDays: kind === 'save' ? witness.settings.gtd?.autoArchiveDays ?? null : null,
    };
    const effect: PreparedChecklistEffect = { sourceBefore: source, tasks: taskRows,
        projects: projectRows, sections: sectionRows, deviceIdBefore: witness.deviceIdBefore,
        deviceIdToInitialize: witness.deviceIdToInitialize, guards };
    return { effect, result: undo ? { id: source.id } : effectResult(kind, effect, request, witness) };
};

/** Keep only rows the deterministic planner reads; never journal the library. */
const reduceWitness = (witness: Witness, effect: PreparedChecklistEffect, state: TaskStore): void => {
    const tasks = new Set<string>([
        witness.source.id,
        ...effect.tasks.flatMap((row) => [row.before?.id, row.after.id].filter((id): id is string => Boolean(id))),
        ...(effect.guards.reactivation?.taskIds ?? []),
        ...(effect.guards.recurringDuplicate ? [effect.guards.recurringDuplicate.id] : []),
    ]);
    for (const { projectId } of effect.guards.taskOrders) {
        const ranked = state._allTasks.filter((task) => task.projectId === projectId && !task.deletedAt)
            .sort((left, right) => (getTaskOrder(right) ?? -1) - (getTaskOrder(left) ?? -1));
        if (ranked[0]) tasks.add(ranked[0].id);
    }
    const projects = new Set<string>([
        ...effect.projects.flatMap((row) => [row.before?.id, row.after.id].filter((id): id is string => Boolean(id))),
        ...[witness.source.projectId, effect.guards.selectedProject?.id, effect.guards.reactivation?.projectId,
            effect.tasks.find((row) => row.after.id === witness.source.id)?.after.projectId].filter((id): id is string => Boolean(id)),
    ]);
    const sections = new Set<string>([
        ...effect.sections.flatMap((row) => [row.before?.id, row.after.id].filter((id): id is string => Boolean(id))),
        ...effect.guards.reactivation?.sectionIds ?? [],
        ...[witness.source.sectionId, effect.tasks.find((row) => row.after.id === witness.source.id)?.after.sectionId]
            .filter((id): id is string => Boolean(id)),
    ]);
    const areas = new Set<string>([witness.source.areaId, effect.guards.selectedArea?.id,
        effect.tasks.find((row) => row.after.id === witness.source.id)?.after.areaId]
        .filter((id): id is string => Boolean(id)));
    witness.lists = {
        tasks: state._allTasks.filter((row) => tasks.has(row.id)),
        projects: state._allProjects.filter((row) => projects.has(row.id)),
        sections: state._allSections.filter((row) => sections.has(row.id)),
        areas: state._allAreas.filter((row) => areas.has(row.id)),
    };
};

const readPrepared = (
    input: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean,
): NativePreparedChecklistWrite | null => {
    const envelope = detach(input);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared']) || !isRecord(envelope.prepared)) return null;
    const request = readRequest(envelope.request, validateField);
    const raw = envelope.prepared;
    if (!request || !exact(raw, ['version', 'kind', 'request', 'witness', 'effect', 'result'])
        || raw.version !== 1 || !['save', 'reset'].includes(raw.kind as string)
        || !same(request, raw.request) || !isRecord(raw.witness) || !isRecord(raw.effect)
        || !isRecord(raw.result)) return null;
    const prepared = raw as unknown as NativePreparedChecklistWrite;
    const { witness, kind } = prepared;
    if (kind !== (isSave(request) ? 'save' : 'reset')
        || !exact(witness as unknown as Record<string, unknown>, [
            'source', 'lists', 'settings', 'preparedAt', 'preparedLocalDay', 'preparedOffsetMinutes',
            'boundaryOffsetMinutes', 'futureBoundary', 'deviceIdBefore', 'deviceIdToInitialize',
            'recurrenceProjection', 'ids', 'directClears', 'direct', 'focusCount', 'focusLimit',
            ...(isSave(request) && request.intent === 'skip' ? ['calendarTimeZone'] : []),
            ...(isSave(request) && request.intent === 'cancel' ? ['cancelMessage', 'cancelUndoLabel'] : []),
        ]) || !isRecord(witness.source) || !isRecord(witness.lists) || !isRecord(witness.settings)
        || !exact(witness.lists, ['tasks', 'projects', 'sections', 'areas'])
        || !Array.isArray(witness.lists.tasks) || !Array.isArray(witness.lists.projects)
        || !Array.isArray(witness.lists.sections) || !Array.isArray(witness.lists.areas)
        || !witness.lists.tasks.every(isRecord) || !witness.lists.projects.every(isRecord)
        || !witness.lists.sections.every(isRecord) || !witness.lists.areas.every(isRecord)
        || !isRecord(witness.direct) || !Array.isArray(witness.directClears)
        || !validClears(witness.direct, witness.directClears)
        || !Array.isArray(witness.ids) || witness.ids.some((id) => typeof id !== 'string' || !UUID.test(id))
        || new Set(witness.ids).size !== witness.ids.length
        || witness.ids.some((id) => witness.lists.tasks.some((task) => task.id === id))
        || witness.source.id !== request.id || typeof witness.source.title !== 'string'
        || typeof witness.source.status !== 'string' || typeof witness.source.createdAt !== 'string'
        || typeof witness.source.updatedAt !== 'string' || witness.source.deletedAt || witness.source.purgedAt
        || !same(witness.lists.tasks.find((task) => task.id === request.id), witness.source)
        || (!isArchiveCompletedAtRequest(request) && isStatusListTaskReadOnly(witness.source, witness.lists.projects as Project[]))
        || typeof witness.preparedAt !== 'string' || !Number.isFinite(Date.parse(witness.preparedAt))
        || new Date(witness.preparedAt).toISOString() !== witness.preparedAt
        || typeof witness.preparedLocalDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(witness.preparedLocalDay)
        || !Number.isInteger(witness.preparedOffsetMinutes) || Math.abs(witness.preparedOffsetMinutes) > 840
        || !Number.isInteger(witness.boundaryOffsetMinutes) || Math.abs(witness.boundaryOffsetMinutes) > 840
        || new Date(Date.parse(witness.preparedAt) - witness.preparedOffsetMinutes * 60_000).toISOString().slice(0, 10)
            !== witness.preparedLocalDay
        || new Date(Date.parse(`${witness.preparedLocalDay}T23:59:59.999Z`)
            + witness.boundaryOffsetMinutes * 60_000).toISOString() !== witness.futureBoundary
        || witness.deviceIdBefore !== (witness.settings.deviceId ?? null)
        || (witness.deviceIdBefore === null
            ? typeof witness.deviceIdToInitialize !== 'string' || !UUID.test(witness.deviceIdToInitialize)
            : witness.deviceIdToInitialize !== null)
        || !Number.isSafeInteger(witness.focusCount) || witness.focusCount < 0
        || !Number.isSafeInteger(witness.focusLimit) || witness.focusLimit < 1
        || (isSave(request) && request.intent === 'cancel' && (!validCancelText(witness.cancelMessage, 512)
            || !validCancelText(witness.cancelUndoLabel, 80) || !canCancelNativeTask(witness.source,
                witness.lists.projects as Project[])
            || witness.recurrenceProjection !== null
            || (witness.settings.undoNotificationsEnabled !== undefined
                && typeof witness.settings.undoNotificationsEnabled !== 'boolean')))
        || (isSave(request) && request.intent === 'skip'
            && !canSkipNativeTaskOccurrence(witness.source, witness.lists.projects as Project[]))) return null;
    if (isSave(request)) {
        if (!validNativeTaskDraftBases(witness.source, draftRequest(request))
            || !same(toChecklist(witness.source.checklist), request.checklist.base)
            || !directIsBound(witness.source, request, witness)
            || (isHistoryRowRequest(request) && !validHistoryRowSource(witness.source, request))
            || ((witness.source.status === 'reference' || request.patch.status === 'reference')
                && (request.patch.priority || request.patch.timeEstimate))) return null;
    } else if (!same(toChecklist(witness.source.checklist), request.checklistBase)
        || request.checklistBase.length === 0 || Object.keys(witness.direct).length > 0
        || witness.directClears.length > 0 || witness.ids.length > 0
        || witness.recurrenceProjection !== null) return null;
    try {
        const planned = plan(kind, request, witness);
        if (isSave(request)) {
            const after = planned.effect.tasks.find((row) => row.after.id === request.id)?.after;
            if (!after || !isHistoryRowRequest(request)
                && !validNativeTaskDraftScheduleEffect(witness.source, draftRequest(request), after, validateField)) return null;
        }
        return same(planned.effect, prepared.effect) && same(planned.result, prepared.result) ? prepared : null;
    } catch {
        return null;
    }
};

/** The actual SQLite display codec followed by the normal load projection. */
const historyRowLoadProjection = (task: Task, preparedAt: string): Task => {
    const values = taskToSqliteRow(task);
    const row = Object.fromEntries(TASK_SQLITE_COLUMNS.map((column, index) => [column, values[index]]));
    return normalizeTaskForLoad(mapSqliteTaskRow(row), preparedAt);
};
const sameRawHistoryRowTask = (left: Task, right: Task): boolean =>
    sameTaskSqliteRow(left, right) && sameSectionDeleteJson(left, right);
// Only the single source update can enter the existing raw Task overlay.
const validHistoryRowEffect = (checklist: NativePreparedChecklistWrite, id: string): boolean => {
    const { effect } = checklist;
    return effect.tasks.length === 1 && effect.tasks[0].before !== null
        && effect.tasks[0].after.id === id && same(effect.tasks[0].before, checklist.witness.source)
        && effect.projects.length === 0 && effect.sections.length === 0
        && effect.guards.reactivation === null && effect.guards.recurringCandidate === null
        && effect.guards.recurringDuplicate === null && effect.guards.focusCount === null
        && effect.guards.focusLimit === null && effect.guards.focusBoundary === null;
};
const validHistoryRowRawBefore = (rawBefore: Task, request: NativeTaskCompletionRequest, witness: Witness, archived = false): boolean => {
    if (!validRawTask(rawBefore, request.id) || (archived ? !isArchiveCompletedAtSource(rawBefore) : rawBefore.status !== 'done')
        || rawBefore.deletedAt || rawBefore.purgedAt || taskRevisionOf(rawBefore) !== request.taskRevision) return false;
    try { return same(historyRowLoadProjection(rawBefore, witness.preparedAt), witness.source); }
    catch { return false; }
};
const readDoneStatus = (value: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean): NativeDoneTaskStatusEnvelope | null => {
    const envelope = detach(value, COMPLETION_BYTES);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared']) || !isRecord(envelope.prepared)) return null;
    const request = readDoneStatusRequest(envelope.request);
    const raw = envelope.prepared;
    if (!request || request.status === 'done' || (raw.version !== 1 && raw.version !== 2)
        || !exact(raw, ['version', 'kind', 'request', 'checklist', 'result', ...(raw.version === 2 ? ['rawBefore'] : [])])
        || raw.kind !== 'doneStatus' || !same(raw.request, request)
        || !isRecord(raw.checklist) || !isRecord(raw.result) || !exact(raw.result, ['id']) || raw.result.id !== request.id) return null;
    const prepared = raw as unknown as NativePreparedDoneTaskStatus;
    const checklist = readPrepared({ request: prepared.checklist.request, prepared: prepared.checklist }, validateField);
    if (!checklist || checklist.kind !== 'save' || !isSave(checklist.request)
        || !validRawTask(checklist.witness.source, request.id) || checklist.witness.source.status !== 'done'
        || taskRevisionOf(checklist.witness.source) !== request.taskRevision
        || !same(checklist.request, doneStatusSaveRequest(checklist.witness.source, request))
        || !same(checklist.result, prepared.result)) return null;
    if (!validHistoryRowEffect(checklist, request.id)
        || prepared.version === 2 && !validHistoryRowRawBefore(prepared.rawBefore, request, checklist.witness)) return null;
    return envelope as NativeDoneTaskStatusEnvelope;
};

const readDoneCompletedAt = (value: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean): NativeDoneTaskCompletedAtEnvelope | null => {
    const envelope = detach(value, COMPLETION_BYTES);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared']) || !isRecord(envelope.prepared)) return null;
    const request = readDoneCompletedAtRequest(envelope.request);
    const raw = envelope.prepared;
    if (!request || raw.version !== 2 || raw.kind !== 'doneCompletedAt'
        || !exact(raw, ['version', 'kind', 'request', 'rawBefore', 'checklist', 'result']) || !same(raw.request, request)
        || !isRecord(raw.checklist) || !isRecord(raw.result) || !exact(raw.result, ['id']) || raw.result.id !== request.id) return null;
    const prepared = raw as unknown as NativePreparedDoneTaskCompletedAt;
    const checklist = readPrepared({ request: prepared.checklist.request, prepared: prepared.checklist }, validateField);
    if (!checklist || checklist.kind !== 'save' || !isSave(checklist.request)
        || !validRawTask(checklist.witness.source, request.id) || checklist.witness.source.status !== 'done'
        || taskRevisionOf(checklist.witness.source) !== request.taskRevision
        || !same(checklist.request, completedAtSaveRequest(checklist.witness.source, request, 'doneCompletedAt'))
        || !same(checklist.result, prepared.result) || !validHistoryRowEffect(checklist, request.id)
        || !validHistoryRowRawBefore(prepared.rawBefore, request, checklist.witness)) return null;
    return envelope as NativeDoneTaskCompletedAtEnvelope;
};

const readArchiveCompletedAt = (value: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean): NativeArchiveTaskCompletedAtEnvelope | null => {
    const envelope = detach(value, COMPLETION_BYTES);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared']) || !isRecord(envelope.prepared)) return null;
    const request = readDoneCompletedAtRequest(envelope.request);
    const raw = envelope.prepared;
    if (!request || raw.version !== 2 || raw.kind !== 'archiveCompletedAt'
        || !exact(raw, ['version', 'kind', 'request', 'rawBefore', 'checklist', 'result']) || !same(raw.request, request)
        || !isRecord(raw.checklist) || !isRecord(raw.result) || !exact(raw.result, ['id']) || raw.result.id !== request.id) return null;
    const prepared = raw as unknown as NativePreparedArchiveTaskCompletedAt;
    const checklist = readPrepared({ request: prepared.checklist.request, prepared: prepared.checklist }, validateField);
    if (!checklist || checklist.kind !== 'save' || !isSave(checklist.request)
        || !validRawTask(checklist.witness.source, request.id) || !isArchiveCompletedAtSource(checklist.witness.source)
        || taskRevisionOf(checklist.witness.source) !== request.taskRevision
        || !same(checklist.request, completedAtSaveRequest(checklist.witness.source, request, 'archiveCompletedAt'))
        || !same(checklist.result, prepared.result) || !validHistoryRowEffect(checklist, request.id)
        || !validHistoryRowRawBefore(prepared.rawBefore, request, checklist.witness, true)) return null;
    return envelope as NativeArchiveTaskCompletedAtEnvelope;
};

const readCancellation = (value: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean): NativeChecklistCancellationEnvelope | null => {
    const envelope = detach(value);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared'])) return null;
    const prepared = readPrepared(envelope, validateField);
    return prepared && prepared.kind === 'save' && isSave(prepared.request)
        && prepared.request.intent === 'cancel' && isRecord(prepared.result)
        && 'cancellation' in prepared.result && isRecord(prepared.result.cancellation)
        ? envelope as NativeChecklistCancellationEnvelope : null;
};

const readCompletion = (value: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean): NativeTaskCompletionEnvelope | null => {
    const envelope = detach(value, COMPLETION_BYTES);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared']) || !isRecord(envelope.prepared)) return null;
    const request = readCompletionRequest(envelope.request);
    const raw = envelope.prepared;
    if (!request || !exact(raw, ['version', 'kind', 'request', 'checklist', 'notice', 'result'])
        || raw.version !== 1 || raw.kind !== 'complete' || !same(raw.request, request)
        || !isRecord(raw.checklist) || !isRecord(raw.notice) || !isRecord(raw.result)
        || !exact(raw.notice, ['message', 'undoLabel'])
        || !validCancelText(raw.notice.message, 512) || !validCancelText(raw.notice.undoLabel, 80)
        || !exact(raw.result, ['id', 'completion']) || !isRecord(raw.result.completion)
        || !exact(raw.result.completion, ['completedAt', 'undoEnabled', 'message', 'undoLabel'])) return null;
    const prepared = raw as unknown as NativePreparedTaskCompletion;
    const checklist = readPrepared({ request: prepared.checklist.request, prepared: prepared.checklist }, validateField);
    if (!checklist || checklist.kind !== 'save' || !isSave(checklist.request)
        || !canCompleteNativeTask(checklist.witness.source, checklist.witness.lists.projects)
        || taskRevisionOf(checklist.witness.source) !== request.taskRevision
        || !same(checklist.request, completionSaveRequest(checklist.witness.source, request.requestId))) return null;
    const after = checklist.effect.tasks.find((row) => row.after.id === request.id)?.after;
    const result = prepared.result;
    return after && after.status === 'done' && typeof after.completedAt === 'string'
        && after.completedAt === checklist.witness.preparedAt
        && result.id === request.id && result.completion.completedAt === after.completedAt
        && result.completion.undoEnabled === true
        && result.completion.message === prepared.notice.message
        && result.completion.undoLabel === prepared.notice.undoLabel
        ? envelope as NativeTaskCompletionEnvelope : null;
};

const ownedCompletionChild = (completion: NativeTaskCompletionEnvelope): Task | null => {
    const created = completion.prepared.checklist.effect.tasks.filter((row) => row.before === null);
    return created.length === 1 && created[0].after.id !== completion.request.id ? created[0].after : null;
};
const sameSavedTask = (left: Task | undefined, right: Task): boolean =>
    Boolean(left) && samePreparedTask(left!, right);
const completionUndoDirect = (completion: NativeTaskCompletionEnvelope, witness: Witness): Partial<Task> => {
    const before = completion.prepared.checklist.witness.source;
    const restoreFocus = before.isFocusedToday === true && witness.focusCount < witness.focusLimit;
    return { status: before.status, isFocusedToday: restoreFocus, focusOrder: undefined };
};
const planCompletionUndo = (completion: NativeTaskCompletionEnvelope, witness: Witness): PreparedChecklistEffect => {
    const planned = plan('save', completion.prepared.checklist.request, witness, false, true);
    const child = ownedCompletionChild(completion);
    // A prior Today star makes even a no-star Undo result a cap-dependent
    // decision. Freeze and compare the count/limit at the atomic write boundary.
    const effect: PreparedChecklistEffect = completion.prepared.checklist.witness.source.isFocusedToday === true
        ? { ...planned.effect, guards: { ...planned.effect.guards,
            focusCount: witness.focusCount, focusLimit: witness.focusLimit,
            focusBoundary: witness.futureBoundary } }
        : planned.effect;
    if (!child) return effect;
    const frozen = witness.lists.tasks.find((row) => row.id === child.id);
    if (!frozen || !sameSavedTask(frozen, child) || frozen.deletedAt || frozen.purgedAt)
        throw new Error('Recurring follow-up changed');
    const tombstone: Task = { ...child, deletedAt: witness.preparedAt, updatedAt: witness.preparedAt,
        rev: nextRevision(child.rev), revBy: deviceId(witness) };
    return { ...effect, tasks: [...effect.tasks, { before: child, after: tombstone }] };
};
const readCompletionUndo = (value: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean): NativeTaskCompletionUndoEnvelope | null => {
    const envelope = detach(value, COMPLETION_UNDO_BYTES);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared']) || !isRecord(envelope.prepared)) return null;
    const request = readCompletionUndoRequest(envelope.request);
    const raw = envelope.prepared;
    const completion = readCompletion(raw.completion, validateField);
    if (!request || !exact(raw, ['version', 'kind', 'request', 'completion', 'witness', 'effect', 'result'])
        || raw.version !== 1 || raw.kind !== 'undo' || !same(raw.request, request)
        || !completion || !same(raw.completion, completion) || request.completionRequestId !== completion.request.requestId
        || !isRecord(raw.witness) || !isRecord(raw.effect) || !isRecord(raw.result)
        || !exact(raw.result, ['id'])) return null;
    const prepared = raw as unknown as NativePreparedTaskCompletionUndo;
    const witness = prepared.witness;
    const completed = completion.prepared.checklist.effect.tasks.find((row) => row.after.id === completion.request.id)?.after;
    const owned = ownedCompletionChild(completion);
    if (!completed || !isRecord(witness.source) || !validRawTask(witness.source, completion.request.id)
        || !isRecord(witness.lists) || !exact(witness as unknown as Record<string, unknown>, [
            'source', 'lists', 'settings', 'preparedAt', 'preparedLocalDay', 'preparedOffsetMinutes',
            'boundaryOffsetMinutes', 'futureBoundary', 'deviceIdBefore', 'deviceIdToInitialize',
            'recurrenceProjection', 'ids', 'directClears', 'direct', 'focusCount', 'focusLimit',
        ]) || !exact(witness.lists, ['tasks', 'projects', 'sections', 'areas'])
        || !Array.isArray(witness.lists.tasks) || !Array.isArray(witness.lists.projects)
        || !Array.isArray(witness.lists.sections) || !Array.isArray(witness.lists.areas)
        || !witness.lists.tasks.every((row: unknown) => isRecord(row) && validRawTask(row, row.id as string))
        || !isRecord(witness.settings) || !isRecord(witness.direct)
        || !Array.isArray(witness.directClears) || !validClears(witness.direct, witness.directClears)
        || !Array.isArray(witness.ids) || witness.ids.length !== 0 || witness.recurrenceProjection !== null
        || witness.source.deletedAt || witness.source.purgedAt || witness.source.status !== 'done'
        || witness.source.completedAt !== completed.completedAt
        || (witness.source.rev ?? 0) < (completed.rev ?? 0)
        || isStatusListTaskReadOnly(witness.source, witness.lists.projects)
        || witness.lists.tasks.filter((row) => row.id === witness.source.id).length !== 1
        || !same(witness.lists.tasks.find((row) => row.id === witness.source.id), witness.source)
        || (owned && (witness.lists.tasks.filter((row) => row.id === owned.id).length !== 1
            || !sameSavedTask(witness.lists.tasks.find((row) => row.id === owned.id), owned)))
        || typeof witness.preparedAt !== 'string' || !Number.isFinite(Date.parse(witness.preparedAt))
        || new Date(witness.preparedAt).toISOString() !== witness.preparedAt
        || typeof witness.preparedLocalDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(witness.preparedLocalDay)
        || !Number.isInteger(witness.preparedOffsetMinutes) || Math.abs(witness.preparedOffsetMinutes) > 840
        || !Number.isInteger(witness.boundaryOffsetMinutes) || Math.abs(witness.boundaryOffsetMinutes) > 840
        || new Date(Date.parse(witness.preparedAt) - witness.preparedOffsetMinutes * 60_000).toISOString().slice(0, 10)
            !== witness.preparedLocalDay
        || new Date(Date.parse(`${witness.preparedLocalDay}T23:59:59.999Z`)
            + witness.boundaryOffsetMinutes * 60_000).toISOString() !== witness.futureBoundary
        || witness.deviceIdBefore !== (witness.settings.deviceId ?? null)
        || (witness.deviceIdBefore === null
            ? typeof witness.deviceIdToInitialize !== 'string' || !UUID.test(witness.deviceIdToInitialize)
            : witness.deviceIdToInitialize !== null)
        || !Number.isSafeInteger(witness.focusCount) || witness.focusCount < 0
        || !Number.isSafeInteger(witness.focusLimit) || witness.focusLimit < 1
        || witness.focusLimit !== normalizeFocusTaskLimit((witness.settings.gtd as { focusTaskLimit?: number } | undefined)?.focusTaskLimit)
        || !same(restoreClears(witness.direct, witness.directClears), completionUndoDirect(completion, witness))
        || prepared.result.id !== witness.source.id) return null;
    try {
        return same(planCompletionUndo(completion, witness), prepared.effect)
            ? envelope as NativeTaskCompletionUndoEnvelope : null;
    } catch { return null; }
};

const readPreparedUndo = (value: unknown,
    validateField: (field: TaskDraftField, value: unknown) => boolean): NativeTaskCancellationUndoEnvelope | null => {
    const envelope = detach(value);
    if (!isRecord(envelope) || !exact(envelope, ['request', 'prepared']) || !isRecord(envelope.prepared)) return null;
    const request = readUndoRequest(envelope.request);
    const raw = envelope.prepared;
    const cancel = readCancellation(raw.cancel, validateField);
    if (!request || !exact(raw, ['version', 'kind', 'request', 'cancel', 'witness', 'effect', 'result'])
        || raw.version !== 1 || raw.kind !== 'undo' || !same(raw.request, request)
        || !cancel || request.cancelRequestId !== cancel.request.requestId
        || !same(raw.cancel, cancel) || !isRecord(raw.witness) || !isRecord(raw.effect)
        || !isRecord(raw.result) || !exact(raw.result, ['id'])) return null;
    const prepared = raw as unknown as NativePreparedTaskCancellationUndo;
    const witness = prepared.witness;
    const cancelled = cancel.prepared.effect.tasks.find((row) => row.after.id === cancel.request.id)?.after;
    if (!cancelled || !isRecord(witness.source) || !isRecord(witness.lists)
        || !exact(witness as unknown as Record<string, unknown>, [
            'source', 'lists', 'settings', 'preparedAt', 'preparedLocalDay', 'preparedOffsetMinutes',
            'boundaryOffsetMinutes', 'futureBoundary', 'deviceIdBefore', 'deviceIdToInitialize',
            'recurrenceProjection', 'ids', 'directClears', 'direct', 'focusCount', 'focusLimit',
        ]) || !exact(witness.lists, ['tasks', 'projects', 'sections', 'areas'])
        || !Array.isArray(witness.lists.tasks) || !Array.isArray(witness.lists.projects)
        || !Array.isArray(witness.lists.sections) || !Array.isArray(witness.lists.areas)
        || !isRecord(witness.settings) || !isRecord(witness.direct)
        || !Array.isArray(witness.directClears) || !validClears(witness.direct, witness.directClears)
        || !Array.isArray(witness.ids) || witness.ids.length !== 0 || witness.recurrenceProjection !== null
        || witness.source.id !== cancel.request.id || witness.source.deletedAt || witness.source.purgedAt
        || witness.source.status !== 'archived' || witness.source.cancelledAt !== cancelled.cancelledAt
        || (witness.source.rev ?? 0) < (cancelled.rev ?? 0)
        || isStatusListTaskReadOnly(witness.source, witness.lists.projects)
        || witness.lists.tasks.filter((row) => row.id === witness.source.id).length !== 1
        || !same(witness.lists.tasks.find((row) => row.id === witness.source.id), witness.source)
        || typeof witness.preparedAt !== 'string' || !Number.isFinite(Date.parse(witness.preparedAt))
        || new Date(witness.preparedAt).toISOString() !== witness.preparedAt
        || typeof witness.preparedLocalDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(witness.preparedLocalDay)
        || !Number.isInteger(witness.preparedOffsetMinutes) || Math.abs(witness.preparedOffsetMinutes) > 840
        || !Number.isInteger(witness.boundaryOffsetMinutes) || Math.abs(witness.boundaryOffsetMinutes) > 840
        || new Date(Date.parse(witness.preparedAt) - witness.preparedOffsetMinutes * 60_000).toISOString().slice(0, 10)
            !== witness.preparedLocalDay
        || new Date(Date.parse(`${witness.preparedLocalDay}T23:59:59.999Z`)
            + witness.boundaryOffsetMinutes * 60_000).toISOString() !== witness.futureBoundary
        || witness.deviceIdBefore !== (witness.settings.deviceId ?? null)
        || (witness.deviceIdBefore === null
            ? typeof witness.deviceIdToInitialize !== 'string' || !UUID.test(witness.deviceIdToInitialize)
            : witness.deviceIdToInitialize !== null)
        || !Number.isSafeInteger(witness.focusCount) || witness.focusCount < 0
        || !Number.isSafeInteger(witness.focusLimit) || witness.focusLimit < 1
        || !same(restoreClears(witness.direct, witness.directClears),
            taskCancellationRestoreFields(cancel.prepared.witness.source))
        || prepared.result.id !== witness.source.id) return null;
    try {
        const planned = plan('save', cancel.request, witness, false, true);
        return same(planned.effect, prepared.effect) && same(planned.result, prepared.result)
            ? envelope as NativeTaskCancellationUndoEnvelope : null;
    } catch { return null; }
};

export function createTaskChecklistSaveMethods(deps: {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    validateField: (field: TaskDraftField, value: unknown) => boolean;
    isReadOnly: (task: Task) => boolean;
    language: () => string;
    receipts: NativeRequestReceipts;
}) {
    const historyRowSaves = createAreaSaveGuard(deps.save);
    // A failed save gates fresh writes, so only one owned raw overlay is retained.
    let pendingHistoryRow: { envelope: NativeBoundHistoryRowEnvelope;
        adapter: ReturnType<typeof getStorageAdapter>;
        boundary: PreparedNativeSaveBoundary | undefined } | null = null;
    const checkHistoryRowAuthority = (envelope: NativeBoundHistoryRowEnvelope,
    authority: PreparedAreaAuthority): NativeHostResult<null> => {
        const prepared = envelope.prepared;
        const data = authority.snapshot;
        const rawRows = data.tasks.filter((row) => row.id === envelope.request.id);
        const current = rawRows.length === 1 ? rawRows[0] : null;
        const state = useTaskStore.getState();
        const task = state._tasksById.get(envelope.request.id);
        if (!current || !sameRawHistoryRowTask(current, prepared.rawBefore)
            || !validHistoryRowSource(current, prepared.checklist.request) || current.deletedAt || current.purgedAt
            || !task || (!isArchiveCompletedAtRequest(prepared.checklist.request)
                && (deps.isReadOnly(task) || isStatusListTaskReadOnly(current, data.projects))))
            return fail('STALE_REVISION', 'Saved Done task is no longer the prepared writable source');
        // Replan against current normalized lists at the frozen clock, retaining
        // membership, order, settings, selected container and assignment guards.
        try {
            const witness = prepared.checklist.witness;
            const currentWitness: Witness = { ...witness,
                source: historyRowLoadProjection(current, witness.preparedAt),
                lists: { tasks: data.tasks.map((row) => historyRowLoadProjection(row, witness.preparedAt)),
                    projects: data.projects.map(normalizeProjectLifecycleFields),
                    sections: data.sections ?? [], areas: data.areas ?? [] },
                settings: data.settings, deviceIdBefore: data.settings.deviceId ?? null };
            return same(plan('save', prepared.checklist.request, currentWitness).effect, prepared.checklist.effect)
                ? { ok: true, value: null } : fail('STALE_REVISION', 'Done status guards changed since preparation');
        } catch { return fail('STALE_REVISION', 'Done status destination changed since preparation'); }
    };
    const applyHistoryRowOverlay = async (envelope: NonNullable<typeof pendingHistoryRow>['envelope'], authority: PreparedAreaAuthority) => {
        const effect = envelope.prepared.checklist.effect;
        return useTaskStore.getState().commitPreparedTaskDraftV2({ request: { id: envelope.request.id },
            deviceIdBefore: effect.deviceIdBefore, deviceIdToInitialize: effect.deviceIdToInitialize,
            effect: { task: { before: envelope.prepared.rawBefore, after: effect.tasks[0].after } } }, authority);
    };
    const historyRowReceipts = createNativeRequestReceipts({ save: async (requestId) => {
        const pending = pendingHistoryRow;
        if (!pending || pending.envelope.request.requestId !== requestId)
            return fail('SAVE_FAILED', 'Done status has no owned raw save');
        if (useTaskStore.getState().persistenceFailure) {
            if (!historyRowSaves.mayApply(pending.envelope, pending.adapter))
                return fail('SAVE_FAILED', 'Done status has an unrelated persistence failure');
            const read = await readAreaDurableData(true, true);
            if (!read.ok) return read;
            if (read.value.adapter !== pending.adapter)
                return fail('STALE_REVISION', 'Done status storage changed before retry');
            const checked = checkHistoryRowAuthority(pending.envelope, read.value.authority);
            if (!checked.ok) return checked;
            const applied = await applyHistoryRowOverlay(pending.envelope, read.value.authority);
            if (!applied.success || applied.outcome !== 'applied')
                return fail('STALE_REVISION', applied.error ?? 'Done status raw retry was superseded');
            pending.boundary = read.value.authority.saveBoundary;
        }
        // The receipt engine has registered this exact reply before this flush.
        // Flush its raw effect directly; generic retryPersistence projects memory.
        const saved = await historyRowSaves.finish(pending.envelope, pending.adapter, false, pending.boundary);
        if (saved.ok) pendingHistoryRow = null;
        return saved;
    } });
    const readHistoryRowSource = (input: unknown, archived = false): NativeHostResult<Task> => {
        const ready = deps.readiness();
        if (!ready.ok) return ready;
        const rowLabel = archived ? 'Archive' : 'Done';
        const detached = detach(input);
        if (!isRecord(detached) || !exact(detached, ['id', 'taskRevision'])
            || typeof detached.id !== 'string' || !detached.id.trim() || detached.id.length > 500
            || typeof detached.taskRevision !== 'string' || !detached.taskRevision || detached.taskRevision.length > 200)
            return fail('INVALID_INPUT', `A displayed ${rowLabel} task ID and revision are required`);
        const state = useTaskStore.getState();
        const task = state._tasksById.get(detached.id);
        if (!task || task.deletedAt || task.purgedAt || (archived ? !isArchiveCompletedAtSource(task) : task.status !== 'done' || isProjectedRecurringTaskId(task.id)))
            return fail('TASK_NOT_FOUND', `${rowLabel} task not found`);
        if (taskRevisionOf(task) !== detached.taskRevision) return fail('STALE_REVISION', `Task changed since the ${rowLabel} row was shown`);
        if (!archived && (deps.isReadOnly(task) || isStatusListTaskReadOnly(task, state._allProjects)))
            return fail('INVALID_INPUT', 'Done task is read-only');
        return { ok: true, value: task };
    };
    const commitHistoryRowWrite = async (envelope: NativeHistoryRowEnvelope): Promise<NativeHostResult<{ id: string }>> => {
        const ready = deps.readiness();
        if (!ready.ok) return ready;
        const payload = canonicalJSON([envelope.prepared.kind === 'doneStatus' ? 'doneTaskStatus'
            : envelope.prepared.kind === 'doneCompletedAt' ? 'doneTaskCompletedAt' : 'archiveTaskCompletedAt', envelope]);
        const alreadySaved = historyRowReceipts.saved<{ id: string }>(envelope.request.requestId, payload);
        if (alreadySaved) return alreadySaved.ok && !same(alreadySaved.value, envelope.prepared.result)
            ? fail('INVALID_INPUT', 'Saved Done status result does not match its journal') : alreadySaved;
        // Development v1 journals never bound the raw source. Saved v1
        // receipts remain authoritative; an uncommitted v1 cannot infer it.
        if (envelope.prepared.version !== 2)
            return fail('SAVE_FAILED', 'Uncommitted Done status journal has no raw source binding');
        const bound = envelope as NonNullable<typeof pendingHistoryRow>['envelope'];
        let prewriteFailure: { ok: false; error: { code: 'SAVE_FAILED'; message: string } } | null = null;
        const notLanded = (message: string): NativeHostResult<never> => {
            prewriteFailure = { ok: false, error: { code: 'SAVE_FAILED', message } };
            // SAVE_FAILED means landed to the receipt engine. A read failure
            // must delete its reservation, then keep the public error code.
            return { ok: false, error: { code: 'ACTION_FAILED', message } };
        };
        const confirmed = await historyRowReceipts.run(envelope.request.requestId, payload, async () => {
            if (useTaskStore.getState().persistenceFailure)
                return notLanded('Done status has an unresolved persistence failure');
            const read = await readAreaDurableData(false, true);
            if (!read.ok) return read.error.code === 'SAVE_FAILED' ? notLanded(read.error.message) : read;
            const checked = checkHistoryRowAuthority(bound, read.value.authority);
            if (!checked.ok) return checked;
            const applied = await applyHistoryRowOverlay(bound, read.value.authority);
            if (!applied.success || applied.outcome !== 'applied')
                return fail('STALE_REVISION', applied.error ?? 'Prepared Done status conflicts with current data');
            pendingHistoryRow = { envelope: bound, adapter: read.value.adapter, boundary: read.value.authority.saveBoundary };
            return { ok: true, value: envelope.prepared.result };
        });
        if (prewriteFailure) return prewriteFailure;
        if (confirmed.ok && !same(confirmed.value, envelope.prepared.result))
            return fail('INVALID_INPUT', 'Saved Done status result does not match its journal');
        if (confirmed.ok) {
            try { logInfo(envelope.prepared.kind === 'doneStatus' ? 'Native Done Task status confirmed'
                : envelope.prepared.kind === 'doneCompletedAt' ? 'Native Done completion time confirmed' : 'Native Archive completion time confirmed', { scope: 'native-host', category: 'storage',
                context: { releaseCheck: envelope.prepared.kind === 'doneStatus'
                    ? 'v1.3.4/ios-done-task-status' : envelope.prepared.kind === 'doneCompletedAt'
                        ? 'v1.3.4/ios-done-completion-time' : 'v1.3.4/ios-archive-completion-time', outcome: 'confirmed' } }); }
            catch { /* Diagnostics cannot invalidate a durable acknowledgment. */ }
        }
        return confirmed;
    };
    const prepare = (kind: 'save' | 'reset', input: unknown): NativeHostResult<NativeChecklistPreparation> => {
        const ready = deps.readiness();
        if (!ready.ok) return ready;
        const request = readRequest(input, deps.validateField);
        if (!request || kind !== (isSave(request) ? 'save' : 'reset')) {
            return fail('INVALID_INPUT', 'A bounded checklist request and lowercase UUID are required');
        }
        const state = useTaskStore.getState();
        const task = state._tasksById.get(request.id);
        if (!task || task.deletedAt || task.purgedAt) return fail('TASK_NOT_FOUND', 'Task not found');
        if (!isArchiveCompletedAtRequest(request) && (deps.isReadOnly(task) || isStatusListTaskReadOnly(task, state._allProjects))) {
            return fail('INVALID_INPUT', 'Task is read-only while its project is archived or deleted');
        }
        if (isSave(request)) {
            if (isHistoryRowRequest(request) && !validHistoryRowSource(task, request))
                return fail('INVALID_INPUT', 'Only a saved Done row can change status');
            if (request.intent === 'cancel' && !canCancelNativeTask(task, state._allProjects, deps.isReadOnly(task)))
                return fail('INVALID_INPUT', 'Task cannot be cancelled');
            if (request.intent === 'skip' && !canSkipNativeTaskOccurrence(task, state._allProjects, deps.isReadOnly(task)))
                return fail('INVALID_INPUT', 'Task cannot skip an occurrence');
            if (!validNativeTaskDraftBases(task, draftRequest(request))
                || !same(toChecklist(task.checklist), request.checklist.base)) {
                return fail('STALE_REVISION', 'Task changed while editing');
            }
            if ((request.patch.status === 'reference' || task.status === 'reference')
                && (request.patch.priority || request.patch.timeEstimate)) {
                return fail('INVALID_INPUT', 'Reference task cannot set priority or time estimate');
            }
            if (request.patch.projectId && !state._allProjects.some((project) =>
                project.id === request.patch.projectId && isSelectableProjectForTaskAssignment(project))) {
                return fail('INVALID_INPUT', 'Project is not available');
            }
        } else {
            if (!same(toChecklist(task.checklist), request.checklistBase)) {
                return fail('STALE_REVISION', 'Checklist changed while editing');
            }
            if (request.checklistBase.length === 0) return { ok: true, value: { kind: 'unchanged', result: resetResult(task) } };
        }
        try {
            const preparedAt = new Date().toISOString();
            const boundary = futureBoundary(preparedAt);
            const device = ensureDeviceId(state.settings);
            const direct = isSave(request) ? directSaveUpdates(task, request, preparedAt) : {};
            if (!direct) return fail('INVALID_INPUT', 'Checklist edit cannot produce a task update');
            if (isSave(request) && request.intent === 'skip'
                && !canSkipRecurringTaskOccurrence({ ...task, ...direct })) {
                return fail('INVALID_INPUT', resolveI18nText(getTranslator(deps.language()), 'task.skipOccurrenceSaveFirst'));
            }
            const source = JSON.parse(JSON.stringify(task)) as Task;
            const settings = JSON.parse(JSON.stringify({ deviceId: state.settings.deviceId,
                gtd: { autoArchiveDays: state.settings.gtd?.autoArchiveDays,
                    focusTaskLimit: state.settings.gtd?.focusTaskLimit },
                ...(isSave(request) && request.intent === 'cancel'
                    ? { undoNotificationsEnabled: state.settings.undoNotificationsEnabled } : {}) })) as AppData['settings'];
            const cancelTranslator = isSave(request) && request.intent === 'cancel' ? getTranslator(deps.language()) : null;
            const witness: Witness = {
                source, lists: { tasks: state._allTasks, projects: state._allProjects,
                    sections: state._allSections, areas: state._allAreas },
                settings, preparedAt, futureBoundary: boundary,
                preparedOffsetMinutes: new Date(preparedAt).getTimezoneOffset(),
                boundaryOffsetMinutes: new Date(boundary).getTimezoneOffset(),
                preparedLocalDay: new Date(Date.parse(preparedAt) - new Date(preparedAt).getTimezoneOffset() * 60_000)
                    .toISOString().slice(0, 10),
                deviceIdBefore: state.settings.deviceId ?? null,
                deviceIdToInitialize: device.updated ? device.deviceId : null,
                recurrenceProjection: isSave(request) && !request.intent && request.patch.status === 'done' && task.status !== 'done'
                    && task.status !== 'archived' ? projectNextRecurringTask(task, preparedAt) : null,
                ...(isSave(request) && request.intent === 'skip'
                    ? { calendarTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : {}),
                ids: [], directClears: cleared(direct), direct: JSON.parse(JSON.stringify(direct)),
                focusCount: countFocusedTasksBeforeBoundary(state.tasks, boundary),
                focusLimit: normalizeFocusTaskLimit(state.settings.gtd?.focusTaskLimit),
                ...(cancelTranslator ? { cancelMessage: resolveI18nText(cancelTranslator, 'task.cancelledWithRestore'),
                    cancelUndoLabel: resolveI18nText(cancelTranslator, 'common.undo') } : {}),
            };
            const first = plan(kind, request, witness, true);
            reduceWitness(witness, first.effect, state);
            const bounded = plan(kind, request, witness);
            if (!same(first, bounded)) return fail('INVALID_INPUT', 'Checklist effect exceeds the bounded witness');
            const frozen = detach(JSON.parse(JSON.stringify({ version: 1, kind, request, witness,
                effect: bounded.effect, result: bounded.result }))) as NativePreparedChecklistWrite | null;
            if (!frozen || !readPrepared({ request, prepared: frozen }, deps.validateField)) {
                return fail('INVALID_INPUT', 'Checklist effect cannot produce a valid prepared journal');
            }
            return { ok: true, value: { kind: 'prepared', prepared: frozen } };
        } catch {
            return fail('INVALID_INPUT', 'Checklist could not be prepared');
        }
    };
    const commitEffect = async <T>(effect: PreparedChecklistEffect, result: T): Promise<NativeHostResult<T>> => {
        const applied = await useTaskStore.getState().commitPreparedChecklistEffect(effect);
        if (!applied.success) return fail('STALE_REVISION', applied.error ?? 'Prepared task change conflicts with current data');
        try {
            if (useTaskStore.getState().persistenceFailure) await useTaskStore.getState().retryPersistence();
        } catch (error) {
            return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
        }
        const saved = await deps.save();
        return saved.ok ? { ok: true, value: result } : saved;
    };
    const commitReceipted = <T>(requestId: string, payload: string, effect: PreparedChecklistEffect, result: T): Promise<NativeHostResult<T>> =>
        deps.receipts.run(requestId, payload, async () => {
            const applied = await useTaskStore.getState().commitPreparedChecklistEffect(effect, { requireBefore: true });
            return applied.success ? { ok: true, value: result }
                : fail('STALE_REVISION', applied.error ?? 'Prepared task change conflicts with current data');
        });
    return {
        getDoneTaskCompletedAtOptions(input: { id: string; taskRevision: string }): NativeHostResult<{
            title: string; saveLabel: string; cancelLabel: string; taskId: string; taskRevision: string;
            initialValue: string | null; initialEpochMilliseconds: number | null;
        }> {
            const source = readHistoryRowSource(input);
            if (!source.ok) return source;
            const t = getTranslator(deps.language());
            const initialValue = getTaskEditorBackdatedCompletionStart(source.value, createTaskDraft(source.value)).initialValue;
            return { ok: true, value: { title: resolveI18nText(t, 'task.completedAtPromptTitle'),
                saveLabel: resolveI18nText(t, 'common.save'), cancelLabel: resolveI18nText(t, 'common.cancel'),
                taskId: source.value.id, taskRevision: input.taskRevision,
                initialValue, initialEpochMilliseconds: initialValue === null ? null : new Date(initialValue).getTime() } };
        },
        async prepareDoneTaskCompletedAt(input: NativeDoneTaskCompletedAtRequest): Promise<NativeHostResult<{
            kind: 'prepared'; prepared: NativePreparedDoneTaskCompletedAt;
        }>> {
            const request = readDoneCompletedAtRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A displayed Done revision, canonical completion instant and request UUID are required');
            const source = readHistoryRowSource({ id: request.id, taskRevision: request.taskRevision });
            if (!source.ok) return source;
            const read = await readAreaDurableData(false, true);
            if (!read.ok) return read;
            const rawRows = read.value.authority.snapshot.tasks.filter((row) => row.id === request.id);
            const rawBefore = rawRows.length === 1 ? rawRows[0] : null;
            if (!rawBefore || rawBefore.status !== 'done' || rawBefore.deletedAt || rawBefore.purgedAt
                || taskRevisionOf(rawBefore) !== request.taskRevision
                || isStatusListTaskReadOnly(rawBefore, read.value.authority.snapshot.projects))
                return fail('STALE_REVISION', 'Saved Done task changed since the row was shown');
            const planned = prepare('save', completedAtSaveRequest(source.value, request, 'doneCompletedAt'));
            if (!planned.ok) return planned;
            if (planned.value.kind !== 'prepared') return fail('INVALID_INPUT', 'Completion time made no change');
            const prepared = detach({ version: 2 as const, kind: 'doneCompletedAt' as const, request,
                rawBefore: JSON.parse(JSON.stringify(rawBefore)) as Task,
                checklist: planned.value.prepared, result: { id: request.id } }, COMPLETION_BYTES);
            return prepared && readDoneCompletedAt({ request, prepared }, deps.validateField)
                ? { ok: true, value: { kind: 'prepared', prepared } }
                : fail('INVALID_INPUT', 'Completion time cannot produce a valid bounded journal');
        },
        validatePreparedDoneTaskCompletedAt(input: NativeDoneTaskCompletedAtEnvelope): NativeHostResult<{ id: string }> {
            const envelope = readDoneCompletedAt(input, deps.validateField);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared completion time is malformed');
        },
        async commitPreparedDoneTaskCompletedAt(input: NativeDoneTaskCompletedAtEnvelope): Promise<NativeHostResult<{ id: string }>> {
            const envelope = readDoneCompletedAt(input, deps.validateField);
            return envelope ? commitHistoryRowWrite(envelope) : fail('INVALID_INPUT', 'Prepared completion time is malformed');
        },
        doneTaskCompletedAtOutcome(input: NativeDoneTaskCompletedAtEnvelope): NativeHostResult<{ id: string } | null> {
            const envelope = readDoneCompletedAt(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared completion time is malformed');
            const saved = historyRowReceipts.saved<{ id: string }>(envelope.request.requestId, canonicalJSON(['doneTaskCompletedAt', envelope]));
            return saved?.ok && !same(saved.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved completion time result does not match its journal')
                : saved ?? { ok: true, value: null };
        },
        getArchiveTaskCompletedAtOptions(input: { id: string; taskRevision: string }): NativeHostResult<{
            title: string; saveLabel: string; cancelLabel: string; taskId: string; taskRevision: string;
            initialValue: string | null; initialEpochMilliseconds: number | null;
        }> {
            const source = readHistoryRowSource(input, true);
            if (!source.ok) return source;
            const t = getTranslator(deps.language());
            const initialValue = getTaskEditorBackdatedCompletionStart(source.value, createTaskDraft(source.value)).initialValue;
            return { ok: true, value: { title: resolveI18nText(t, 'task.completedAtPromptTitle'),
                saveLabel: resolveI18nText(t, 'common.save'), cancelLabel: resolveI18nText(t, 'common.cancel'),
                taskId: source.value.id, taskRevision: input.taskRevision,
                initialValue, initialEpochMilliseconds: initialValue === null ? null : new Date(initialValue).getTime() } };
        },
        async prepareArchiveTaskCompletedAt(input: NativeArchiveTaskCompletedAtRequest): Promise<NativeHostResult<{
            kind: 'prepared'; prepared: NativePreparedArchiveTaskCompletedAt;
        }>> {
            const request = readDoneCompletedAtRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A displayed Done revision, canonical completion instant and request UUID are required');
            const source = readHistoryRowSource({ id: request.id, taskRevision: request.taskRevision }, true);
            if (!source.ok) return source;
            const read = await readAreaDurableData(false, true);
            if (!read.ok) return read;
            const rawRows = read.value.authority.snapshot.tasks.filter((row) => row.id === request.id);
            const rawBefore = rawRows.length === 1 ? rawRows[0] : null;
            if (!rawBefore || !isArchiveCompletedAtSource(rawBefore) || rawBefore.deletedAt || rawBefore.purgedAt
                || taskRevisionOf(rawBefore) !== request.taskRevision)
                return fail('STALE_REVISION', 'Saved Done task changed since the row was shown');
            const planned = prepare('save', completedAtSaveRequest(source.value, request, 'archiveCompletedAt'));
            if (!planned.ok) return planned;
            if (planned.value.kind !== 'prepared') return fail('INVALID_INPUT', 'Completion time made no change');
            const prepared = detach({ version: 2 as const, kind: 'archiveCompletedAt' as const, request,
                rawBefore: JSON.parse(JSON.stringify(rawBefore)) as Task,
                checklist: planned.value.prepared, result: { id: request.id } }, COMPLETION_BYTES);
            return prepared && readArchiveCompletedAt({ request, prepared }, deps.validateField)
                ? { ok: true, value: { kind: 'prepared', prepared } }
                : fail('INVALID_INPUT', 'Completion time cannot produce a valid bounded journal');
        },
        validatePreparedArchiveTaskCompletedAt(input: NativeArchiveTaskCompletedAtEnvelope): NativeHostResult<{ id: string }> {
            const envelope = readArchiveCompletedAt(input, deps.validateField);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared completion time is malformed');
        },
        async commitPreparedArchiveTaskCompletedAt(input: NativeArchiveTaskCompletedAtEnvelope): Promise<NativeHostResult<{ id: string }>> {
            const envelope = readArchiveCompletedAt(input, deps.validateField);
            return envelope ? commitHistoryRowWrite(envelope) : fail('INVALID_INPUT', 'Prepared completion time is malformed');
        },
        archiveTaskCompletedAtOutcome(input: NativeArchiveTaskCompletedAtEnvelope): NativeHostResult<{ id: string } | null> {
            const envelope = readArchiveCompletedAt(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared completion time is malformed');
            const saved = historyRowReceipts.saved<{ id: string }>(envelope.request.requestId, canonicalJSON(['archiveTaskCompletedAt', envelope]));
            return saved?.ok && !same(saved.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved completion time result does not match its journal')
                : saved ?? { ok: true, value: null };
        },
        getDoneTaskStatusOptions(input: { id: string; taskRevision: string }): NativeHostResult<{
            title: string; taskId: string; taskRevision: string; status: 'done';
            options: { status: NativeDoneTaskStatus; label: string; selected: boolean }[];
        }> {
            const source = readHistoryRowSource(input);
            if (!source.ok) return source;
            const task = source.value;
            const t = getTranslator(deps.language());
            return { ok: true, value: { title: resolveI18nText(t, 'taskStatus.changeStatus'),
                taskId: task.id, taskRevision: input.taskRevision, status: 'done',
                options: DONE_STATUS_OPTIONS.map((status) => ({ status, label: resolveI18nText(t, `status.${status}`),
                    selected: status === 'done' })) } };
        },
        async prepareDoneTaskStatus(input: NativeDoneTaskStatusRequest): Promise<NativeHostResult<
            { kind: 'noop'; result: { id: string } } | { kind: 'prepared'; prepared: NativePreparedDoneTaskStatus }>> {
            const request = readDoneStatusRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A displayed Done task revision, quick status and request UUID are required');
            const source = readHistoryRowSource({ id: request.id, taskRevision: request.taskRevision });
            if (!source.ok) return source;
            if (request.status === 'done') return { ok: true, value: { kind: 'noop', result: { id: request.id } } };
            const read = await readAreaDurableData(false, true);
            if (!read.ok) return read;
            const rawRows = read.value.authority.snapshot.tasks.filter((row) => row.id === request.id);
            const rawBefore = rawRows.length === 1 ? rawRows[0] : null;
            if (!rawBefore || rawBefore.status !== 'done' || rawBefore.deletedAt || rawBefore.purgedAt
                || taskRevisionOf(rawBefore) !== request.taskRevision
                || isStatusListTaskReadOnly(rawBefore, read.value.authority.snapshot.projects))
                return fail('STALE_REVISION', 'Saved Done task changed since the row was shown');
            const planned = prepare('save', doneStatusSaveRequest(source.value, request));
            if (!planned.ok) return planned;
            if (planned.value.kind !== 'prepared') return fail('INVALID_INPUT', 'Done status made no change');
            const prepared = detach({ version: 2 as const, kind: 'doneStatus' as const, request,
                rawBefore: JSON.parse(JSON.stringify(rawBefore)) as Task,
                checklist: planned.value.prepared, result: { id: request.id } }, COMPLETION_BYTES);
            return prepared && readDoneStatus({ request, prepared }, deps.validateField)
                ? { ok: true, value: { kind: 'prepared', prepared } }
                : fail('INVALID_INPUT', 'Done status cannot produce a valid bounded journal');
        },
        validatePreparedDoneTaskStatus(input: NativeDoneTaskStatusEnvelope): NativeHostResult<{ id: string }> {
            const envelope = readDoneStatus(input, deps.validateField);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared Done status is malformed');
        },
        async commitPreparedDoneTaskStatus(input: NativeDoneTaskStatusEnvelope): Promise<NativeHostResult<{ id: string }>> {
            const envelope = readDoneStatus(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared Done status is malformed');
            return commitHistoryRowWrite(envelope);
        },
        doneTaskStatusOutcome(input: NativeDoneTaskStatusEnvelope): NativeHostResult<{ id: string } | null> {
            const envelope = readDoneStatus(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared Done status is malformed');
            const saved = historyRowReceipts.saved<{ id: string }>(envelope.request.requestId, canonicalJSON(['doneTaskStatus', envelope]));
            return saved?.ok && !same(saved.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved Done status result does not match its journal')
                : saved ?? { ok: true, value: null };
        },
        prepareTaskCompletion(input: NativeTaskCompletionRequest): NativeHostResult<{ kind: 'prepared'; prepared: NativePreparedTaskCompletion }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readCompletionRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A displayed task revision and request UUID are required');
            const state = useTaskStore.getState();
            const task = state._tasksById.get(request.id);
            if (!task || task.deletedAt || task.purgedAt) return fail('TASK_NOT_FOUND', 'Task not found');
            if (taskRevisionOf(task) !== request.taskRevision) return fail('STALE_REVISION', 'Task changed since it was shown');
            if (!canCompleteNativeTask(task, state._allProjects, deps.isReadOnly(task)))
                return fail('INVALID_INPUT', 'Task cannot be completed');
            const planned = prepare('save', completionSaveRequest(task, request.requestId));
            if (!planned.ok) return planned;
            if (planned.value.kind !== 'prepared') return fail('INVALID_INPUT', 'Task completion made no change');
            const translator = getTranslator(deps.language());
            const formatted = formatTaskMarkedDoneMessage(translator, task.title);
            const done = resolveI18nText(translator, 'common.done');
            const message = validCancelText(formatted, 512) ? formatted
                : validCancelText(done, 512) ? done : 'Done';
            const translatedUndo = resolveI18nText(translator, 'common.undo');
            const undoLabel = validCancelText(translatedUndo, 80) ? translatedUndo : 'Undo';
            const completed = planned.value.prepared.effect.tasks.find((row) => row.after.id === request.id)?.after;
            if (!completed?.completedAt)
                return fail('INVALID_INPUT', 'Completion notice cannot be represented');
            const result: NativeTaskCompletionResult = { id: request.id,
                completion: { completedAt: completed.completedAt, undoEnabled: true, message, undoLabel } };
            const prepared = detach({ version: 1 as const, kind: 'complete' as const, request,
                checklist: planned.value.prepared, notice: { message, undoLabel }, result }, COMPLETION_BYTES);
            return prepared && readCompletion({ request, prepared }, deps.validateField)
                ? { ok: true, value: { kind: 'prepared', prepared } }
                : fail('INVALID_INPUT', 'Completion cannot produce a valid bounded journal');
        },
        validatePreparedTaskCompletion(input: NativeTaskCompletionEnvelope): NativeHostResult<NativeTaskCompletionResult> {
            const envelope = readCompletion(input, deps.validateField);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared completion is malformed');
        },
        async commitPreparedTaskCompletion(input: NativeTaskCompletionEnvelope): Promise<NativeHostResult<NativeTaskCompletionResult>> {
            const envelope = readCompletion(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared completion is malformed');
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const result = await commitReceipted(envelope.request.requestId,
                canonicalJSON(['taskCompletion', envelope]), envelope.prepared.checklist.effect, envelope.prepared.result);
            return result.ok && !same(result.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved completion result does not match its journal') : result;
        },
        taskCompletionOutcome(input: NativeTaskCompletionEnvelope): NativeHostResult<NativeTaskCompletionResult | null> {
            const envelope = readCompletion(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared completion is malformed');
            const saved = deps.receipts.saved<NativeTaskCompletionResult>(envelope.request.requestId,
                canonicalJSON(['taskCompletion', envelope]));
            return saved?.ok && !same(saved.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved completion result does not match its journal')
                : saved ?? { ok: true, value: null };
        },
        prepareTaskCompletionUndo(input: { request: NativeTaskCompletionUndoRequest; completion: NativeTaskCompletionEnvelope }): NativeHostResult<
            { kind: 'prepared'; prepared: NativePreparedTaskCompletionUndo }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readCompletionUndoRequest(input?.request);
            const completion = readCompletion(input?.completion, deps.validateField);
            if (!request || !completion || request.completionRequestId !== completion.request.requestId)
                return fail('INVALID_INPUT', 'A confirmed completion and new Undo UUID are required');
            const confirmed = deps.receipts.saved<NativeTaskCompletionResult>(completion.request.requestId,
                canonicalJSON(['taskCompletion', completion]));
            if (!confirmed?.ok || !same(confirmed.value, completion.prepared.result))
                return fail('STALE_REVISION', 'Completion has no saved request receipt');
            const state = useTaskStore.getState();
            const matches = state._allTasks.filter((row) => row.id === completion.request.id);
            const task = matches.length === 1 ? matches[0] : null;
            const completed = completion.prepared.checklist.effect.tasks.find((row) => row.after.id === completion.request.id)?.after;
            const child = ownedCompletionChild(completion);
            if (!task || !completed || task.deletedAt || task.purgedAt || task.status !== 'done'
                || task.completedAt !== completed.completedAt || (task.rev ?? 0) < (completed.rev ?? 0)
                || deps.isReadOnly(task) || isStatusListTaskReadOnly(task, state._allProjects)
                || (child && !sameSavedTask(state._allTasks.find((row) => row.id === child.id), child)))
                return fail('STALE_REVISION', 'Completion or its recurring follow-up was superseded');
            try {
                const preparedAt = new Date().toISOString();
                const boundary = futureBoundary(preparedAt);
                const device = ensureDeviceId(state.settings);
                const witness: Witness = {
                    source: JSON.parse(JSON.stringify(task)) as Task,
                    lists: { tasks: state._allTasks, projects: state._allProjects,
                        sections: state._allSections, areas: state._allAreas },
                    settings: JSON.parse(JSON.stringify({ deviceId: state.settings.deviceId,
                        gtd: { autoArchiveDays: state.settings.gtd?.autoArchiveDays,
                            focusTaskLimit: state.settings.gtd?.focusTaskLimit } })) as AppData['settings'],
                    preparedAt, futureBoundary: boundary,
                    preparedOffsetMinutes: new Date(preparedAt).getTimezoneOffset(),
                    boundaryOffsetMinutes: new Date(boundary).getTimezoneOffset(),
                    preparedLocalDay: new Date(Date.parse(preparedAt) - new Date(preparedAt).getTimezoneOffset() * 60_000)
                        .toISOString().slice(0, 10),
                    deviceIdBefore: state.settings.deviceId ?? null,
                    deviceIdToInitialize: device.updated ? device.deviceId : null,
                    recurrenceProjection: null, ids: [], directClears: [], direct: {},
                    focusCount: countFocusedTasksBeforeBoundary(state.tasks, boundary),
                    focusLimit: normalizeFocusTaskLimit(state.settings.gtd?.focusTaskLimit),
                };
                const direct = completionUndoDirect(completion, witness);
                witness.directClears = cleared(direct);
                witness.direct = JSON.parse(JSON.stringify(direct));
                const first = planCompletionUndo(completion, witness);
                reduceWitness(witness, first, state);
                const bounded = planCompletionUndo(completion, witness);
                if (!same(first, bounded)) return fail('INVALID_INPUT', 'Undo effect exceeds the bounded witness');
                const prepared = detach(JSON.parse(JSON.stringify({ version: 1 as const, kind: 'undo' as const, request, completion,
                    witness, effect: bounded, result: { id: task.id } })), COMPLETION_UNDO_BYTES) as NativePreparedTaskCompletionUndo | null;
                return prepared && readCompletionUndo({ request, prepared }, deps.validateField)
                    ? { ok: true, value: { kind: 'prepared', prepared } }
                    : fail('INVALID_INPUT', 'Undo cannot produce a valid bounded journal');
            } catch { return fail('INVALID_INPUT', 'Undo could not be prepared'); }
        },
        validatePreparedTaskCompletionUndo(input: NativeTaskCompletionUndoEnvelope): NativeHostResult<{ id: string }> {
            const envelope = readCompletionUndo(input, deps.validateField);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared completion Undo is malformed');
        },
        taskCompletionUndoOutcome(input: NativeTaskCompletionUndoEnvelope): NativeHostResult<{ id: string } | null> {
            const envelope = readCompletionUndo(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared completion Undo is malformed');
            const saved = deps.receipts.saved<{ id: string }>(envelope.request.requestId,
                canonicalJSON(['taskCompletionUndo', envelope]));
            return saved?.ok && !same(saved.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved completion Undo result does not match its journal')
                : saved ?? { ok: true, value: null };
        },
        async commitPreparedTaskCompletionUndo(input: NativeTaskCompletionUndoEnvelope): Promise<NativeHostResult<{ id: string }>> {
            const envelope = readCompletionUndo(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared completion Undo is malformed');
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const payload = canonicalJSON(['taskCompletionUndo', envelope]);
            const savedUndo = deps.receipts.saved<{ id: string }>(envelope.request.requestId, payload);
            if (savedUndo) return savedUndo.ok && !same(savedUndo.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved completion Undo result does not match its journal') : savedUndo;
            const confirmed = deps.receipts.saved<NativeTaskCompletionResult>(envelope.prepared.completion.request.requestId,
                canonicalJSON(['taskCompletion', envelope.prepared.completion]));
            if (!confirmed?.ok || !same(confirmed.value, envelope.prepared.completion.prepared.result))
                return fail('STALE_REVISION', 'Completion has no saved request receipt');
            const result = await commitReceipted(envelope.request.requestId, payload,
                envelope.prepared.effect, envelope.prepared.result);
            return result.ok && !same(result.value, envelope.prepared.result)
                ? fail('INVALID_INPUT', 'Saved completion Undo result does not match its journal') : result;
        },
        prepareTaskChecklistSave: (request: NativeChecklistSaveRequest): NativeHostResult<NativeChecklistPreparation> =>
            isHistoryRowRequest(request) ? fail('INVALID_INPUT', 'Done status requires its row request') : prepare('save', request),
        prepareTaskChecklistReset: (request: NativeChecklistResetRequest): NativeHostResult<NativeChecklistPreparation> => prepare('reset', request),
        /** Pure journal authority check, valid before storage activation and terminal cleanup. */
        validatePreparedTaskChecklistWrite(input: { request: NativeChecklistWriteRequest; prepared: NativePreparedChecklistWrite }): NativeHostResult<NativeChecklistResult> {
            const prepared = readPrepared(input, deps.validateField);
            return prepared && !isHistoryRowRequest(prepared.request) ? { ok: true, value: prepared.result }
                : fail('INVALID_INPUT', 'Prepared checklist request or journal does not match');
        },
        async commitPreparedTaskChecklistWrite(input: { request: NativeChecklistWriteRequest; prepared: NativePreparedChecklistWrite }): Promise<NativeHostResult<NativeChecklistResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const prepared = readPrepared(input, deps.validateField);
            if (!prepared || isHistoryRowRequest(prepared.request))
                return fail('INVALID_INPUT', 'Prepared checklist request or journal does not match');
            return commitEffect(prepared.effect, prepared.result);
        },
        prepareTaskCancellationUndo(input: { request: NativeTaskCancellationUndoRequest; cancel: NativeChecklistCancellationEnvelope }): NativeHostResult<
            { kind: 'prepared'; prepared: NativePreparedTaskCancellationUndo }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readUndoRequest(input?.request);
            const cancel = readCancellation(input?.cancel, deps.validateField);
            if (!request || !cancel || request.cancelRequestId !== cancel.request.requestId)
                return fail('INVALID_INPUT', 'A confirmed cancellation and new Undo UUID are required');
            const state = useTaskStore.getState();
            const matches = state._allTasks.filter((row) => row.id === cancel.request.id);
            const task = matches.length === 1 ? matches[0] : null;
            const cancelled = cancel.prepared.effect.tasks.find((row) => row.after.id === cancel.request.id)?.after;
            if (!task || !cancelled || task.deletedAt || task.purgedAt || task.status !== 'archived'
                || task.cancelledAt !== cancelled.cancelledAt
                || isStatusListTaskReadOnly(task, state._allProjects) || deps.isReadOnly(task))
                return fail('STALE_REVISION', 'Cancellation was superseded');
            try {
                const preparedAt = new Date().toISOString();
                const boundary = futureBoundary(preparedAt);
                const device = ensureDeviceId(state.settings);
                const direct = taskCancellationRestoreFields(cancel.prepared.witness.source);
                const witness: Witness = {
                    source: JSON.parse(JSON.stringify(task)) as Task,
                    lists: { tasks: state._allTasks, projects: state._allProjects,
                        sections: state._allSections, areas: state._allAreas },
                    settings: JSON.parse(JSON.stringify({ deviceId: state.settings.deviceId,
                        gtd: { autoArchiveDays: state.settings.gtd?.autoArchiveDays,
                            focusTaskLimit: state.settings.gtd?.focusTaskLimit } })) as AppData['settings'],
                    preparedAt, futureBoundary: boundary,
                    preparedOffsetMinutes: new Date(preparedAt).getTimezoneOffset(),
                    boundaryOffsetMinutes: new Date(boundary).getTimezoneOffset(),
                    preparedLocalDay: new Date(Date.parse(preparedAt) - new Date(preparedAt).getTimezoneOffset() * 60_000)
                        .toISOString().slice(0, 10),
                    deviceIdBefore: state.settings.deviceId ?? null,
                    deviceIdToInitialize: device.updated ? device.deviceId : null,
                    recurrenceProjection: null, ids: [], directClears: cleared(direct),
                    direct: JSON.parse(JSON.stringify(direct)),
                    focusCount: countFocusedTasksBeforeBoundary(state.tasks, boundary),
                    focusLimit: normalizeFocusTaskLimit(state.settings.gtd?.focusTaskLimit),
                };
                const first = plan('save', cancel.request, witness, true, true);
                if (witness.ids.length !== 0) return fail('INVALID_INPUT', 'Undo cannot create recurring tasks');
                reduceWitness(witness, first.effect, state);
                const bounded = plan('save', cancel.request, witness, false, true);
                if (!same(first, bounded)) return fail('INVALID_INPUT', 'Undo effect exceeds the bounded witness');
                const prepared = detach(JSON.parse(JSON.stringify({ version: 1, kind: 'undo' as const, request, cancel, witness,
                    effect: bounded.effect, result: bounded.result }))) as NativePreparedTaskCancellationUndo | null;
                if (!prepared) return fail('INVALID_INPUT', 'Undo cannot produce a valid bounded journal');
                return readPreparedUndo({ request, prepared }, deps.validateField)
                    ? { ok: true, value: { kind: 'prepared', prepared } }
                    : fail('INVALID_INPUT', 'Undo cannot produce a valid bounded journal');
            } catch { return fail('INVALID_INPUT', 'Undo could not be prepared'); }
        },
        validatePreparedTaskCancellationUndo(input: NativeTaskCancellationUndoEnvelope): NativeHostResult<{ id: string }> {
            const envelope = readPreparedUndo(input, deps.validateField);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared cancellation Undo is malformed');
        },
        async commitPreparedTaskCancellationUndo(input: NativeTaskCancellationUndoEnvelope): Promise<NativeHostResult<{ id: string }>> {
            const envelope = readPreparedUndo(input, deps.validateField);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared cancellation Undo is malformed');
            const ready = deps.readiness();
            return ready.ok ? commitEffect(envelope.prepared.effect, envelope.prepared.result) : ready;
        },
    };
}
