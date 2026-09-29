import {
    applyProjectLifecycleTransition,
    ensureDeviceId,
    getNextDataChangeAt,
    nextRevision,
    persist,
    replaceEntitiesInArray,
} from '../store-helpers';
import {
    isProjectCancelled,
    normalizeProjectLifecycleFields,
    normalizeProjectUpdate,
} from '../project-status';
import { normalizeCancellationTimestamp } from '../task-status';
import { logInfo, logWarn } from '../logger';
import { clearDerivedCache } from '../store-settings';
import { generateUUID as uuidv4 } from '../uuid';
import { DEFAULT_PROJECT_COLOR } from '../color-constants';
import { findSelectableProjectByTitleAndArea, normalizeProjectTaskSortBy } from '../project-utils';
import { PROJECT_SQLITE_COLUMNS, projectToSqliteRow } from '../project-sync-schema';
import { taskEditValuesEqual } from '../json-value-equality';
import type { Area, TaskSortBy } from '../types';
import type { Project, ProjectCoreActions, ProjectActionContext, Task, TaskStatus } from './shared';
import type { PreparedProjectArea, PreparedProjectCreate, PreparedProjectDate, PreparedProjectFlow, PreparedProjectTaskSort, PreparedProjectFocus, PreparedProjectNotesWrite, PreparedProjectTagsWrite, PreparedProjectRename, PreparedProjectStatus, PreparedTaskEditResult, ProjectFlowAction, TaskStore } from '../store-types';
import { projectTagsForIntent, type ProjectTagsIntent } from '../project-tags';
import type { PendingRemoteAttachmentDelete } from '../types';
import {
    compactPurgedProjectForLocalStorage,
    compactPurgedProjectSectionTombstone,
} from '../tombstone-compaction';
import { actionFail, actionOk, mutateEntities } from './shared';

const duplicateProjectAttachmentCopy = (attachment: NonNullable<Project['attachments']>[number], now: string) => ({
    ...attachment,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
    deletedAt: undefined,
    cloudKey: undefined,
    fileHash: undefined,
    localStatus: undefined,
    contentRev: undefined,
    contentMtimeMs: undefined,
    contentSize: undefined,
});

const collectRetainedAttachmentCloudKeys = (
    projects: readonly Project[],
    tasks: readonly Task[],
): Set<string> => {
    const cloudKeys = new Set<string>();
    for (const project of projects) {
        if (project.purgedAt) continue;
        for (const attachment of project.attachments || []) {
            if (attachment.kind === 'file' && attachment.cloudKey) {
                cloudKeys.add(attachment.cloudKey);
            }
        }
    }
    for (const task of tasks) {
        if (task.purgedAt) continue;
        for (const attachment of task.attachments || []) {
            if (attachment.kind === 'file' && attachment.cloudKey) {
                cloudKeys.add(attachment.cloudKey);
            }
        }
    }
    return cloudKeys;
};

const collectPendingRemoteDeletesForProjects = (
    projects: readonly Project[],
    remainingProjects: readonly Project[],
    tasks: readonly Task[],
): PendingRemoteAttachmentDelete[] => {
    const byCloudKey = new Map<string, PendingRemoteAttachmentDelete>();
    const retainedCloudKeys = collectRetainedAttachmentCloudKeys(remainingProjects, tasks);
    for (const project of projects) {
        for (const attachment of project.attachments || []) {
            if (attachment.kind !== 'file' || !attachment.cloudKey) continue;
            if (retainedCloudKeys.has(attachment.cloudKey)) continue;
            if (byCloudKey.has(attachment.cloudKey)) continue;
            byCloudKey.set(attachment.cloudKey, {
                cloudKey: attachment.cloudKey,
            });
        }
    }
    return Array.from(byCloudKey.values());
};

const appendPendingRemoteDeletes = (
    settings: TaskStore['settings'],
    pendingDeletes: readonly PendingRemoteAttachmentDelete[],
): TaskStore['settings'] => {
    if (pendingDeletes.length === 0) return settings;
    const byCloudKey = new Map<string, PendingRemoteAttachmentDelete>();
    for (const existing of settings.attachments?.pendingRemoteDeletes || []) {
        byCloudKey.set(existing.cloudKey, existing);
    }
    for (const pending of pendingDeletes) {
        if (byCloudKey.has(pending.cloudKey)) continue;
        byCloudKey.set(pending.cloudKey, pending);
    }
    return {
        ...settings,
        attachments: {
            ...settings.attachments,
            pendingRemoteDeletes: Array.from(byCloudKey.values()),
        },
    };
};

type BuildNewProjectParams = {
    title: string;
    color?: string;
    initialProps?: Partial<Project>;
    existingProjects: readonly Project[];
    /** Needed only to stamp `areaTitle`, the denormalized copy of the area name
     *  that every other project writer keeps in step. Omitting it at creation
     *  leaves a project the sync merge has to repair on the next cycle. */
    existingAreas: readonly Area[];
    settings: TaskStore['settings'];
    deviceId: string;
    now: string;
    id?: string;
};

