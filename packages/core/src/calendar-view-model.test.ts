import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createCalendarRecorder,
    loadCalendarViewsFixture,
    projectCalendarObservations,
    replayCalendarScenario,
    seedCalendarStore,
} from './calendar-view-model.replay';
import {
    compactHourLabel,
    getCalendarMonthCell,
    indexCalendarScheduledTasks,
    calendarDateKey,
    isAllDayScheduledTask,
    isTimedScheduledTask,
    moveCalendarPeriod,
    getCalendarVisibleRange,
    getCalendarWeekStart,
} from './calendar-view-model';
import { configureDateFormatting } from './date';
import { createNativeHostContract } from './native-host-contract';
import { resetForTests } from './store';
import type { Task } from './types';

const fixture = loadCalendarViewsFixture();

describe('calendar views parity with the frozen React Native fixture', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
        process.env.TZ = fixture.timeZone;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
    });
    afterAll(() => {
        vi.useRealTimers();
        configureDateFormatting();
        resetForTests();
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });

    it('was captured from React Native before the screen changed', () => {
        expect(fixture.provenance.capturedAt).toMatch(/^[0-9a-f]{40}$/);
        expect(fixture.scenarios.length).toBe(Object.keys(fixture.observations).length);
    });

    for (const scenario of fixture.scenarios) {
        it(`the native host contract reproduces "${scenario.name}"`, async () => {
            const recorder = createCalendarRecorder();
            await seedCalendarStore(fixture, scenario, recorder);
            const contract = createNativeHostContract();
            expect((await contract.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale })).ok).toBe(true);
            expect((await contract.activate({ writeSafetyReady: true })).ok).toBe(true);
            recorder.log.splice(0);
            const observed = await replayCalendarScenario({ fixture, scenario, recorder, contract });
            const initial = fixture.settings[scenario.settings].calendar;
            expect(projectCalendarObservations(observed.map((entry) => ({ ...entry, styles: null })), initial))
                .toEqual(projectCalendarObservations(fixture.observations[scenario.name], initial));
        });
    }
});

const task = (overrides: Partial<Task>): Task => ({
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Task',
    status: overrides.status ?? 'next',
    contexts: [],
    tags: [],
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
});

describe('calendar view model', () => {
    it('indexes date-only start dates on their local calendar day', () => {
        const dateOnly = task({ id: 'date-only', startTime: '2026-04-20' });
        const timed = task({ id: 'timed', startTime: '2026-04-20T09:00:00' });
        const grouped = indexCalendarScheduledTasks([dateOnly, timed]);
        expect(grouped.get(calendarDateKey(new Date(2026, 3, 20)))?.map((item) => item.id)).toEqual(['date-only', 'timed']);
        expect(isAllDayScheduledTask(dateOnly)).toBe(true);
        expect(isTimedScheduledTask(dateOnly)).toBe(false);
        expect(isTimedScheduledTask(timed)).toBe(true);
    });

    it('drops the empty minutes of an hour label only when a meridiem keeps it long', () => {
        expect(compactHourLabel('10:00 AM')).toBe('10 AM');
        expect(compactHourLabel('12:00 PM')).toBe('12 PM');
        expect(compactHourLabel('10.00 a.m.')).toBe('10 a.m.');
        expect(compactHourLabel('午前10:00')).toBe('午前10');
        expect(compactHourLabel('13:00')).toBe('13:00');
    });

    it('moves a week across the daylight-saving change and the year by calendar days', () => {
        const originalTz = process.env.TZ;
        process.env.TZ = 'America/New_York';
        try {
            const week = { viewMode: 'week' as const, selectedDate: new Date(2026, 9, 28), visibleMonthDate: new Date(2026, 9, 28) };
            const next = moveCalendarPeriod(week, 'next', { calendarSystem: 'gregorian' });
            expect(next.selectedDate?.getDate()).toBe(4);
            expect(next.selectedDate?.getHours()).toBe(0);
            const start = getCalendarWeekStart(next.selectedDate!, 0);
            const range = getCalendarVisibleRange({ calendarSystem: 'gregorian', currentMonthDate: new Date(2026, 10, 1), selectedDate: next.selectedDate, viewMode: 'week', weekStartTime: start.getTime() });
            // Nov 1 starts in daylight time (UTC-4) and the week ends in standard time (UTC-5).
            expect([range.rangeStart.toISOString(), range.rangeEnd.toISOString()]).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-08T04:59:59.999Z']);
            const day = moveCalendarPeriod({ viewMode: 'day', selectedDate: new Date(2026, 11, 31), visibleMonthDate: new Date(2026, 11, 31) }, 'next', { calendarSystem: 'gregorian' });
            expect([day.selectedDate?.getFullYear(), day.visibleMonthDate.getMonth()]).toEqual([2027, 0]);
            const month = moveCalendarPeriod({ viewMode: 'month', selectedDate: null, visibleMonthDate: new Date(2026, 11, 15) }, 'next', { calendarSystem: 'gregorian' });
            expect([month.visibleMonthDate.getFullYear(), month.visibleMonthDate.getMonth(), month.visibleMonthDate.getDate(), month.selectedDate]).toEqual([2027, 0, 1, null]);
        } finally {
            if (originalTz === undefined) delete process.env.TZ;
            else process.env.TZ = originalTz;
        }
    });

    it('hides a month cell\'s previews from six items on and shows its counts', () => {
        const tasks = Array.from({ length: 6 }, (_, index) => task({ id: `t${index}`, title: `T${index}`, dueDate: '2026-10-30' }));
        const lists = { scheduled: [], deadlines: tasks, completed: [], events: [] };
        const cell = getCalendarMonthCell(new Date(2026, 9, 30), lists, { locale: 'en-US', t: (key) => (key === 'common.tasks' ? 'tasks' : key) });
        expect(cell.previewItems).toEqual([]);
        expect(cell).toMatchObject({ showCounts: true, taskCount: 6, eventCount: 0, accessibilityLabel: 'Friday, October 30. 6 tasks' });
        const two = getCalendarMonthCell(new Date(2026, 9, 30), { ...lists, deadlines: tasks.slice(0, 2) }, { locale: 'en-US', t: (key) => key });
        expect([two.previewItems.length, two.showCounts]).toEqual([2, false]);
    });
});
