import type { Project, Section, Task } from './types';
import type { TaskStore } from './store-types';
import { ensureDeviceId, createProjectOrderReserver, nextRevision } from './store-helpers';
import { compareTasksByProjectOrder } from './task-utils';
import { projectSectionOrderMax, buildNewSection, sameSectionDeleteJson } from './store-projects/section-actions';
import { generateUUID } from './uuid';
import { buildTaskMovePatch } from './task-container-rules';

type ConversionState = Pick<TaskStore, '_allProjects' | '_allSections' | '_allTasks'>;
type PreparationState = ConversionState & Pick<TaskStore, 'settings'>;

export type ProjectToSectionBlockReason =
    | 'missing-source' | 'source-inactive' | 'source-sequential' | 'source-sections'
    | 'source-attachments' | 'source-dates' | 'source-tags' | 'source-focus'
    | 'source-sort' | 'source-view-sections' | 'source-lifecycle'
    | 'same-project' | 'missing-destination' | 'destination-inactive'
    | 'destination-sequential' | 'invalid-title';

export type ProjectToSectionPreview = {
    ok: true;
    sourceTitle: string;
    destinationTitle: string;
    defaultTitle: string;
    taskCount: number;
    completedCount: number;
    archivedCount: number;
    colorWillBeLost: true;
};

type Blocked = { ok: false; reason: ProjectToSectionBlockReason };
type RowChange<T> = { before: T; after: T };

/** Frozen confirmation authority and exact retry footprint. No synced receipt field. */
export type PreparedProjectToSection = {
    sourceProjectId: string;
    destinationProjectId: string;
    sectionId: string;
    preview: ProjectToSectionPreview;
    source: RowChange<Project>;
    destination: Project;
    sourceSections: Section[];
    destinationSections: Section[];
    sourceTasks: Task[];
    destinationTasks: Task[];
    section: Section;
    tasks: RowChange<Task>[];
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    preparedAt: string;
};

export type ProjectToSectionReceipt = PreparedProjectToSection;
export type ProjectToSectionPreparation = Blocked | { ok: true;
    preview: ProjectToSectionPreview; command: PreparedProjectToSection };

/** Preserve array order, including checklist order; compare object member order independently. */
export const sameProjectToSectionValue = sameSectionDeleteJson;

const oneProject = (projects: readonly Project[], id: string): Project | undefined => {
    const matches = projects.filter((project) => project.id === id);
    return matches.length === 1 ? matches[0] : undefined;
};

export const getProjectToSectionEligibility = (state: ConversionState, sourceProjectId: string):
    { ok: true } | Blocked => {
    const source = oneProject(state._allProjects, sourceProjectId);
    if (!source) return { ok: false, reason: 'missing-source' };
    if (source.deletedAt || source.purgedAt || source.status !== 'active')
        return { ok: false, reason: 'source-inactive' };
    if (source.isSequential) return { ok: false, reason: 'source-sequential' };
    if (state._allSections.some((section) => section.projectId === source.id && !section.deletedAt))
        return { ok: false, reason: 'source-sections' };
    if (source.attachments?.some((attachment) => !attachment.deletedAt))
        return { ok: false, reason: 'source-attachments' };
    if (source.startDate || source.dueDate || source.reviewAt)
        return { ok: false, reason: 'source-dates' };
    if (source.tagIds?.length) return { ok: false, reason: 'source-tags' };
    if (source.isFocused) return { ok: false, reason: 'source-focus' };
    if (source.taskSortBy && source.taskSortBy !== 'default')
        return { ok: false, reason: 'source-sort' };
    if (source.viewSectionIds && Object.values(source.viewSectionIds).some(Boolean))
        return { ok: false, reason: 'source-view-sections' };
    if (source.archivedAt || source.cancelledAt || source.sequentialScope === 'section')
        return { ok: false, reason: 'source-lifecycle' };
    if (state._allTasks.some((task) => task.projectId === source.id && !task.deletedAt && !task.purgedAt
        && (task.projectArchivedAt || task.statusBeforeProjectArchive !== undefined
            || task.completedAtBeforeProjectArchive !== undefined
            || task.isFocusedTodayBeforeProjectArchive !== undefined)))
        return { ok: false, reason: 'source-lifecycle' };
    return { ok: true };
};