/** At most this many projects can be starred (focused) at once. */
export const MAX_FOCUSED_PROJECTS = 5;

/** RN's existing toggle policy, shared with the prepared native writer. */
export const projectFocusToggleUpdate = (project: Project, focusedProjectCount: number): { isFocused: boolean } | null => {
    if (project.status !== 'active' && !project.isFocused) return null;
    if (!project.isFocused && focusedProjectCount >= MAX_FOCUSED_PROJECTS) return null;
    return { isFocused: !project.isFocused };
};

export const countFocusedLiveProjects = (projects: readonly Project[]): number =>
    projects.filter((project) => !project.deletedAt && project.isFocused).length;

const projectJsonColumns = new Set(['tagIds', 'attachments']);
/** Compare the complete persisted Project, tolerating only JSON object-member key order. */
export const sameProjectSqliteRow = (left: Project, right: Project): boolean => {
    const before = projectToSqliteRow(left);
    const after = projectToSqliteRow(right);
    return before.length === after.length && before.every((value, index) => {
        const other = after[index];
        return projectJsonColumns.has(PROJECT_SQLITE_COLUMNS[index]) && typeof value === 'string'
            && typeof other === 'string' ? taskEditValuesEqual(JSON.parse(value), JSON.parse(other))
                : Object.is(value, other);
    });
};

export const projectFocusEffect = (project: Project, focusedProjectCount: number, focused: boolean,
    deviceId: string, now: string): PreparedProjectFocus['effect'] | null => {
    const update = projectFocusToggleUpdate(project, focusedProjectCount);
    return update?.isFocused === focused ? { project: { before: project, after: {
        ...project, ...update, updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    } } } : null;
};

export const normalizeProjectRenameTitle = (title: string): string => title.trim();

/** RN updateProject's nonarchived title-only lifecycle result, without child writes. */
export const projectRenameEffect = (project: Project, title: string, deviceId: string,
    now: string): PreparedProjectRename['effect'] => {
    const normalizedTitle = normalizeProjectRenameTitle(title);
    const transition = applyProjectLifecycleTransition(project, { title: normalizedTitle }, [], [], now, deviceId);
    return { project: { before: project, after: normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    }) } };
};

/** RN updateProject's nonstatus flow-field lifecycle result, without child writes. */
export const projectFlowEffect = (project: Project, action: ProjectFlowAction, deviceId: string,
    now: string): PreparedProjectFlow['effect'] | null => {
    if (action.kind === 'setScope' && (!project.isSequential || project.sequentialScope === action.scope)) return null;
    const patch: Partial<Project> = action.kind === 'toggleType'
        ? { isSequential: !project.isSequential } : { sequentialScope: action.scope };
    const transition = applyProjectLifecycleTransition(project, patch, [], [], now, deviceId);
    return { project: { before: project, after: normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    }) } };
};

/** RN updateProject's Project-only sort result, normalized for synced storage. */
export const projectTaskSortEffect = (project: Project, sortBy: TaskSortBy, deviceId: string,
    now: string): PreparedProjectTaskSort['effect'] | null => {
    const desired = normalizeProjectTaskSortBy(sortBy);
    if (normalizeProjectTaskSortBy(project.taskSortBy) === desired) return null;
    const transition = applyProjectLifecycleTransition(project, { taskSortBy: desired }, [], [], now, deviceId);
    const after = normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    });
    if (!desired) delete after.taskSortBy;
    return { project: { before: project, after } };
};

/** Empty against absent or empty Notes is a no-op; every other character is raw data. */
export const isProjectNotesWriteNoop = (project: Project, text: string): boolean =>
    project.supportNotes === text || (text === '' && !project.supportNotes);

/** RN updateProject's raw supportNotes-only lifecycle result, without child writes. */
export const projectNotesWriteEffect = (project: Project, text: string, deviceId: string,
    now: string): PreparedProjectNotesWrite['effect'] => {
    const transition = applyProjectLifecycleTransition(project, { supportNotes: text }, [], [], now, deviceId);
    return { project: { before: project, after: normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    }) } };
};

/** RN updateProject's tagIds-only lifecycle result, preserving unrelated raw columns. */
export const projectTagsWriteEffect = (project: Project, intent: ProjectTagsIntent, deviceId: string,
    now: string): PreparedProjectTagsWrite['effect'] | null => {
    const tagIds = projectTagsForIntent(project.tagIds ?? [], intent);
    if (taskEditValuesEqual(project.tagIds ?? [], tagIds)) return null;
    const transition = applyProjectLifecycleTransition(project, { tagIds }, [], [], now, deviceId);
    return { project: { before: project, after: normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    }) } };
};

