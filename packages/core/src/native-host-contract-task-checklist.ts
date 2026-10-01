import type { NativeHostResult } from './native-host-contract';
import { useTaskStore } from './store';
import type { PreparedChecklistEffect, TaskStore } from './store-types';
import type { AppData, Area, ChecklistItem, Project, Section, Task } from './types';
import type { TaskDraftField } from './task-draft';
import { createTaskDraft } from './task-draft';
import { applyTaskDraftPatch, buildTaskEditUpdatePatch } from './task-editor-model';
import {
    nativeTaskDraftPatchValues, readNativeTaskDraftSaveRequest,
    validNativeTaskDraftBases, validNativeTaskDraftScheduleEffect, type NativeTaskDraftSaveRequest,
} from './native-host-contract-task-save';
import { isNativeJsonWithinBytes, readChecklist, toChecklist } from './native-host-contract-task-view';
import { buildResetTaskChecklistUpdates, planTaskUpdateEffects, prepareTaskUpdatesForStore,
    taskEditValuesEqual } from './store-tasks';
import { createProjectOrderReserver, ensureDeviceId, getNextProjectOrder, getTaskOrder,
    nextRevision } from './store-helpers';
import { countFocusedTasksBeforeBoundary } from './task-utils';
import { normalizeFocusTaskLimit } from './focus-utils';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { isStatusListTaskReadOnly } from './menu-views-model';
import { mergeNativeTaskLinkHalf } from './native-host-contract-attachments';
import { projectNextRecurringTask, type RecurrenceProjection } from './recurrence';
import { generateUUID } from './uuid';
import { getTranslator, resolveI18nText } from './i18n';
import { isTaskActionable } from './task-status';
import { isProjectedRecurringTaskId } from './recurrence';
import { taskCancellationRestoreFields } from './undo-task-cancellation';

