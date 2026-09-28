import { tFallback, type TranslateFn } from './i18n';
import type { Project, Task } from './types';

/** The status line of a React Native project row. */
export function getProjectRowStatus(project: Pick<Project, 'status' | 'cancelledAt'>, t: TranslateFn): {
    cancelled: boolean;
    statusLabel: string;
} {
    const cancelled = Boolean(project.cancelledAt);
    if (project.status === 'active') return { cancelled, statusLabel: t('status.active') };
    if (project.status === 'waiting') return { cancelled, statusLabel: t('status.waiting') };
    if (project.status === 'someday') return { cancelled, statusLabel: t('status.someday') };
    return {
        cancelled,
        statusLabel: cancelled
            ? tFallback(t, 'projects.cancelled', 'Cancelled')
            : tFallback(t, 'list.done', 'Completed'),
    };
}

export type ProjectTaskSummary = { activeTaskCount: number; nextAction?: Task; hasWaitingAction?: boolean };

/** A Waiting action gives a focused project a tracked next step too. */
export function isFocusedProjectMissingNextAction(project: Project, summary?: ProjectTaskSummary): boolean {
    return project.status === 'active' && project.isFocused === true
        && !project.deletedAt && !project.cancelledAt
        && !summary?.nextAction && !summary?.hasWaitingAction;
}
