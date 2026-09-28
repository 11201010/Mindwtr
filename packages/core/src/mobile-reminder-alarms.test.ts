import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTranslations } from './i18n/i18n-loader';
import {
    buildReminderAlarmSignature,
    buildReminderSnooze,
    cancelReminderAlarm,
    cancelUnrequestedReminderAlarms,
    getMaxPendingOneShotReminderAlarms,
    isPomodoroAlarmScheduleSuperseded,
    isPomodoroAlarmUnchanged,
    isPomodoroNativeAlarm,
    planReminderAlarms,
    readPomodoroAlarmEntry,
    readReminderAlarmMap,
    scheduleReminderAlarms,
    shouldRemoveFiredPomodoroAlarm,
    shouldRescheduleReminderAlarms,
    writeReminderAlarmMap,
    type ReminderAlarmEntry,
    type ReminderAlarmPlanInput,
    type ReminderAlarmPort,
} from './mobile-reminder-alarms';
import type { NotificationSettings, Project, Task } from './types';

type Answer = { id: number | string } | { reject: string };
type Cycle = {
    now: string;
    platform?: string;
    trigger?: 'start' | 'exact';
    settings: NotificationSettings;
    tasks: Task[];
    projects?: Project[];
    answers?: Answer[];
};
type Fixture = {
    scenarios: { name: string; storedAlarms?: string; cycles: Cycle[] }[];
    observations: Record<string, { calls: unknown[][]; alarms: Record<string, ReminderAlarmEntry>; error: string | null }[]>;
};

const fixture = JSON.parse(readFileSync(new URL('./reminder-alarms-parity.fixtures.json', import.meta.url), 'utf8')) as Fixture;
const ALARM_MAP_KEY = 'mindwtr:local:alarms:v1';
const LIBRARY_CALLS = new Set(['scheduleAlarm', 'deleteAlarm', 'deleteRepeatingAlarm', 'removeFiredNotification']);
// The log lines the applier writes; the rest of a cycle's log stays React Native's.
const APPLIER_LOG = /^\[Local Notifications\] (Alarm scheduled|Alarm canceled|Failed to delete alarm|Scheduled alarm returned invalid id|Failed to schedule alarm)/;

/** React Native's alarm library as the fixture scripted it, recording calls the way the harness did. */
function recordingPort(answers: Answer[], ids: { next: number }) {
    const calls: unknown[][] = [];
    const port: ReminderAlarmPort = {
        parseDate: (date) => date.toISOString(),
        scheduleAlarm: async (details) => {
            calls.push(['scheduleAlarm', JSON.parse(JSON.stringify(details))]);
            const answer = answers.shift() ?? { id: ids.next++ };
            if ('reject' in answer) throw new Error(answer.reject);
            return { id: answer.id };
        },
        deleteAlarm: (id) => { calls.push(['deleteAlarm', id]); },
        deleteRepeatingAlarm: (id) => { calls.push(['deleteRepeatingAlarm', id]); },
        removeFiredNotification: (id) => { calls.push(['removeFiredNotification', id]); },
        logInfo: (message, extra) => { calls.push(['logInfo', `[Local Notifications] ${message}`, extra ?? null]); },
        logError: (message, error) => {
            calls.push(['logWarn', `[Local Notifications] ${message}`, error ? { error: error instanceof Error ? error.message : String(error) } : null]);
        },
    };
    return { port, calls };
}

