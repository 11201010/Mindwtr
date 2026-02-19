import type { RecurrenceWeekday } from './types';

export const WEEKDAY_ORDER: RecurrenceWeekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export const WEEKDAY_BUTTONS: { key: RecurrenceWeekday; label: string }[] = [
    { key: 'SU', label: 'S' },
    { key: 'MO', label: 'M' },
    { key: 'TU', label: 'T' },
    { key: 'WE', label: 'W' },
    { key: 'TH', label: 'T' },
    { key: 'FR', label: 'F' },
    { key: 'SA', label: 'S' },
];

export const WEEKDAY_FULL_LABELS: Record<RecurrenceWeekday, string> = {
    SU: 'Sunday',
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday',
};

export const MONTHLY_WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = { ...WEEKDAY_FULL_LABELS };