export const previewProjectToSection = (state: ConversionState, sourceProjectId: string,
    destinationProjectId: string): ProjectToSectionPreview | Blocked => {
    const eligible = getProjectToSectionEligibility(state, sourceProjectId);
    if (!eligible.ok) return eligible;
    if (sourceProjectId === destinationProjectId) return { ok: false, reason: 'same-project' };
    const source = oneProject(state._allProjects, sourceProjectId)!;
    const destination = oneProject(state._allProjects, destinationProjectId);
    if (!destination) return { ok: false, reason: 'missing-destination' };
    if (destination.deletedAt || destination.purgedAt || destination.status !== 'active'
        || destination.archivedAt || destination.cancelledAt)
        return { ok: false, reason: 'destination-inactive' };
    if (destination.isSequential) return { ok: false, reason: 'destination-sequential' };
    const tasks = state._allTasks.filter((task) => task.projectId === source.id && !task.deletedAt && !task.purgedAt);
    return { ok: true, sourceTitle: source.title, destinationTitle: destination.title,
        defaultTitle: source.title, taskCount: tasks.length,
        completedCount: tasks.filter((task) => task.status === 'done').length,
        archivedCount: tasks.filter((task) => task.status === 'archived').length,
        colorWillBeLost: true };
};

/** Deterministic planner; generated identity and clock are supplied by prepare. */
export const planProjectToSection = (state: PreparationState, sourceProjectId: string,
    destinationProjectId: string, title: string, sectionId: string, preparedAt: string,
    deviceIdBefore: string | null, deviceIdToInitialize: string | null): ProjectToSectionPreparation => {
    const preview = previewProjectToSection(state, sourceProjectId, destinationProjectId);
    if (!preview.ok) return preview;
    const sectionTitle = title.trim();
    if (!sectionTitle) return { ok: false, reason: 'invalid-title' };
    const source = oneProject(state._allProjects, sourceProjectId)!;
    const destination = oneProject(state._allProjects, destinationProjectId)!;
    const deviceId = deviceIdBefore ?? deviceIdToInitialize;
    if (!deviceId || state._allSections.some((section) => section.id === sectionId))
        return { ok: false, reason: 'invalid-title' };
    const sourceSections = state._allSections.filter((section) => section.projectId === source.id);
    const destinationSections = state._allSections.filter((section) => section.projectId === destination.id);
    const sourceTasks = state._allTasks.filter((task) => task.projectId === source.id);
    const destinationTasks = state._allTasks.filter((task) => task.projectId === destination.id);
    const liveTasks = sourceTasks.filter((task) => !task.deletedAt && !task.purgedAt)
        .sort(compareTasksByProjectOrder);
    const reserveOrder = createProjectOrderReserver(state._allTasks);
    const section = buildNewSection({ id: sectionId, projectId: destination.id, title: sectionTitle,
        initialProps: { description: source.supportNotes },
        orderMax: projectSectionOrderMax(state._allSections, destination.id), deviceId, now: preparedAt });
    const assignment = buildTaskMovePatch({ kind: 'project', id: destination.id },
        { projectId: destination.id, sectionId: section.id });
    const tasks = liveTasks.map((before) => {
        const order = reserveOrder(destination.id);
        return { before, after: { ...before, ...assignment, order, orderNum: order,
            updatedAt: preparedAt, rev: nextRevision(before.rev), revBy: deviceId } };
    });
    const command: PreparedProjectToSection = {
        sourceProjectId: source.id, destinationProjectId: destination.id, sectionId: section.id,
        preview, source: { before: source, after: { ...source, deletedAt: preparedAt,
            updatedAt: preparedAt, rev: nextRevision(source.rev), revBy: deviceId } },
        destination, sourceSections, destinationSections, sourceTasks, destinationTasks,
        section, tasks, deviceIdBefore, deviceIdToInitialize, preparedAt,
    };
    // A prepared dialog can outlive a store update; never retain mutable store row references.
    return { ok: true, preview, command: JSON.parse(JSON.stringify(command)) as PreparedProjectToSection };
};

export const prepareProjectToSection = (state: PreparationState, sourceProjectId: string,
    destinationProjectId: string, title: string): ProjectToSectionPreparation => {
    const device = ensureDeviceId(state.settings);
    return planProjectToSection(state, sourceProjectId, destinationProjectId, title,
        generateUUID(), new Date().toISOString(), state.settings.deviceId ?? null,
        device.updated ? device.deviceId : null);
};
