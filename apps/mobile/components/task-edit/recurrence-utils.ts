import {
    Task,
    RecurrenceRule,
    type RecurrenceStrategy,
    type RecurrenceWeekday,
    buildRRuleString,
    parseRRuleString,
    WEEKDAY_ORDER,
    WEEKDAY_BUTTONS,
    MONTHLY_WEEKDAY_LABELS,
} from '@mindwtr/core';

export const MAX_SUGGESTED_TAGS = 8;
export const MAX_VISIBLE_SUGGESTIONS = 4;
export { WEEKDAY_ORDER, WEEKDAY_BUTTONS, MONTHLY_WEEKDAY_LABELS };

export const getRecurrenceRuleValue = (recurrence: Task['recurrence']): RecurrenceRule | '' => {
    if (!recurrence) return '';
    if (typeof recurrence === 'string') return recurrence as RecurrenceRule;
    return recurrence.rule;
};

export const getRecurrenceStrategyValue = (recurrence: Task['recurrence']): RecurrenceStrategy => {
    if (recurrence && typeof recurrence === 'object' && recurrence.strategy === 'fluid') {
        return 'fluid';
    }
    return 'strict';
};

export const buildRecurrenceValue = (
    rule: RecurrenceRule | '',
    strategy: RecurrenceStrategy
): Task['recurrence'] | undefined => {
    if (!rule) return undefined;
    return { rule, strategy };
};

export const getRecurrenceByDayValue = (recurrence: Task['recurrence']): RecurrenceWeekday[] => {
    if (!recurrence || typeof recurrence === 'string') return [];
    if (recurrence.byDay?.length) {
        return recurrence.byDay.filter((day) => WEEKDAY_ORDER.includes(day as RecurrenceWeekday)) as RecurrenceWeekday[];
    }
    if (recurrence.rrule) {
        const parsed = parseRRuleString(recurrence.rrule);
        return (parsed.byDay || []).filter((day) => WEEKDAY_ORDER.includes(day as RecurrenceWeekday)) as RecurrenceWeekday[];
    }
    return [];
};

export const getRecurrenceRRuleValue = (recurrence: Task['recurrence']): string => {
    if (!recurrence || typeof recurrence === 'string') return '';
    if (recurrence.rrule) return recurrence.rrule;
    if (recurrence.byDay?.length) return buildRRuleString(recurrence.rule, recurrence.byDay);
    return buildRRuleString(recurrence.rule);
};
