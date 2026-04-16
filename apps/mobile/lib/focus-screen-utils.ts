import {
    getUsedTaskTokens,
    matchesHierarchicalToken,
    type Task,
    type TaskEnergyLevel,
    type TaskPriority,
    type TimeEstimate,
} from '@mindwtr/core';

export function splitFocusedTasks<T extends Pick<Task, 'isFocusedToday'>>(tasks: T[]): {
    focusedTasks: T[];
    otherTasks: T[];
} {
    const focusedTasks: T[] = [];
    const otherTasks: T[] = [];

    tasks.forEach((task) => {
        if (task.isFocusedToday) {
            focusedTasks.push(task);
            return;
        }

        otherTasks.push(task);
    });

    return { focusedTasks, otherTasks };
}

export const NO_PROJECT_FILTER_ID = '__no_project__';

export type FocusTaskFilters = {
    tokens: string[];
    projects: string[];
    priorities: TaskPriority[];
    energyLevels: TaskEnergyLevel[];
    timeEstimates: TimeEstimate[];
};

export function getFocusTokenOptions(tasks: Task[]): string[] {
    return getUsedTaskTokens(tasks, (task) => [...(task.contexts ?? []), ...(task.tags ?? [])]);
}

export function taskMatchesFocusFilters(
    task: Pick<Task, 'contexts' | 'tags' | 'projectId' | 'priority' | 'energyLevel' | 'timeEstimate'>,
    filters: FocusTaskFilters,
): boolean {
    const taskTokens = [...(task.contexts ?? []), ...(task.tags ?? [])];

    if (filters.tokens.length > 0) {
        const matchesAllTokens = filters.tokens.every((token) =>
            taskTokens.some((taskToken) => matchesHierarchicalToken(token, taskToken))
        );
        if (!matchesAllTokens) return false;
    }

    if (filters.projects.length > 0) {
        const matchesProject = filters.projects.some((selectedProjectId) => (
            selectedProjectId === NO_PROJECT_FILTER_ID
                ? !task.projectId
                : task.projectId === selectedProjectId
        ));
        if (!matchesProject) return false;
    }

    if (filters.priorities.length > 0 && (!task.priority || !filters.priorities.includes(task.priority))) {
        return false;
    }

    if (filters.energyLevels.length > 0 && (!task.energyLevel || !filters.energyLevels.includes(task.energyLevel))) {
        return false;
    }

    if (filters.timeEstimates.length > 0 && (!task.timeEstimate || !filters.timeEstimates.includes(task.timeEstimate))) {
        return false;
    }

    return true;
}

export function formatFocusTimeEstimateLabel(value: TimeEstimate): string {
    if (value === '5min') return '5m';
    if (value === '10min') return '10m';
    if (value === '15min') return '15m';
    if (value === '30min') return '30m';
    if (value === '1hr') return '1h';
    if (value === '2hr') return '2h';
    if (value === '3hr') return '3h';
    if (value === '4hr') return '4h';
    return '4h+';
}
