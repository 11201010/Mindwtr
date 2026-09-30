import { describe, expect, it } from 'vitest';
import { getCalendarMonthNames, getCalendarWeekdayHeaders, resolveCalendarLocale } from './calendar-locale';

const sundayFirstReference = [
    new Date(2024, 0, 7, 12, 0, 0),
    new Date(2024, 0, 8, 12, 0, 0),
    new Date(2024, 0, 9, 12, 0, 0),
    new Date(2024, 0, 10, 12, 0, 0),
    new Date(2024, 0, 11, 12, 0, 0),
    new Date(2024, 0, 12, 12, 0, 0),
    new Date(2024, 0, 13, 12, 0, 0),
];

describe('calendar locale helpers', () => {
    it('orders weekday headers from Monday when the week starts on Monday', () => {
        expect(getCalendarWeekdayHeaders('en-US', 1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    });

    it('orders weekday headers from Saturday when the week starts on Saturday', () => {
        expect(getCalendarWeekdayHeaders('en-US', 6)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    });

    it('localizes weekday headers for the requested locale', () => {
        const formatter = new Intl.DateTimeFormat('zh-TW', { weekday: 'short' });
        const expected = sundayFirstReference.map((date) => formatter.format(date));
        expect(getCalendarWeekdayHeaders('zh-TW', 0)).toEqual(expected);
        expect(getCalendarWeekdayHeaders('zh-TW', 0)).not.toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    });

    it('localizes month names for the requested locale', () => {
        const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
        const expected = Array.from({ length: 12 }, (_, index) => formatter.format(new Date(2024, index, 1, 12, 0, 0)));
        expect(getCalendarMonthNames('fr-FR')).toEqual(expected);
    });

    it('resolves the calendar locale from app language preferences', () => {
        expect(resolveCalendarLocale({ language: 'zh-Hant', dateFormat: 'system' })).toBe('zh-Hant-TW');
        expect(resolveCalendarLocale({ language: 'en', dateFormat: 'dmy', systemLocale: 'en-US' })).toBe('en-GB');
    });
});
