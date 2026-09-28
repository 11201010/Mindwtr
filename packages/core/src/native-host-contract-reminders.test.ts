import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTranslations } from './i18n/i18n-loader';
import { buildReminderAlarmDetails, planReminderAlarms, readReminderAlarmMap } from './mobile-reminder-alarms';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppSettings, Task } from './types';
import { generateUUID } from './uuid';

const NOW = '2026-09-28T10:00:00.000Z';
const T0 = '2026-09-01T10:00:00.000Z';
const task = (fields: Partial<Task> & Pick<Task, 'id'>): Task => ({
    title: `Task ${fields.id}`, status: 'next', tags: [], contexts: [], createdAt: T0, updatedAt: T0, ...fields,
});
const TASKS: Task[] = [
    task({ id: 't-rent', title: 'Pay rent', description: 'Bring the keys', dueDate: '2026-09-28T11:00:00.000Z' }),
    task({ id: 't-standup', title: 'Standup', dueDate: '2026-09-28T12:00:00.000Z', recurrence: { rule: 'daily', strategy: 'strict' } }),
    task({ id: 't-call', title: 'Call back', dueDate: '2026-09-28T10:20:00.000Z', repeatReminderMinutes: 30 }),
    task({ id: 't-review', title: 'Review proposal', reviewAt: '2026-09-28T15:00:00.000Z' }),
    task({ id: 't-date-only', title: 'Date only', dueDate: '2026-09-29' }),
    task({ id: 't-done', title: 'Finished', status: 'done', dueDate: '2026-09-28T13:00:00.000Z' }),
    task({ id: 't-deleted', title: 'Gone', dueDate: '2026-09-28T13:00:00.000Z', deletedAt: T0 }),
];
const SETTINGS: Partial<AppSettings> = { dailyDigestMorningEnabled: true, weeklyReviewEnabled: true };

type Host = ReturnType<typeof createNativeHostContract>;
const saveData = vi.fn(async (_data: unknown) => undefined);
let realUpdateTask: ((...args: any[]) => Promise<any>) | null = null;
const updates: unknown[][] = [];