export type NativeChecklistSaveRequest = NativeTaskDraftSaveRequest & {
    requestId: string;
    checklist: { base: ChecklistItem[]; value: ChecklistItem[] };
    intent?: 'cancel';
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

const LIMIT_BYTES = 2_000_000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
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

const detach = <T>(value: T): T | null => {
    const safe = (item: unknown, depth: number): boolean => {
        if (depth > 30) return false;
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
        if (typeof item === 'number') return Number.isFinite(item);
        if (Array.isArray(item)) return item.length <= LIMIT_BYTES && item.every((entry) => safe(entry, depth + 1));
        return isRecord(item) && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)
            && Object.keys(item).length <= 256 && Object.entries(item).every(([key, entry]) =>
                !['__proto__', 'prototype', 'constructor'].includes(key) && safe(entry, depth + 1));
    };
    if (!safe(value, 0)) return null;
    const encoded = JSON.stringify(value);
    return isNativeJsonWithinBytes(value, LIMIT_BYTES) ? JSON.parse(encoded) as T : null;
};
const isSave = (value: NativeChecklistWriteRequest): value is NativeChecklistSaveRequest => 'checklist' in value;
const readUndoRequest = (value: unknown): NativeTaskCancellationUndoRequest | null => {
    const input = detach(value);
    return isRecord(input) && exact(input, ['requestId', 'cancelRequestId'])
        && typeof input.requestId === 'string' && UUID.test(input.requestId)
        && typeof input.cancelRequestId === 'string' && UUID.test(input.cancelRequestId)
        && input.requestId !== input.cancelRequestId ? input as NativeTaskCancellationUndoRequest : null;
};
export const canCancelNativeTask = (task: Task, projects: readonly Project[], readOnly = false): boolean =>
    !readOnly && !task.deletedAt && !task.purgedAt && isTaskActionable(task)
    && !isProjectedRecurringTaskId(task.id) && !isStatusListTaskReadOnly(task, projects);
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
    const parsed = readNativeTaskDraftSaveRequest(bare, validateField, true, false, true);
    if (!base || !selected || !parsed || (own(input, 'intent') && input.intent !== 'cancel')
        || !exact(input, ['id', 'requestId', 'base', 'patch', 'scheduleBase', 'checklist',
            ...(parsed.recurrenceBase ? ['recurrenceBase'] : []), ...(parsed.attachments ? ['attachments'] : []),
            ...(input.intent === 'cancel' ? ['intent'] : [])])) return null;
    return { ...parsed, requestId: input.requestId, checklist: { base, value: selected },
        ...(input.intent === 'cancel' ? { intent: 'cancel' as const } : {}) };
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
        const effects = planTaskUpdateEffects({ task: source, preparedUpdates: prepared.updates,
            allTasks: lists.tasks, allProjects: lists.projects, allSections: lists.sections,
            now: witness.preparedAt, deviceId: deviceId(witness),
            createId: () => {
                let id = witness.ids[generated++];
                if (!id && allowIds && witness.ids.length < Math.floor(LIMIT_BYTES / 38)) {
                    id = generateUUID();
                    witness.ids.push(id);
                }
                if (!id) throw new Error('Missing frozen checklist child ID');
                return id;
            },
            recurrenceProjection: prepared.updates.status === 'done' && source.status !== 'done'
                && source.status !== 'archived' ? witness.recurrenceProjection : undefined });
        tasks = effects.tasks;
        projects = effects.projects;
        sections = effects.sections;
        recurringCandidate = effects.recurringCandidateTask;
        recurringDuplicate = effects.recurringDuplicateTask;
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
        || isStatusListTaskReadOnly(witness.source, witness.lists.projects as Project[])
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
                && typeof witness.settings.undoNotificationsEnabled !== 'boolean')))) return null;
    if (isSave(request)) {
        if (!validNativeTaskDraftBases(witness.source, draftRequest(request))
            || !same(toChecklist(witness.source.checklist), request.checklist.base)
            || !directIsBound(witness.source, request, witness)
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
            if (!after || !validNativeTaskDraftScheduleEffect(witness.source, draftRequest(request), after, validateField)) return null;
        }
        return same(planned.effect, prepared.effect) && same(planned.result, prepared.result) ? prepared : null;
    } catch {
        return null;
    }
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
}) {
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
        if (deps.isReadOnly(task) || isStatusListTaskReadOnly(task, state._allProjects)) {
            return fail('INVALID_INPUT', 'Task is read-only while its project is archived or deleted');
        }
        if (isSave(request)) {
            if (request.intent === 'cancel' && !canCancelNativeTask(task, state._allProjects, deps.isReadOnly(task)))
                return fail('INVALID_INPUT', 'Task cannot be cancelled');
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
                recurrenceProjection: isSave(request) && request.intent !== 'cancel' && request.patch.status === 'done' && task.status !== 'done'
                    && task.status !== 'archived' ? projectNextRecurringTask(task, preparedAt) : null,
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
    return {
        prepareTaskChecklistSave: (request: NativeChecklistSaveRequest): NativeHostResult<NativeChecklistPreparation> => prepare('save', request),
        prepareTaskChecklistReset: (request: NativeChecklistResetRequest): NativeHostResult<NativeChecklistPreparation> => prepare('reset', request),
        /** Pure journal authority check, valid before storage activation and terminal cleanup. */
        validatePreparedTaskChecklistWrite(input: { request: NativeChecklistWriteRequest; prepared: NativePreparedChecklistWrite }): NativeHostResult<NativeChecklistResult> {
            const prepared = readPrepared(input, deps.validateField);
            return prepared ? { ok: true, value: prepared.result }
                : fail('INVALID_INPUT', 'Prepared checklist request or journal does not match');
        },
        async commitPreparedTaskChecklistWrite(input: { request: NativeChecklistWriteRequest; prepared: NativePreparedChecklistWrite }): Promise<NativeHostResult<NativeChecklistResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const prepared = readPrepared(input, deps.validateField);
            if (!prepared) return fail('INVALID_INPUT', 'Prepared checklist request or journal does not match');
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
