import { describe, it, expect } from 'vitest';
import { buildRRuleString, parseRRuleString, createNextRecurringTask } from './recurrence';
import type { Task } from './types';

describe('recurrence', () => {
    it('builds and parses weekly BYDAY rules', () => {
        const rrule = buildRRuleString('weekly', ['WE', 'MO']);
        expect(rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE');

        const parsed = parseRRuleString(rrule);
        expect(parsed.rule).toBe('weekly');
        expect(parsed.byDay).toEqual(['MO', 'WE']);
    });

    it('creates next instance using weekly BYDAY (strict)', () => {
        const task: Task = {
            id: 't1',
            title: 'Laundry',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-06T10:00:00.000Z', // Monday
            recurrence: { rule: 'weekly', byDay: ['MO', 'WE'], strategy: 'strict' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-06T12:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-01-08T10:00:00.000Z'); // Wednesday
        expect(next?.status).toBe('next');
    });

    it('uses completion date for fluid recurrence', () => {
        const task: Task = {
            id: 't2',
            title: 'Meditate',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-01T09:00:00.000Z',
            recurrence: { rule: 'daily', strategy: 'fluid' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-05T14:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-01-06T14:00:00.000Z');
    });

    it('respects daily interval for strict recurrence', () => {
        const task: Task = {
            id: 't2b',
            title: 'Water plants',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-01T09:00:00.000Z',
            recurrence: { rule: 'daily', strategy: 'strict', rrule: 'FREQ=DAILY;INTERVAL=3' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-05T14:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-01-04T09:00:00.000Z');
    });

    it('respects daily interval for fluid recurrence', () => {
        const task: Task = {
            id: 't2c',
            title: 'Stretching',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-01T09:00:00.000Z',
            recurrence: { rule: 'daily', strategy: 'fluid', rrule: 'FREQ=DAILY;INTERVAL=3' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-05T14:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-01-08T14:00:00.000Z');
    });

    it('falls back to weekly interval when BYDAY is empty', () => {
        const task: Task = {
            id: 't4',
            title: 'Weekly check-in',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-06T10:00:00.000Z', // Monday
            recurrence: { rule: 'weekly', byDay: [], strategy: 'strict' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-06T12:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-01-13T10:00:00.000Z');
    });

    it('respects weekly interval when BYDAY is provided', () => {
        const task: Task = {
            id: 't5',
            title: 'Biweekly sync',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-08T10:00:00.000Z', // Wednesday
            recurrence: { rule: 'weekly', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', strategy: 'strict' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-08T12:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-01-20T10:00:00.000Z'); // Monday two weeks later
    });

    it('advances startTime by monthly BYDAY interval when interval is greater than 1', () => {
        const task: Task = {
            id: 't5b',
            title: 'Every two months on 2nd Thursday',
            status: 'done',
            tags: [],
            contexts: [],
            startTime: '2025-01-01',
            dueDate: '2025-01-09',
            recurrence: { rule: 'monthly', rrule: 'FREQ=MONTHLY;INTERVAL=2;BYDAY=2TH', strategy: 'strict' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-09T12:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-03-13');
        expect(next?.startTime).toBe('2025-03-13');
    });

    it('uses current month for monthly BYDAY and preserves time', () => {
        const task: Task = {
            id: 't6',
            title: 'First Monday',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-01T09:00:00.000Z',
            recurrence: { rule: 'monthly', byDay: ['1MO'], strategy: 'strict' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-01T12:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-01-06T09:00:00.000Z');
    });

    it('preserves date-only format for next occurrence', () => {
        const task: Task = {
            id: 't3',
            title: 'Monthly bill',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-02-01',
            recurrence: 'monthly',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-02-01T08:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-03-01');
    });

    it('clamps monthly recurrence to the last day of the month', () => {
        const task: Task = {
            id: 't7',
            title: 'Month end report',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2025-01-31',
            recurrence: 'monthly',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2025-01-31T12:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-02-28');
    });

    it('clamps yearly recurrence for leap-day tasks', () => {
        const task: Task = {
            id: 't8',
            title: 'Leap day reminder',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2024-02-29',
            recurrence: 'yearly',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2024-02-29T12:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2025-02-28');
    });

    it('preserves local time across a DST boundary (spring forward)', () => {
        const task: Task = {
            id: 't9',
            title: 'Morning check-in',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2024-03-09T09:30',
            recurrence: 'daily',
            createdAt: '2024-03-01T00:00:00.000Z',
            updatedAt: '2024-03-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2024-03-09T10:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2024-03-10T09:30');
    });

    it('preserves local time across a DST boundary (fall back)', () => {
        const task: Task = {
            id: 't10',
            title: 'Morning check-in',
            status: 'done',
            tags: [],
            contexts: [],
            dueDate: '2024-11-02T09:30',
            recurrence: 'daily',
            createdAt: '2024-10-01T00:00:00.000Z',
            updatedAt: '2024-10-01T00:00:00.000Z',
        };

        const next = createNextRecurringTask(task, '2024-11-02T10:00:00.000Z', 'done');
        expect(next?.dueDate).toBe('2024-11-03T09:30');
    });
});