describe('mobile reminder alarms', () => {
    const originalTz = process.env.TZ;
    let english: Record<string, string> = {};
    beforeAll(async () => {
        process.env.TZ = 'UTC';
        english = await loadTranslations('en');
    });
    afterAll(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });

    it('replays React Native\'s frozen reconciliation cycles: the same library calls, alarm map, saves and top-up', async () => {
        for (const scenario of fixture.scenarios) {
            const alarms = (() => {
                try {
                    return readReminderAlarmMap(scenario.storedAlarms ?? null);
                } catch {
                    return new Map<string, ReminderAlarmEntry>();
                }
            })();
            const ids = { next: 100 };
            let lastSaved: string | null = null;
            for (const [index, cycle] of scenario.cycles.entries()) {
                const observed = fixture.observations[scenario.name][index];
                const { port, calls } = recordingPort([...(cycle.answers ?? [])], ids);
                const timers: number[] = [];
                let error: string | null = null;
                if (cycle.trigger === 'exact') {
                    for (const key of Array.from(alarms.keys())) await cancelReminderAlarm(alarms, key, port);
                }
                const plan = planReminderAlarms({
                    settings: cycle.settings,
                    tasks: cycle.tasks,
                    projects: cycle.projects ?? [],
                    now: new Date(cycle.now),
                    translations: english,
                    maxOneShotReminders: getMaxPendingOneShotReminderAlarms(cycle.platform ?? 'android'),
                    alarms,
                });
                try {
                    if (plan.mode === 'active') {
                        await scheduleReminderAlarms(plan, alarms, port);
                        if (plan.topUpDelayMs !== null) timers.push(plan.topUpDelayMs);
                    }
                    await cancelUnrequestedReminderAlarms(plan, alarms, port);
                } catch (caught) {
                    error = caught instanceof Error ? caught.message : String(caught);
                }
                const saved = writeReminderAlarmMap(alarms);
                const saves = saved === lastSaved ? [] : [saved];
                lastSaved = saved;

                const where = `${scenario.name} #${index}`;
                expect({ where, calls }).toEqual({
                    where,
                    calls: observed.calls.filter(([kind, message]) => LIBRARY_CALLS.has(kind as string)
                        || ((kind === 'logInfo' || kind === 'logWarn') && APPLIER_LOG.test(message as string))),
                });
                expect({ where, alarms: JSON.parse(JSON.stringify(Object.fromEntries(alarms))) }).toEqual({ where, alarms: observed.alarms });
                expect({ where, error }).toEqual({ where, error: observed.error });
                expect({ where, saves }).toEqual({
                    where,
                    saves: observed.calls.filter(([kind, key]) => kind === 'setItem' && key === ALARM_MAP_KEY).map((call) => call[2]),
                });
                expect({ where, timers }).toEqual({ where, timers: observed.calls.filter(([kind]) => kind === 'setTimeout').map((call) => call[1]) });
            }
        }
    });

    const NOW = new Date('2026-09-28T10:00:00.000Z');
    const task = (id: string, fields: Partial<Task> = {}): Task => ({
        id, title: `Task ${id}`, status: 'next', tags: [], contexts: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...fields,
    });
    const plan = (fields: Partial<ReminderAlarmPlanInput> = {}) => planReminderAlarms({
        settings: {}, tasks: [], projects: [], now: NOW, translations: english, maxOneShotReminders: 200, alarms: new Map(), ...fields,
    });

    it('never schedules a date-only start or due date', () => {
        const result = plan({ tasks: [task('a', { dueDate: '2026-09-29' }), task('b', { startTime: '2026-09-30' })] });
        expect(result).toMatchObject({ mode: 'active', recurring: [], oneShot: [], schedule: [], topUpDelayMs: null });
        expect(result.diagnostics).toMatchObject({ dateOnlyDueDateCount: 1, dateOnlyStartTimeCount: 1 });
    });

    it('cancels every held alarm without notification permission, and when no reminder feature is on', () => {
        const alarms = new Map<string, ReminderAlarmEntry>([['digest:morning', { id: 1, signature: 's' }], ['task:a', { id: 2 }]]);
        const tasks = [task('a', { dueDate: '2026-09-28T11:00:00.000Z' })];
        expect(plan({ alarms, tasks, settings: { dailyDigestMorningEnabled: true }, permissionGranted: false }))
            .toMatchObject({ mode: 'revoked', cancel: ['digest:morning', 'task:a'], schedule: [], keep: [], diagnostics: null });
        expect(plan({ alarms, tasks, settings: { notificationsEnabled: false } }))
            .toMatchObject({ mode: 'inactive', cancel: ['digest:morning', 'task:a'], schedule: [], keep: [] });
    });

    it('keeps a matching alarm, remakes a changed or pending one, and cancels one no longer requested', () => {
        const tasks = [task('same', { dueDate: '2026-09-28T11:00:00.000Z' }), task('moved', { dueDate: '2026-09-28T12:00:00.000Z' }), task('pending', { dueDate: '2026-09-28T13:00:00.000Z' })];
        const first = plan({ tasks });
        const signature = (key: string) => first.oneShot.find((request) => request.key === key)!.signature;
        const alarms = new Map<string, ReminderAlarmEntry>([
            ['task:same', { id: 1, signature: signature('task:same') }],
            ['task:moved', { id: 2, signature: 'before the move' }],
            ['task:pending', { id: 3, signature: signature('task:pending'), pending: true }],
            ['task:gone', { id: 4, signature: 'x' }],
        ]);
        expect(plan({ tasks, alarms })).toMatchObject({ keep: ['task:same'], schedule: ['task:moved', 'task:pending'], cancel: ['task:gone'] });
    });

    it('caps one-shots soonest first and tops up 5 s after the soonest fires', () => {
        const tasks = Array.from({ length: 5 }, (_, index) => task(`t${index}`, { dueDate: new Date(NOW.getTime() + (index + 1) * 60_000).toISOString() }));
        const result = plan({ tasks: [...tasks].reverse(), maxOneShotReminders: 3 });
        expect(result.oneShot.map((request) => request.key)).toEqual(['task:t0', 'task:t1', 'task:t2']);
        expect(result.topUpDelayMs).toBe(65_000);
        expect(result.diagnostics?.oneShotReminderCount).toBe(5);
        // A reminder due in two days waits at most a day for the next top-up.
        expect(plan({ tasks: [task('far', { dueDate: '2026-09-30T10:00:00.000Z' })] }).topUpDelayMs).toBe(24 * 60 * 60 * 1000);
    });

    it('keys a repeating alarm by its local time of day and weekday', () => {
        const config = { title: 'Weekly review', message: 'Body', fireAt: new Date('2026-09-29T18:30:00.000Z'), repeatInterval: 'weekly' as const };
        expect(JSON.parse(buildReminderAlarmSignature(config)).fireAt).toBe('weekly:2:18:30');
        expect(buildReminderAlarmSignature({ ...config, fireAt: new Date('2026-10-06T18:30:00.000Z') })).toBe(buildReminderAlarmSignature(config));
    });

    it('snoozes as a new one-shot of the same reminder, named by the tap so a replay replaces it', () => {
        const details = { title: 'Pay rent', message: 'Due', schedule_type: 'once', snooze_interval: 10, data: { taskId: 't', alarmKey: 'task:t' } };
        const requestedAt = Date.parse('2026-09-28T10:03:27.400Z');
        const snooze = buildReminderSnooze(details, requestedAt, 'snooze:1');
        expect(snooze).toEqual({ key: 'snooze:1', fireAtMs: Date.parse('2026-09-28T10:13:27.000Z'), details: { ...details, schedule_type: 'once' } });
        expect(snooze?.details.data).not.toBe(details.data);
        expect(buildReminderSnooze(details, requestedAt, 'snooze:1')).toEqual(snooze);
        expect(buildReminderSnooze({ title: 'Morning briefing', data: {} }, requestedAt, 'snooze:2')).toBeNull();
    });

    it('re-arms on task or project changes and reminder settings, not on sync bookkeeping', () => {
        const tasks: Task[] = [];
        const projects: Project[] = [];
        const settings = { notificationsEnabled: true, lastSyncAt: 'a' } as NotificationSettings;
        const base = { tasks, projects, settings };
        expect(shouldRescheduleReminderAlarms({ ...base }, base)).toBe(false);
        expect(shouldRescheduleReminderAlarms({ ...base, settings: { ...settings, lastSyncAt: 'b' } as NotificationSettings }, base)).toBe(false);
        expect(shouldRescheduleReminderAlarms({ ...base, tasks: [] }, base)).toBe(true);
        expect(shouldRescheduleReminderAlarms({ ...base, settings: { ...settings, language: 'de' } as NotificationSettings }, base)).toBe(true);
        expect(shouldRescheduleReminderAlarms({ ...base, settings: { ...settings, weeklyReviewTime: '09:00' } }, base)).toBe(true);
    });

    it('reads alarm and Pomodoro entries tolerantly', () => {
        expect(Object.fromEntries(readReminderAlarmMap('{"a":{"id":2.9,"signature":"s"},"b":{"id":"x"},"c":null,"d":{"id":4,"pending":true}}')))
            .toEqual({ a: { id: 2, signature: 's' }, d: { id: 4, pending: true } });
        expect(() => readReminderAlarmMap('{')).toThrow();
        expect(readPomodoroAlarmEntry('{"id":"3","fireAtMs":10,"phase":"focus"}')).toEqual({ id: 3, fireAtMs: 10, phase: 'focus' });
        expect(readPomodoroAlarmEntry('{"phase":"focus"}')).toBeNull();
    });

    it('keeps the Pomodoro alarm rules', () => {
        expect(isPomodoroAlarmScheduleSuperseded({ order: 2, requestedAtMs: 5, reason: 'paused' }, 1, 10)).toBe(true);
        // A timer that stopped on its own after the deadline keeps the due alarm.
        expect(isPomodoroAlarmScheduleSuperseded({ order: 2, requestedAtMs: 20, reason: 'timer-not-running' }, 1, 10)).toBe(false);
        expect(isPomodoroAlarmUnchanged({ fireAtMs: 10 }, 10, 'break')).toBe(true);
        expect(isPomodoroAlarmUnchanged({ fireAtMs: 10, phase: 'focus' }, 10, 'break')).toBe(false);
        expect(shouldRemoveFiredPomodoroAlarm({ reason: 'timer-not-running', entry: { id: 1, fireAtMs: 10 }, id: 1, requestedAtMs: 20 })).toBe(false);
        expect(shouldRemoveFiredPomodoroAlarm({ reason: 'paused', entry: { id: 1, fireAtMs: 10 }, id: 1, requestedAtMs: 20 })).toBe(true);
        expect(isPomodoroNativeAlarm({ data: '{"kind":"pomodoro"}' })).toBe(true);
        expect(isPomodoroNativeAlarm({ data: 'alarmKey==>x;;kind==>pomodoro' })).toBe(true);
        expect(isPomodoroNativeAlarm({ data: { kind: 'task-reminder' } })).toBe(false);
    });
});
