import { addDays, addMonths, addWeeks, addYears, format } from 'date-fns';

import { safeParseDate } from './date';
import { generateUUID as uuidv4 } from './uuid';
import type { Task, TaskStatus, ChecklistItem } from './types';

export type RecurrenceRule = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCE_RULES: RecurrenceRule[] = ['daily', 'weekly', 'monthly', 'yearly'];

export function isRecurrenceRule(value: string | undefined | null): value is RecurrenceRule {
    return !!value && (RECURRENCE_RULES as readonly string[]).includes(value);
}

function addInterval(base: Date, rule: RecurrenceRule): Date {
    switch (rule) {
        case 'daily':
            return addDays(base, 1);
        case 'weekly':
            return addWeeks(base, 1);
        case 'monthly':
            return addMonths(base, 1);
        case 'yearly':
            return addYears(base, 1);
    }
}

function nextIsoFrom(baseIso: string | undefined, rule: RecurrenceRule, fallbackBase: Date): string | undefined {
    const parsed = safeParseDate(baseIso);
    const base = parsed || fallbackBase;
    const nextDate = addInterval(base, rule);

    // Preserve existing storage format:
    // - If base has timezone/offset, keep ISO (Z/offset).
    // - Otherwise, return local datetime-local compatible string.
    const hasTimezone = !!baseIso && /Z$|[+-]\d{2}:?\d{2}$/.test(baseIso);
    return hasTimezone ? nextDate.toISOString() : format(nextDate, "yyyy-MM-dd'T'HH:mm");
}

function resetChecklist(checklist: ChecklistItem[] | undefined): ChecklistItem[] | undefined {
    if (!checklist || checklist.length === 0) return undefined;
    return checklist.map((item) => ({
        ...item,
        id: uuidv4(),
        isCompleted: false,
    }));
}

/**
 * Create the next instance of a recurring task.
 *
 * - Uses task.dueDate as the base if present/valid, else completion time.
 * - Shifts startTime/reviewAt forward if present.
 * - Resets checklist completion and IDs.
 * - New instance status is based on the previous status, with done -> next.
 */
export function createNextRecurringTask(
    task: Task,
    completedAtIso: string,
    previousStatus: TaskStatus
): Task | null {
    if (!isRecurrenceRule(task.recurrence)) return null;

    const rule = task.recurrence;
    const completedAtDate = safeParseDate(completedAtIso) || new Date(completedAtIso);

    const nextDueDate = nextIsoFrom(task.dueDate, rule, completedAtDate);
    const nextStartTime = task.startTime ? nextIsoFrom(task.startTime, rule, completedAtDate) : undefined;
    const nextReviewAt = task.reviewAt ? nextIsoFrom(task.reviewAt, rule, completedAtDate) : undefined;

    let newStatus: TaskStatus = previousStatus;
    if (newStatus === 'done') {
        newStatus = 'next';
    }

    return {
        id: uuidv4(),
        title: task.title,
        status: newStatus,
        startTime: nextStartTime,
        dueDate: nextDueDate,
        recurrence: task.recurrence,
        tags: [...(task.tags || [])],
        contexts: [...(task.contexts || [])],
        checklist: resetChecklist(task.checklist),
        description: task.description,
        location: task.location,
        projectId: task.projectId,
        isFocusedToday: false,
        timeEstimate: task.timeEstimate,
        reviewAt: nextReviewAt,
        createdAt: completedAtIso,
        updatedAt: completedAtIso,
    };
}
