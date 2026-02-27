import { safeParseDate, type Task } from '@mindwtr/core';

function getCompletionTime(task: Task): number {
    const completedAt = safeParseDate(task.completedAt)?.getTime();
    if (Number.isFinite(completedAt)) return completedAt as number;
    const updatedAt = safeParseDate(task.updatedAt)?.getTime();
    if (Number.isFinite(updatedAt)) return updatedAt as number;
    return safeParseDate(task.createdAt)?.getTime() ?? 0;
}

export function sortDoneTasksForListView(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const completionDiff = getCompletionTime(b) - getCompletionTime(a);
        if (completionDiff !== 0) return completionDiff;
        return a.title.localeCompare(b.title);
    });
}