/** RN updateProject's Active/Waiting/Someday lifecycle result, without child writes. */
export const projectStatusEffect = (project: Project, status: 'active' | 'waiting' | 'someday',
    deviceId: string, now: string): PreparedProjectStatus['effect'] => {
    const transition = applyProjectLifecycleTransition(project, { status }, [], [], now, deviceId);
    return { project: { before: project, after: normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    }) } };
};

/** RN updateProject's Project date lifecycle result, with no child writes. */
export const projectDateEffect = (project: Project, field: 'startDate' | 'dueDate' | 'reviewAt', value: string | null,
    deviceId: string, now: string): PreparedProjectDate['effect'] => {
    const transition = applyProjectLifecycleTransition(project, { [field]: value ?? undefined }, [], [], now, deviceId);
    return { project: { before: project, after: normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    }) } };
};

/** Clearing absent/null/empty preserves the original raw representation. */
export const isProjectDateNoop = (project: Project, field: 'startDate' | 'dueDate' | 'reviewAt', value: string | null): boolean =>
    value === null ? !project[field] : project[field] === value;

/** RN's destination-tail max includes tombstones and ignores nonfinite orders. */
export const projectAreaOrderMax = (projects: readonly Project[], areaId: string | null): number => projects
    .filter((project) => (project.areaId ?? null) === areaId)
    .reduce((max, project) => Math.max(max, Number.isFinite(project.order) ? project.order : -1), -1);

/** Own `areaId` is a selection; omission must leave Area metadata untouched. */
export const projectAreaSelection = (project: Project, updates: Partial<Project>,
    projects: readonly Project[], areas: readonly Area[]) => {
    const selected = Object.prototype.hasOwnProperty.call(updates, 'areaId');
    const areaId = selected ? updates.areaId ?? undefined : project.areaId;
    const changed = selected && (areaId ?? undefined) !== (project.areaId ?? undefined);
    const areaTitle = selected
        ? (areaId ? areas.find((area) => area.id === areaId && !area.deletedAt)?.name?.trim() || undefined : undefined)
        : project.areaTitle;
    const metadataChanged = selected && (changed || areaTitle !== project.areaTitle);
    const order = changed && !Number.isFinite(updates.order)
        ? projectAreaOrderMax(projects, areaId ?? null) + 1 : updates.order;
    return { selected, metadataChanged, fields: selected ? { areaId, areaTitle } : {}, order };
};

/** The same Area/title/order transition as RN updateProject, with one Project row only. */
export const projectAreaEffect = (project: Project, areaId: string | null,
    projects: readonly Project[], areas: readonly Area[], deviceId: string,
    now: string): PreparedProjectArea['effect'] => {
    const area = projectAreaSelection(project, { areaId: areaId ?? undefined }, projects, areas);
    const patch = { ...area.fields, ...(Number.isFinite(area.order) ? { order: area.order } : {}) };
    const transition = applyProjectLifecycleTransition(project, patch, [], [], now, deviceId);
    return { project: { before: project, after: normalizeProjectLifecycleFields({
        ...project, ...transition.projectUpdates,
        updatedAt: now, rev: nextRevision(project.rev), revBy: deviceId,
    }) } };
};

export const buildNewProject = ({
    title,
    color,
    initialProps,
    existingProjects,
    existingAreas,
    settings,
    deviceId,
    now,
    id,
}: BuildNewProjectParams): Project => {
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    const targetAreaId = initialProps?.areaId;
    const maxOrder = existingProjects
        .filter((project) => (project.areaId ?? undefined) === (targetAreaId ?? undefined))
        .reduce((max, project) => Math.max(max, Number.isFinite(project.order) ? project.order : -1), -1);
    const baseOrder = Number.isFinite(initialProps?.order) ? (initialProps?.order as number) : maxOrder + 1;
    const hasExplicitFlowMode = Boolean(
        initialProps && Object.prototype.hasOwnProperty.call(initialProps, 'isSequential')
    );
    const useSequentialDefault = !hasExplicitFlowMode
        && settings.gtd?.defaultProjectFlowMode === 'sequential';

    const baseProject: Project = {
        id: id ?? uuidv4(),
        title: trimmedTitle,
        color: color ?? DEFAULT_PROJECT_COLOR,
        order: baseOrder,
        status: 'active',
        rev: 1,
        revBy: deviceId,
        createdAt: now,
        updatedAt: now,
        // Canonical form for both is an explicit `false` (sync-normalization.ts
        // materializes them); see the same note in store-tasks.ts.
        isSequential: false,
        isFocused: false,
        ...(useSequentialDefault ? { isSequential: true } : {}),
        tagIds: [],
    };
    const project: Project = {
        ...baseProject,
        ...initialProps,
        tagIds: initialProps?.tagIds ?? [],
    };
    // Normalize the initial props as an update to the defaults, so entering a
    // non-active status at creation clears focus exactly like a later edit.
    const lifecycleProject = normalizeProjectLifecycleFields({
        ...project,
        ...normalizeProjectUpdate(baseProject, initialProps ?? {}),
    });
    // Resolved from the FINAL areaId, which initialProps may have supplied.
    const areaTitle = lifecycleProject.areaId
        ? existingAreas.find((area) => area.id === lifecycleProject.areaId && !area.deletedAt)?.name?.trim() || undefined
        : undefined;
    return areaTitle === lifecycleProject.areaTitle ? lifecycleProject : { ...lifecycleProject, areaTitle };
};

