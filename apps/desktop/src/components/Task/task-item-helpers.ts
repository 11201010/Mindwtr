import {
    Task,
    TaskEditorFieldId,
    type Recurrence,
    type RecurrenceRule,
    type RecurrenceStrategy,
    buildRRuleString,
    hasTimeComponent,
    safeFormatDate,
    safeParseDate,
} from '@mindwtr/core';

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

export const DEFAULT_TASK_EDITOR_HIDDEN: TaskEditorFieldId[] = [
    'priority',
    'tags',
    'timeEstimate',
    'recurrence',
    'startTime',
    'reviewAt',
    'attachments',
];

// Convert stored ISO or datetime-local strings into datetime-local input values.
export function toDateTimeLocalValue(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const parsed = safeParseDate(dateStr);
    if (!parsed) return dateStr;
    if (!hasTimeComponent(dateStr)) {
        return safeFormatDate(parsed, 'yyyy-MM-dd', dateStr);
    }
    return safeFormatDate(parsed, "yyyy-MM-dd'T'HH:mm", dateStr);
}

export function getRecurrenceRuleValue(recurrence: Task['recurrence']): RecurrenceRule | '' {
    if (!recurrence) return '';
    if (typeof recurrence === 'string') return recurrence as RecurrenceRule;
    return recurrence.rule || '';
}

export function getRecurrenceStrategyValue(recurrence: Task['recurrence']): RecurrenceStrategy {
    if (recurrence && typeof recurrence === 'object' && recurrence.strategy === 'fluid') {
        return 'fluid';
    }
    return 'strict';
}

export function getRecurrenceRRuleValue(recurrence: Task['recurrence']): string {
    if (!recurrence || typeof recurrence === 'string') return '';
    const rec = recurrence as Recurrence;
    if (rec.rrule) return rec.rrule;
    if (rec.byDay && rec.byDay.length > 0) return buildRRuleString(rec.rule, rec.byDay);
    return rec.rule ? buildRRuleString(rec.rule) : '';
}
