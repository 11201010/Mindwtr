import { shouldShowTaskForStart, type Task, type TaskStatus } from '@mindwtr/core';
import type { DesktopViewId } from './navigation-events';

export type TaskNavigationInput = Pick<Task, 'status' | 'startTime'> & Partial<Pick<Task, 'dueDate' | 'recurrence' | 'reviewAt'>>;

export function resolveTaskNavigationView(task: TaskNavigationInput, now: Date = new Date()): DesktopViewId {
    const statusViewMap: Record<TaskStatus, DesktopViewId> = {
        inbox: 'inbox',
        next: 'next',
        waiting: 'waiting',
        someday: 'someday',
        reference: 'reference',
        done: 'done',
        archived: 'archived',
    };
    const primaryView = statusViewMap[task.status] || 'next';
    const hidesDeferredTasks = primaryView === 'next';
    // Deferral belongs to core shouldShowTaskForStart and nowhere else. The local
    // copy this replaced read task.startTime alone, so a recurring task deferred
    // by its due date looked visible here: opening it from search or an internal
    // link navigated to Next, where it is hidden and therefore unreachable (#867).
    if (hidesDeferredTasks && !shouldShowTaskForStart(task, { now, granularity: 'time' })) {
        return 'review';
    }
    return primaryView;
}
