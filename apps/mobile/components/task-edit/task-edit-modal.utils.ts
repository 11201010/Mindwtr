import { Dimensions } from 'react-native';
import { type AppData, type TaskEditorFieldId, type TaskEditorSectionId, type TaskStatus } from '@mindwtr/core';
import { logError, logWarn } from '../../lib/app-log';

export const STATUS_OPTIONS: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done'];
const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error));
const buildTaskExtra = (message?: string, error?: unknown): Record<string, string> | undefined => {
    const extra: Record<string, string> = {};
    if (message) extra.message = message;
    if (error) extra.error = formatError(error);
    return Object.keys(extra).length ? extra : undefined;
};

export const logTaskWarn = (message: string, error?: unknown) => {
    void logWarn(message, { scope: 'task', extra: buildTaskExtra(undefined, error) });
};

export const logTaskError = (message: string, error?: unknown) => {
    const err = error instanceof Error ? error : new Error(message);
    void logError(err, { scope: 'task', extra: buildTaskExtra(message, error) });
};

export const isReleasedAudioPlayerError = (error: unknown): boolean => {
    const message = formatError(error).toLowerCase();
    return (
        message.includes('already released')
        || message.includes('cannot use shared object')
        || message.includes('cannot be cast to type expo.modules.audio.audioplayer')
    );
};

export const isValidLinkUri = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return parsed.protocol.length > 0;
    } catch {
        return false;
    }
};

export const QUICK_TOKEN_LIMIT = 6;

export const getInitialWindowWidth = (): number => {
    const width = Dimensions?.get?.('window')?.width;
    return Number.isFinite(width) && width > 0 ? Math.round(width) : 1;
};

export const getTaskEditTabOffset = (mode: 'task' | 'view', containerWidth: number): number =>
    mode === 'task' ? 0 : containerWidth;

type ScrollValueLike = {
    setValue?: (value: number) => void;
};

type ScrollNodeLike = {
    scrollTo?: (options: { x: number; animated?: boolean }) => void;
    getNode?: () => ScrollNodeLike | null | undefined;
} | null | undefined;

export const syncTaskEditPagerPosition = ({
    mode,
    containerWidth,
    scrollValue,
    scrollNode,
    animated = true,
}: {
    mode: 'task' | 'view';
    containerWidth: number;
    scrollValue?: ScrollValueLike | null;
    scrollNode?: ScrollNodeLike;
    animated?: boolean;
}): void => {
    if (!containerWidth) return;
    const x = getTaskEditTabOffset(mode, containerWidth);
    scrollValue?.setValue?.(x);
    if (scrollNode?.scrollTo) {
        scrollNode.scrollTo({ x, animated });
        return;
    }
    scrollNode?.getNode?.()?.scrollTo?.({ x, animated });
};

export const DEFAULT_TASK_EDITOR_ORDER: TaskEditorFieldId[] = [
    'status',
    'project',
    'section',
    'area',
    'priority',
    'contexts',
    'description',
    'tags',
    'timeEstimate',
    'recurrence',
    'startTime',
    'dueDate',
    'reviewAt',
    'attachments',
    'checklist',
];

export const DEFAULT_TASK_EDITOR_VISIBLE: TaskEditorFieldId[] = [
    'status',
    'project',
    'section',
    'area',
    'description',
    'checklist',
    'contexts',
    'dueDate',
    'priority',
    'timeEstimate',
];

export const TASK_EDITOR_FIXED_FIELDS: TaskEditorFieldId[] = ['status', 'project', 'section', 'area'];

export const TASK_EDITOR_SECTION_ORDER: TaskEditorSectionId[] = ['basic', 'scheduling', 'organization', 'details'];

export const DEFAULT_TASK_EDITOR_SECTION_BY_FIELD: Record<TaskEditorFieldId, TaskEditorSectionId> = {
    status: 'basic',
    project: 'basic',
    section: 'basic',
    area: 'basic',
    priority: 'organization',
    contexts: 'organization',
    tags: 'organization',
    timeEstimate: 'organization',
    recurrence: 'scheduling',
    startTime: 'scheduling',
    dueDate: 'basic',
    reviewAt: 'scheduling',
    description: 'details',
    textDirection: 'details',
    attachments: 'details',
    checklist: 'details',
};

export const TASK_EDITOR_SECTIONABLE_FIELDS: TaskEditorFieldId[] = DEFAULT_TASK_EDITOR_ORDER.filter(
    (fieldId) => !TASK_EDITOR_FIXED_FIELDS.includes(fieldId) && fieldId !== 'textDirection'
);

export const DEFAULT_TASK_EDITOR_SECTION_OPEN: Record<TaskEditorSectionId, boolean> = {
    basic: true,
    scheduling: false,
    organization: false,
    details: true,
};

type TaskEditorSettings = NonNullable<NonNullable<AppData['settings']['gtd']>['taskEditor']> | undefined;

const isTaskEditorSectionId = (value: unknown): value is TaskEditorSectionId =>
    value === 'basic' || value === 'scheduling' || value === 'organization' || value === 'details';

export const isTaskEditorSectionableField = (fieldId: TaskEditorFieldId): boolean =>
    TASK_EDITOR_SECTIONABLE_FIELDS.includes(fieldId);

export const getTaskEditorSectionAssignments = (
    taskEditor: TaskEditorSettings
): Record<TaskEditorFieldId, TaskEditorSectionId> => {
    const savedSections = taskEditor?.sections ?? {};
    const next = { ...DEFAULT_TASK_EDITOR_SECTION_BY_FIELD };
    (Object.keys(savedSections) as TaskEditorFieldId[]).forEach((fieldId) => {
        const sectionId = savedSections[fieldId];
        if (!isTaskEditorSectionableField(fieldId) || !isTaskEditorSectionId(sectionId)) return;
        next[fieldId] = sectionId;
    });
    return next;
};

export const getTaskEditorSectionOpenDefaults = (
    taskEditor: TaskEditorSettings
): Record<TaskEditorSectionId, boolean> => {
    const savedSectionOpen = taskEditor?.sectionOpen ?? {};
    return {
        basic: DEFAULT_TASK_EDITOR_SECTION_OPEN.basic,
        scheduling: typeof savedSectionOpen.scheduling === 'boolean'
            ? savedSectionOpen.scheduling
            : DEFAULT_TASK_EDITOR_SECTION_OPEN.scheduling,
        organization: typeof savedSectionOpen.organization === 'boolean'
            ? savedSectionOpen.organization
            : DEFAULT_TASK_EDITOR_SECTION_OPEN.organization,
        details: typeof savedSectionOpen.details === 'boolean'
            ? savedSectionOpen.details
            : DEFAULT_TASK_EDITOR_SECTION_OPEN.details,
    };
};