async function seed(settings: Partial<AppSettings> = SETTINGS) {
    await flushPendingSave();
    resetForTests();
    realUpdateTask ??= useTaskStore.getState().updateTask;
    const real = realUpdateTask;
    let data = JSON.parse(JSON.stringify({ tasks: TASKS, projects: [], sections: [], areas: [], people: [], settings }));
    setStorageAdapter({
        getData: async () => data,
        saveData: async (next) => {
            await saveData(next);
            data = JSON.parse(JSON.stringify(next));
        },
    });
    useTaskStore.setState({
        updateTask: real,
        _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
    } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    useTaskStore.setState({
        updateTask: async (id: string, patch: Partial<Task>) => { updates.push([id, patch]); return real(id, patch); },
    } as never);
    updates.length = 0;
    saveData.mockClear();
}

/** A new host on the loaded store, as after a restart: no receipts, no counters. */
async function openHost(): Promise<Host> {
    const host = createNativeHostContract();
    expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
    expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
    return host;
}

const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const invalid = { ok: false, error: { code: 'INVALID_INPUT' } };
const openFollowUps = (id: string) => useTaskStore.getState()._allTasks.filter((entry) => entry.id !== id && entry.title === 'Standup' && entry.status !== 'done');

describe('native host contract: reminders', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
        process.env.TZ = 'UTC';
    });
    afterAll(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });
    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
        saveData.mockReset();
        saveData.mockImplementation(async () => undefined);
    });
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(NOW));
    };

    it('plans what core\'s planner decides for the store, with an id per alarm and the maps to store', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const plan = value(await host.planReminderAlarms({ storedAlarms: null, permissionGranted: true }));
        const state = useTaskStore.getState();
        const direct = planReminderAlarms({
            settings: state.settings, tasks: state.tasks, projects: state.projects, now: new Date(NOW),
            translations: await loadTranslations('en'), maxOneShotReminders: 200, alarms: new Map(),
        });
        const requests = [...direct.recurring, ...direct.oneShot];
        expect(plan.mode).toBe('active');
        expect(plan.cancel).toEqual([]);
        expect(plan.schedule.map((alarm) => alarm.key)).toEqual(requests.map((request) => request.key));
        expect(plan.schedule.map((alarm) => alarm.key)).not.toContain('task:t-date-only');
        for (const [index, alarm] of plan.schedule.entries()) {
            const { config, key } = requests[index];
            expect(alarm).toMatchObject({ fireAtMs: config.fireAt.getTime(), repeat: config.repeatInterval ?? 'once', details: buildReminderAlarmDetails(key, config), replacing: null });
        }
        expect(plan.schedule.find((alarm) => alarm.key === 'task:t-rent')?.details).toMatchObject({
            channel: 'mindwtr_reminders_v2', has_complete_action: true, snooze_interval: 10, data: { taskId: 't-rent', kind: 'task-reminder' },
        });
        const ids = plan.schedule.map((alarm) => alarm.id);
        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(id).toBeGreaterThan(0));
        ids.forEach((id) => expect(id).toBeLessThan(2 ** 30));
        expect(Object.values(JSON.parse(plan.writeAhead!))).toEqual(plan.schedule.map((alarm) => expect.objectContaining({ id: alarm.id, pending: true })));
        expect(Object.values(JSON.parse(plan.alarms)).some((entry) => (entry as { pending?: true }).pending)).toBe(false);
        expect(plan.topUpDelayMs).toBe(20 * 60_000 + 5_000);
        expect(plan.clearDelivered).toBe(false);
    });

    it('replays an interrupted plan after a restart: the same alarms under the same ids, and none left behind', async () => {
        freezeClock();
        await seed();
        const first = value(await (await openHost()).planReminderAlarms({ storedAlarms: null, permissionGranted: true }));

        // Stopped after storing writeAhead: a new host plans the same alarms under the same ids.
        const replay = value(await (await openHost()).planReminderAlarms({ storedAlarms: first.writeAhead, permissionGranted: true }));
        expect(replay.schedule).toEqual(first.schedule.map((alarm) => ({ ...alarm, replacing: 'expired' })));
        expect(replay.cancel).toEqual([]);
        expect(replay.alarms).toBe(first.alarms);

        // Applied and stored: planning again changes nothing.
        const settled = value(await (await openHost()).planReminderAlarms({ storedAlarms: first.alarms, permissionGranted: true }));
        expect(settled).toMatchObject({ schedule: [], cancel: [], writeAhead: null, alarms: first.alarms });

        // The rent task was done before the replay: its pending alarm is cancelled under the id it may have been made with.
        await useTaskStore.getState().updateTask('t-rent', { status: 'done' });
        await flushPendingSave();
        const afterDone = value(await (await openHost()).planReminderAlarms({ storedAlarms: first.writeAhead, permissionGranted: true }));
        const rentId = first.schedule.find((alarm) => alarm.key === 'task:t-rent')!.id;
        expect(afterDone.cancel).toEqual([{ key: 'task:t-rent', id: rentId, reason: 'withdrawn' }]);
        expect(afterDone.schedule.map((alarm) => alarm.key)).not.toContain('task:t-rent');
        expect(readReminderAlarmMap(afterDone.alarms).has('task:t-rent')).toBe(false);
    });

    it('lets an alarm whose time passed expire, keeping what it delivered', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const first = value(await host.planReminderAlarms({ storedAlarms: null, permissionGranted: true }));
        vi.setSystemTime(new Date('2026-09-28T11:00:05.000Z'));
        const later = value(await host.planReminderAlarms({ storedAlarms: first.alarms, permissionGranted: true }));
        const held = (key: string) => first.schedule.find((alarm) => alarm.key === key)!.id;
        expect(later.cancel).toEqual(expect.arrayContaining([{ key: 'task:t-rent', id: held('task:t-rent'), reason: 'expired' }]));
        expect(later.cancel.every((entry) => entry.reason === 'expired')).toBe(true);
    });

    it('keeps an alarm\'s id when it changes, and gives a new key an id no held alarm has', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const first = value(await host.planReminderAlarms({ storedAlarms: null, permissionGranted: true }));
        await useTaskStore.getState().updateTask('t-rent', { dueDate: '2026-09-28T11:30:00.000Z' });
        await useTaskStore.getState().updateTask('t-date-only', { dueDate: '2026-09-28T14:00:00.000Z' });
        const next = value(await host.planReminderAlarms({ storedAlarms: first.alarms, permissionGranted: true }));
        expect(next.schedule.map((alarm) => alarm.key)).toEqual(['task:t-rent', 'task:t-date-only']);
        // The rent reminder moved: whatever it delivered is withdrawn with it.
        expect(next.schedule.map((alarm) => alarm.replacing)).toEqual(['withdrawn', null]);
        expect(next.schedule[0].id).toBe(first.schedule.find((alarm) => alarm.key === 'task:t-rent')!.id);
        expect(first.schedule.map((alarm) => alarm.id)).not.toContain(next.schedule[1].id);
        expect(next.cancel).toEqual([]);
    });

    it('cancels every alarm without permission or with every reminder off, and starts over from an unreadable map', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const first = value(await host.planReminderAlarms({ storedAlarms: null, permissionGranted: true }));
        const everyAlarm = first.schedule.map(({ key, id }) => ({ key, id, reason: 'withdrawn' }));
        expect(value(await host.planReminderAlarms({ storedAlarms: first.alarms, permissionGranted: false })))
            .toEqual({ mode: 'revoked', cancel: everyAlarm, schedule: [], writeAhead: null, alarms: '{}', topUpDelayMs: null, clearDelivered: true });
        await useTaskStore.getState().updateSettings({ notificationsEnabled: false, dailyDigestMorningEnabled: false, weeklyReviewEnabled: false });
        expect(value(await host.planReminderAlarms({ storedAlarms: first.alarms, permissionGranted: true })))
            .toMatchObject({ mode: 'inactive', cancel: everyAlarm, schedule: [], alarms: '{}', clearDelivered: false });
        expect(value(await host.planReminderAlarms({ storedAlarms: '{not json', permissionGranted: true }))).toMatchObject({ cancel: [], alarms: '{}' });
        expect(await host.planReminderAlarms({ storedAlarms: 7 as never, permissionGranted: true })).toMatchObject(invalid);
    });

    it('is not ready before the store is loaded', async () => {
        const host = createNativeHostContract();
        expect(await host.planReminderAlarms({ storedAlarms: null, permissionGranted: true })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.completeReminderTask({ requestId: generateUUID(), taskId: 't-rent' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });

    it('completes a recurring task once from Done: an exact retry and a replay after a restart make no second next instance', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const input = { requestId: generateUUID(), taskId: 't-standup' };
        const [first, second] = await Promise.all([host.completeReminderTask(input), host.completeReminderTask(input)]);
        expect(first).toEqual({ ok: true, value: { changed: true, outcome: 'completed' } });
        expect(second).toEqual(first);
        expect(updates).toEqual([['t-standup', { status: 'done', isFocusedToday: false }]]);
        expect(useTaskStore.getState()._tasksById.get('t-standup')).toMatchObject({ status: 'done' });
        expect(openFollowUps('t-standup')).toHaveLength(1);
        const tasksAfter = useTaskStore.getState()._allTasks.map((entry) => [entry.id, entry.rev]);
        expect(await host.completeReminderTask({ ...input, taskId: 't-rent' })).toMatchObject(invalid);

        const restarted = await openHost();
        expect(await restarted.completeReminderTask(input)).toEqual({ ok: true, value: { changed: false, outcome: 'not-actionable' } });
        expect(updates).toHaveLength(1);
        expect(openFollowUps('t-standup')).toHaveLength(1);
        expect(useTaskStore.getState()._allTasks.map((entry) => [entry.id, entry.rev])).toEqual(tasksAfter);
    });

    it('finishes a Done whose save failed on retry, without a second write', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const input = { requestId: generateUUID(), taskId: 't-standup' };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.completeReminderTask(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        saveData.mockResolvedValue(undefined);
        expect(await host.completeReminderTask(input)).toEqual({ ok: true, value: { changed: true, outcome: 'completed' } });
        expect(updates).toHaveLength(1);
        expect(openFollowUps('t-standup')).toHaveLength(1);
    });

    it('leaves a missing, deleted or finished task alone', async () => {
        await seed();
        const host = await openHost();
        const done = (taskId: string) => host.completeReminderTask({ requestId: generateUUID(), taskId });
        expect(await done('t-missing')).toEqual({ ok: true, value: { changed: false, outcome: 'task-not-found' } });
        expect(await done('t-deleted')).toEqual({ ok: true, value: { changed: false, outcome: 'task-deleted' } });
        expect(await done('t-done')).toEqual({ ok: true, value: { changed: false, outcome: 'not-actionable' } });
        expect(await host.completeReminderTask({ requestId: 'not-a-uuid', taskId: 't-rent' })).toMatchObject(invalid);
        expect(await host.completeReminderTask({ requestId: generateUUID(), taskId: '' })).toMatchObject(invalid);
        expect(updates).toEqual([]);
    });

    it('snoozes as the same alarm again ten minutes after the tap, and a replay after a restart returns that same alarm', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const fired = value(await host.planReminderAlarms({ storedAlarms: null, permissionGranted: true })).schedule.find((alarm) => alarm.key === 'task:t-rent')!;
        const input = { requestId: generateUUID(), requestedAt: Date.parse('2026-09-28T11:00:42.500Z'), details: fired.details };
        const snoozed = value(host.snoozeReminder(input));
        expect(snoozed).toEqual({
            key: `snooze:${input.requestId.toLowerCase()}`,
            id: snoozed.id,
            fireAtMs: Date.parse('2026-09-28T11:10:42.000Z'),
            repeat: 'once',
            details: { ...fired.details, schedule_type: 'once' },
            replacing: null,
        });
        expect(snoozed.id).toBeGreaterThanOrEqual(2 ** 30);
        expect(value((await openHost()).snoozeReminder(input))).toEqual(snoozed);
        const digest = value(await host.planReminderAlarms({ storedAlarms: null, permissionGranted: true })).schedule.find((alarm) => alarm.key === 'digest:morning')!;
        expect(host.snoozeReminder({ ...input, details: digest.details })).toMatchObject(invalid);
        expect(host.snoozeReminder({ ...input, requestId: 'x' })).toMatchObject(invalid);
    });

    it('routes a notification tap, the same way after a restart', async () => {
        freezeClock();
        await seed();
        const host = await openHost();
        const payloads = [
            { actionIdentifier: 'complete', taskId: 't-rent', notificationId: 'task:t-rent' },
            { actionIdentifier: 'snooze', taskId: 't-rent' },
            { kind: 'task-review', taskId: 't-review', notificationId: 'task:t-review' },
            { notificationId: 'digest:morning' },
            { projectId: 'p-1' },
        ];
        const routes = payloads.map((payload) => value(host.routeNotificationOpen(payload)));
        expect(routes).toEqual([
            { type: 'complete', taskId: 't-rent', actionKey: 'task:t-rent:t-rent:complete' },
            { type: 'none' },
            { type: 'review', openToken: 'task:t-review', taskId: 't-review' },
            { type: 'daily-review', openToken: 'digest:morning' },
            { type: 'project', projectId: 'p-1' },
        ]);
        const restarted = await openHost();
        expect(payloads.map((payload) => value(restarted.routeNotificationOpen(payload)))).toEqual(routes);
        expect(value(host.routeNotificationOpen({ taskId: 't-rent' }))).toEqual({ type: 'task', taskId: 't-rent', openToken: `notification:${Date.parse(NOW)}:1` });
        expect(host.routeNotificationOpen(null as never)).toMatchObject(invalid);
    });
});