export const createProjectCoreActions = ({
    set,
    get,
    debouncedSave,
    flushPendingSave,
}: ProjectActionContext): ProjectCoreActions => ({
    addProject: async (title: string, color: string, initialProps?: Partial<Project>) => {
        const changeAt = Date.now();
        const trimmedTitle = typeof title === 'string' ? title.trim() : '';
        if (!trimmedTitle) {
            set({ error: 'Project title is required' });
            return null;
        }
        if (
            initialProps
            && Object.prototype.hasOwnProperty.call(initialProps, 'cancelledAt')
            && initialProps.cancelledAt != null
            && normalizeCancellationTimestamp(initialProps.cancelledAt) === undefined
        ) {
            set({ error: 'Cancellation timestamp must be an ISO datetime with timezone' });
            return null;
        }
        const targetAreaId = typeof initialProps?.areaId === 'string' ? initialProps.areaId : undefined;
        let createdProject: Project | null = null;
        let existingProject: Project | null = null;
        set((state) => {
            const duplicate = findSelectableProjectByTitleAndArea(state._allProjects, trimmedTitle, targetAreaId);
            if (duplicate) {
                existingProject = duplicate;
                return state;
            }
            const deviceState = ensureDeviceId(state.settings);
            const now = new Date().toISOString();
            const newProject = buildNewProject({
                title: trimmedTitle,
                color,
                initialProps,
                existingProjects: state._allProjects,
                existingAreas: state._allAreas,
                settings: state.settings,
                deviceId: deviceState.deviceId,
                now,
            });
            createdProject = newProject;
            const newAllProjects = [...state._allProjects, newProject];
            persist(set, debouncedSave, state, {
                projects: newAllProjects,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allProjects: newAllProjects,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (existingProject) {
            return existingProject;
        }
        return createdProject;
    },

    /** Apply exactly one validated native project row; never re-run title or area selection on receipt replay. */
    commitPreparedProjectCreate: async (input: PreparedProjectCreate): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict', error: 'Prepared project creation conflicts with current data' };
        set((state) => {
            const existing = state._projectsById.get(input.project.id);
            const sameRow = existing && JSON.stringify(projectToSqliteRow(existing)) === JSON.stringify(projectToSqliteRow(input.project));
            // The complete target is durable authority even if its area, order, or settings changed afterward.
            if (sameRow) {
                result = { success: true, id: input.project.id, outcome: 'replayed' };
                return state;
            }
            if (existing || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || (state.settings.gtd?.defaultProjectFlowMode ?? null) !== input.defaultProjectFlowMode) return state;
            const area = input.selectedArea;
            if (area) {
                const current = state._areasById.get(area.id);
                if (!current || current.deletedAt || current.name !== area.name
                    || (current.color ?? null) !== area.color) return state;
            }
            const max = projectAreaOrderMax(state._allProjects, area?.id ?? null);
            if (max !== input.orderMax
                || findSelectableProjectByTitleAndArea(state._allProjects, input.project.title, area?.id)) return state;
            const projects = [...state._allProjects, input.project];
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: input.project.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectFocus: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project Focus conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const planned = projectFocusEffect(current, countFocusedLiveProjects(state._allProjects), input.request.focused,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!planned || !taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectRename: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project rename conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const normalized = normalizeProjectRenameTitle(input.request.title);
            if (!normalized || normalized === current.title) return state;
            const planned = projectRenameEffect(current, normalized,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectFlow: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project flow conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            // Complete after-row receipt precedes mutable status, token, and device guards.
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const planned = projectFlowEffect(current, input.request.action,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!planned || !taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectTaskSort: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project task sort conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const planned = projectTaskSortEffect(current, input.request.sortBy,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!planned || !taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectNotesWrite: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project Notes edit conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            // A complete after-row receipt precedes mutable status, token, and device guards.
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)
                || isProjectNotesWriteNoop(current, input.request.text)) return state;
            const planned = projectNotesWriteEffect(current, input.request.text,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectTagsWrite: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project Tags edit conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            // A complete after-row receipt precedes mutable status, token, and device guards.
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const planned = projectTagsWriteEffect(current, input.request.intent,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!planned || !taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectStatus: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project status conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            // A complete after-row receipt precedes mutable status, token, and device guards.
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || current.status === input.request.status
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const planned = projectStatusEffect(current, input.request.status,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectDate: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project date conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            // A complete after-row receipt precedes mutable date, token, and device guards.
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || isProjectDateNoop(current, input.request.field, input.request.value)
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const planned = projectDateEffect(current, input.request.field, input.request.value,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    commitPreparedProjectArea: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict',
            error: 'Prepared Project Area conflicts with current data' };
        set((state) => {
            const current = state._projectsById.get(input.request.projectId);
            // The full after-row receipt precedes all mutable Project, Area and order checks.
            if (current && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && sameProjectSqliteRow(current, input.effect.project.after)) {
                result = { success: true, id: current.id, outcome: 'replayed' };
                return state;
            }
            if (!current || current.deletedAt || current.purgedAt || current.status === 'archived'
                || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)
                || !sameProjectSqliteRow(current, input.scope.project)) return state;
            const selected = input.scope.selectedArea;
            const area = selected ? state._areasById.get(selected.id) : null;
            if (selected && (!area || area.deletedAt || area.name !== selected.name)) return state;
            if (projectAreaOrderMax(state._allProjects, input.request.areaId) !== input.scope.orderMax) return state;
            if ((current.areaId ?? null) === input.request.areaId
                && (current.areaTitle ?? null) === (selected?.name.trim() || null)) return state;
            const planned = projectAreaEffect(current, input.request.areaId, state._allProjects,
                state._allAreas, input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!taskEditValuesEqual(planned, input.effect)) return state;
            const projects = replaceEntitiesInArray(state._allProjects, [planned.project.after]);
            const settings = input.deviceIdToInitialize
                ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { projects,
                ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: current.id, outcome: 'applied' };
            return { _allProjects: projects, settings,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    cancelProject: async (id: string) => {
        const project = get()._projectsById.get(id);
        if (!project || project.deletedAt || project.purgedAt) {
            const message = 'Project not found';
            set({ error: message });
            return actionFail(message);
        }
        const alreadyCancelled = isProjectCancelled(project);
        const retryingFailedCancellation = alreadyCancelled && Boolean(get().persistenceFailure);
        if (!alreadyCancelled) {
            const result = await get().updateProject(id, {
                status: 'archived',
                cancelledAt: new Date().toISOString(),
            });
            if (!result.success) return result;
        } else if (retryingFailedCancellation) {
            // A terminal flush dequeues its exhausted snapshot. The in-memory
            // cancellation still needs a fresh durable retry on the next user
            // acknowledgement attempt, without changing its revision or time.
            await get().persistSnapshot();
        }
        try {
            await flushPendingSave();
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const message = `Failed to save project cancellation: ${detail}`;
            set({ error: message });
            return actionFail(message);
        }
        if (!alreadyCancelled || retryingFailedCancellation) {
            logInfo('Commitment cancellation saved', {
                scope: 'store',
                category: 'storage',
                context: {
                    releaseCheck: 'v1.3.0/commitment-cancelled',
                    kind: 'project',
                    outcome: 'cancelled',
                    count: 1,
                },
            });
        }
        return actionOk({ id });
    },

    updateProject: async (id: string, updates: Partial<Project>) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let missingProject = false;
        let selectedAreaMetadataChanged = false;
        if (
            Object.prototype.hasOwnProperty.call(updates, 'cancelledAt')
            && updates.cancelledAt != null
            && normalizeCancellationTimestamp(updates.cancelledAt) === undefined
        ) {
            const message = 'Cancellation timestamp must be an ISO datetime with timezone';
            set({ error: message });
            return actionFail(message);
        }
        set((state) => {
            const allProjects = state._allProjects;
            const oldProject = allProjects.find(p => p.id === id);
            if (!oldProject) {
                missingProject = true;
                return state;
            }
            const deviceState = ensureDeviceId(state.settings);

            const lifecycle = applyProjectLifecycleTransition(
                oldProject,
                updates,
                state._allTasks,
                state._allSections,
                now,
                deviceState.deviceId,
            );
            const newAllTasks = lifecycle.tasks;
            const newAllSections = lifecycle.sections;
            const incomingStatus = lifecycle.projectUpdates.status ?? oldProject.status;
            const statusChanged = incomingStatus !== oldProject.status;

            let adjustedOrder = updates.order;
            // The picker supplies an own areaId key even for No Area (undefined).
            // Omission is an unrelated Project edit and must preserve area metadata.
            const area = projectAreaSelection(oldProject, updates, allProjects, state._allAreas);
            selectedAreaMetadataChanged = area.metadataChanged;
            if (Number.isFinite(area.order)) adjustedOrder = area.order;

            const finalProjectUpdates: Partial<Project> = {
                ...lifecycle.projectUpdates,
                ...area.fields,
                ...(Number.isFinite(adjustedOrder) ? { order: adjustedOrder } : {}),
                ...(statusChanged && incomingStatus !== 'active'
                    ? { isFocused: false }
                    : {}),
            };

            const newAllProjects = allProjects.map(project =>
                project.id === id
                    ? {
                        ...normalizeProjectLifecycleFields({
                            ...project,
                            ...finalProjectUpdates,
                            updatedAt: now,
                            rev: nextRevision(project.rev),
                            revBy: deviceState.deviceId,
                        }),
                    }
                    : project
            );

            persist(set, debouncedSave, state, {
                tasks: newAllTasks,
                projects: newAllProjects,
                sections: newAllSections,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allProjects: newAllProjects,
                _allTasks: newAllTasks,
                _allSections: newAllSections,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });

        if (missingProject) {
            const message = 'Project not found';
            logWarn('updateProject skipped: project not found', {
                scope: 'store',
                category: 'validation',
                context: { id },
            });
            set({ error: message });
            return actionFail(message);
        }
        if (selectedAreaMetadataChanged) {
            logInfo('Project Area selection synchronized metadata', {
                scope: 'store', category: 'storage',
                context: { releaseCheck: 'v1.3.3/rn-project-area-selection-metadata' },
            });
        }

        return actionOk();
    },

    deleteProject: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let missingProject = false;
        set((state) => {
            const target = state._allProjects.find((project) => project.id === id && !project.deletedAt);
            if (!target) {
                missingProject = true;
                return state;
            }
            const deviceState = ensureDeviceId(state.settings);
            const newAllProjects = state._allProjects.map((project) =>
                project.id === id
                    ? {
                        ...project,
                        deletedAt: now,
                        updatedAt: now,
                        rev: nextRevision(project.rev),
                        revBy: deviceState.deviceId,
                    }
                    : project
            );
            const sectionIdsForProject = new Set(
                state._allSections
                    .filter((section) => section.projectId === id)
                    .map((section) => section.id)
            );
            const newAllSections = state._allSections.map((section) =>
                sectionIdsForProject.has(section.id) && !section.deletedAt
                    ? {
                        ...section,
                        deletedAt: now,
                        updatedAt: now,
                        rev: nextRevision(section.rev),
                        revBy: deviceState.deviceId,
                    }
                    : section
            );
            const newAllTasks = state._allTasks.map(task =>
                !task.deletedAt && (task.projectId === id || (task.sectionId && sectionIdsForProject.has(task.sectionId)))
                    ? {
                        ...task,
                        projectId: undefined,
                        sectionId: undefined,
                        updatedAt: now,
                        rev: nextRevision(task.rev),
                        revBy: deviceState.deviceId,
                    }
                    : task
            );
            clearDerivedCache();
            persist(set, debouncedSave, state, {
                tasks: newAllTasks,
                projects: newAllProjects,
                sections: newAllSections,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allProjects: newAllProjects,
                _allTasks: newAllTasks,
                _allSections: newAllSections,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (missingProject) {
            const message = 'Project not found';
            logWarn('deleteProject skipped: project not found', {
                scope: 'store',
                category: 'validation',
                context: { id },
            });
            set({ error: message });
            return actionFail(message);
        }
        return actionOk();
    },

    restoreProject: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let missingProject = false;
        set((state) => {
            const target = state._allProjects.find((project) => project.id === id);
            // A purged project is the compacted tombstone of a permanent
            // delete, so it counts as missing: reviving it would turn the
            // emptied shell into a live project titled "(deleted)" and sync it
            // to every device.
            if (!target || target.purgedAt) {
                missingProject = true;
                return state;
            }
            if (!target.deletedAt) {
                return state;
            }
            const deviceState = ensureDeviceId(state.settings);
            const cascadeDeletedAt = target.deletedAt;
            const restoredArea = target.areaId
                ? state._allAreas.find((area) => area.id === target.areaId && !area.deletedAt)
                : undefined;
            const restoredProject: Project = {
                ...target,
                deletedAt: undefined,
                areaId: restoredArea ? target.areaId : undefined,
                areaTitle: restoredArea
                    ? (typeof target.areaTitle === 'string' && target.areaTitle.trim().length > 0
                        ? target.areaTitle
                        : restoredArea.name)
                    : undefined,
                updatedAt: now,
                rev: nextRevision(target.rev),
                revBy: deviceState.deviceId,
            };
            const newAllProjects = state._allProjects.map((project) =>
                project.id === id ? restoredProject : project
            );
            const newAllSections = state._allSections.map((section) => (
                section.projectId === id && section.deletedAt === cascadeDeletedAt
                    ? {
                        ...section,
                        deletedAt: undefined,
                        updatedAt: now,
                        rev: nextRevision(section.rev),
                        revBy: deviceState.deviceId,
                    }
                    : section
            ));
            const restoredSectionIds = new Set(
                newAllSections
                    .filter((section) => section.projectId === id && !section.deletedAt)
                    .map((section) => section.id)
            );
            const newAllTasks = state._allTasks.map((task) => (
                task.projectId === id && task.deletedAt === cascadeDeletedAt && !task.purgedAt
                    ? {
                        ...task,
                        deletedAt: undefined,
                        sectionId: task.sectionId && restoredSectionIds.has(task.sectionId)
                            ? task.sectionId
                            : undefined,
                        updatedAt: now,
                        rev: nextRevision(task.rev),
                        revBy: deviceState.deviceId,
                    }
                    : task
            ));
            clearDerivedCache();
            persist(set, debouncedSave, state, {
                tasks: newAllTasks,
                projects: newAllProjects,
                sections: newAllSections,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allProjects: newAllProjects,
                _allSections: newAllSections,
                _allTasks: newAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        return missingProject ? actionFail('Project not found') : actionOk();
    },

    purgeProject: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let missingProject = false;
        set((state) => {
            // Only a trashed project can be purged, the same rule purgeTasks uses.
            // Callers take their ids when a confirm dialog opens, so a sync merge can
            // restore the project before the user confirms; purging it then would
            // trash a live project and strip its live tasks in one step.
            const target = state._allProjects.find((project) => (
                project.id === id && project.deletedAt && !project.purgedAt
            ));
            if (!target) {
                missingProject = true;
                return state;
            }
            const deviceState = ensureDeviceId(state.settings);
            const sectionIdsForProject = new Set(
                state._allSections
                    .filter((section) => section.projectId === id)
                    .map((section) => section.id)
            );
            const remainingProjects = state._allProjects.filter((project) => project.id !== id);
            const pendingDeletes = collectPendingRemoteDeletesForProjects([target], remainingProjects, state._allTasks);
            const nextSettings = pendingDeletes.length > 0
                ? appendPendingRemoteDeletes(deviceState.settings, pendingDeletes)
                : deviceState.settings;
            const settingsChanged = deviceState.updated || pendingDeletes.length > 0;

            const newAllProjects = state._allProjects.map((project) =>
                project.id === id
                    ? compactPurgedProjectForLocalStorage({
                        ...project,
                        deletedAt: project.deletedAt ?? now,
                        purgedAt: now,
                        updatedAt: now,
                        rev: nextRevision(project.rev),
                        revBy: deviceState.deviceId,
                    })
                    : project
            );
            const newAllSections = state._allSections.map((section) =>
                sectionIdsForProject.has(section.id)
                    ? compactPurgedProjectSectionTombstone({
                        ...section,
                        deletedAt: now,
                        updatedAt: now,
                        rev: nextRevision(section.rev),
                        revBy: deviceState.deviceId,
                    }, now)
                    : section
            );
            const newAllTasks = state._allTasks.map(task =>
                !task.deletedAt && (task.projectId === id || (task.sectionId && sectionIdsForProject.has(task.sectionId)))
                    ? {
                        ...task,
                        projectId: undefined,
                        sectionId: undefined,
                        updatedAt: now,
                        rev: nextRevision(task.rev),
                        revBy: deviceState.deviceId,
                    }
                    : task
            );
            clearDerivedCache();
            persist(set, debouncedSave, state, {
                tasks: newAllTasks,
                projects: newAllProjects,
                sections: newAllSections,
                ...(settingsChanged ? { settings: nextSettings } : {}),
            });
            return {
                _allProjects: newAllProjects,
                _allSections: newAllSections,
                _allTasks: newAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(settingsChanged ? { settings: nextSettings } : {}),
            };
        });
        if (missingProject) {
            const message = 'Project not found';
            logWarn('purgeProject skipped: project not found', {
                scope: 'store',
                category: 'validation',
                context: { id },
            });
            set({ error: message });
            return actionFail(message);
        }
        return actionOk();
    },

    purgeDeletedProjects: async () => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        set((state) => {
            const selectedProjects = state._allProjects.filter((project) => project.deletedAt && !project.purgedAt);
            if (selectedProjects.length === 0) return state;
            const selectedIds = new Set(selectedProjects.map((project) => project.id));
            const deviceState = ensureDeviceId(state.settings);
            const sectionIdsForProjects = new Set(
                state._allSections
                    .filter((section) => selectedIds.has(section.projectId))
                    .map((section) => section.id)
            );
            const remainingProjects = state._allProjects.filter((project) => !selectedIds.has(project.id));
            const pendingDeletes = collectPendingRemoteDeletesForProjects(selectedProjects, remainingProjects, state._allTasks);
            const nextSettings = pendingDeletes.length > 0
                ? appendPendingRemoteDeletes(deviceState.settings, pendingDeletes)
                : deviceState.settings;
            const settingsChanged = deviceState.updated || pendingDeletes.length > 0;

            const newAllProjects = state._allProjects.map((project) =>
                selectedIds.has(project.id)
                    ? compactPurgedProjectForLocalStorage({
                        ...project,
                        deletedAt: project.deletedAt ?? now,
                        purgedAt: now,
                        updatedAt: now,
                        rev: nextRevision(project.rev),
                        revBy: deviceState.deviceId,
                    })
                    : project
            );
            const newAllSections = state._allSections.map((section) =>
                sectionIdsForProjects.has(section.id)
                    ? compactPurgedProjectSectionTombstone({
                        ...section,
                        deletedAt: now,
                        updatedAt: now,
                        rev: nextRevision(section.rev),
                        revBy: deviceState.deviceId,
                    }, now)
                    : section
            );
            const newAllTasks = state._allTasks.map(task =>
                !task.deletedAt && (task.projectId && selectedIds.has(task.projectId)
                    || task.sectionId && sectionIdsForProjects.has(task.sectionId))
                    ? {
                        ...task,
                        projectId: undefined,
                        sectionId: undefined,
                        updatedAt: now,
                        rev: nextRevision(task.rev),
                        revBy: deviceState.deviceId,
                    }
                    : task
            );
            clearDerivedCache();
            persist(set, debouncedSave, state, {
                tasks: newAllTasks,
                projects: newAllProjects,
                sections: newAllSections,
                ...(settingsChanged ? { settings: nextSettings } : {}),
            });
            return {
                _allProjects: newAllProjects,
                _allSections: newAllSections,
                _allTasks: newAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(settingsChanged ? { settings: nextSettings } : {}),
            };
        });
        return actionOk();
    },

    duplicateProject: async (id: string) => {
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let createdProject: Project | null = null;
        set((state) => {
            const sourceProject = state._allProjects.find((project) => project.id === id && !project.deletedAt);
            if (!sourceProject) return state;
            const deviceState = ensureDeviceId(state.settings);
            const targetAreaId = sourceProject.areaId;
            const maxOrder = state._allProjects
                .filter((project) => !project.deletedAt && (project.areaId ?? undefined) === (targetAreaId ?? undefined))
                .reduce((max, project) => Math.max(max, Number.isFinite(project.order) ? project.order : -1), -1);
            const baseOrder = maxOrder + 1;

            const projectAttachments = (sourceProject.attachments || [])
                .filter((attachment) => !attachment.deletedAt)
                .map((attachment) => duplicateProjectAttachmentCopy(attachment, now));

            const newProject: Project = {
                ...sourceProject,
                id: uuidv4(),
                title: `${sourceProject.title} (Copy)`,
                order: baseOrder,
                isFocused: false,
                cancelledAt: undefined,
                attachments: projectAttachments.length > 0 ? projectAttachments : undefined,
                createdAt: now,
                updatedAt: now,
                deletedAt: undefined,
                rev: 1,
                revBy: deviceState.deviceId,
            };
            createdProject = newProject;

            const sourceSections = state._allSections.filter(
                (section) => section.projectId === sourceProject.id && !section.deletedAt
            );
            const sectionIdMap = new Map<string, string>();
            const newSections = sourceSections.map((section) => {
                const newId = uuidv4();
                sectionIdMap.set(section.id, newId);
                return {
                    ...section,
                    id: newId,
                    projectId: newProject.id,
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: undefined,
                    rev: 1,
                    revBy: deviceState.deviceId,
                };
            });

            const sourceTasks = state._allTasks.filter(
                (task) => task.projectId === sourceProject.id && !task.deletedAt
            );
            const newTasks: Task[] = sourceTasks.map((task) => {
                const checklist = task.checklist?.map((item) => ({
                    ...item,
                    id: uuidv4(),
                    isCompleted: false,
                }));
                const attachments = (task.attachments || [])
                    .filter((attachment) => !attachment.deletedAt)
                    .map((attachment) => duplicateProjectAttachmentCopy(attachment, now));
                const nextSectionId = task.sectionId ? sectionIdMap.get(task.sectionId) : undefined;
                const newTask: Task = {
                    ...task,
                    id: uuidv4(),
                    projectId: newProject.id,
                    sectionId: nextSectionId,
                    status: (task.status === 'reference' ? 'reference' : 'next') as TaskStatus,
                    startTime: undefined,
                    dueDate: undefined,
                    reviewAt: undefined,
                    completedAt: undefined,
                    cancelledAt: undefined,
                    isFocusedToday: false,
                    pushCount: 0,
                    checklist,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: undefined,
                    purgedAt: undefined,
                    rev: 1,
                    revBy: deviceState.deviceId,
                };
                return newTask;
            });

            const newAllProjects = [...state._allProjects, newProject];
            const newAllSections = [...state._allSections, ...newSections];
            const newAllTasks = [...state._allTasks, ...newTasks];
            persist(set, debouncedSave, state, {
                tasks: newAllTasks,
                projects: newAllProjects,
                sections: newAllSections,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allProjects: newAllProjects,
                _allSections: newAllSections,
                _allTasks: newAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        return createdProject;
    },

    toggleProjectFocus: async (id: string) => {
        await mutateEntities({ set, debouncedSave }, {
            collection: 'projects',
            select: (state) => state._allProjects.filter((project) => project.id === id),
            buildUpdates: (project) => projectFocusToggleUpdate(project,
                get().getDerivedState().focusedProjectCount),
        });
    },
});
