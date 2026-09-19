import { useTaskStore, type Task } from '@mindwtr/core';

import { useUiStore } from '../store/ui-store';
import { dispatchNavigateEvent, type DesktopViewId } from './navigation-events';
import { resolveTaskNavigationView, type TaskNavigationInput } from './task-navigation';

/** The list that shows a task: its project first, otherwise the shared navigation rule. */
export function resolveViewForTask(task: TaskNavigationInput & Pick<Task, 'projectId'>): DesktopViewId {
    if (task.projectId) return 'projects';
    return resolveTaskNavigationView(task);
}

function navigateToTaskView(task: Task, view: DesktopViewId): void {
    useTaskStore.getState().setHighlightTask(task.id);
    if (view === 'projects' && task.projectId) {
        useUiStore.getState().setProjectView({ selectedProjectId: task.projectId });
    }
    dispatchNavigateEvent(view);
}

/**
 * "Save & edit" opens the new capture's editor in the list it belongs to, which
 * is almost always Inbox. If that edit files it somewhere else (a status change,
 * a project), the user was left looking at an Inbox the task had already left
 * (#1243). Watch the editing session and, once it ends, follow the task to the
 * view it now lives in. A cancelled edit, a deletion, or a task that stayed put
 * moves nothing. Returns the unsubscribe function.
 */
export function followCreatedTaskAfterEdit(taskId: string, openedIn: DesktopViewId): () => void {
    const unsubscribe = useUiStore.subscribe((state, previous) => {
        if (previous.editingTaskId !== taskId || state.editingTaskId === taskId) return;
        unsubscribe();
        const task = useTaskStore.getState()._allTasks.find((candidate) => candidate.id === taskId);
        if (!task || task.deletedAt) return;
        const view = resolveViewForTask(task);
        if (view === openedIn) return;
        navigateToTaskView(task, view);
    });
    return unsubscribe;
}
