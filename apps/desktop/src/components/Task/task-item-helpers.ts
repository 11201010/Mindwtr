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

export function normalizeDateInputValue(value: string, now: Date = new Date()): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match) return trimmed;

    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    const nowDay = now.getDate();

    let year = Number(match[1]);
    let month = Number(match[2]);
    let day = Number(match[3]);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return trimmed;
    }

    if (year === 0) year = nowYear;
    if (month === 0) month = nowMonth;
    if (day === 0) day = nowDay;

    if (month < 1 || month > 12) return trimmed;

    const maxDay = new Date(year, month, 0).getDate();
    if (day < 1) day = 1;
    if (day > maxDay) day = maxDay;

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
