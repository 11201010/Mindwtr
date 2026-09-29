import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CALENDAR_PUSH_CALENDAR_ID_KEY,
    CALENDAR_PUSH_ENABLED_KEY,
    CALENDAR_PUSH_TARGET_ID_KEY,
    createCalendarPushService,
    type CalendarPushServiceHost,
} from './calendar-push-service';
import type { DeviceCalendar } from './external-calendar-feeds';
import type { CalendarSyncEntry } from './sqlite-adapter';
import type { Task } from './types';

/**
 * The push's device side as a native host binds it. React Native's own suite
 * (apps/mobile/tests/calendar-push-sync.test.ts) runs the same code through its
 * binding.
 */
const google = { name: 'alex@gmail.com', type: 'com.google', isLocalAccount: false };
const PRIMARY: DeviceCalendar = { id: 'primary', title: 'alex@gmail.com', ownerAccount: 'alex@gmail.com', accessLevel: 'owner', allowsModifications: true, source: google };

const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...extra,
} as Task);

/** The process died before a write: the write did not happen, and nothing after it runs. */
class Death extends Error {}

function device(options: { os?: string; calendars?: DeviceCalendar[]; storage?: Record<string, string>; entries?: CalendarSyncEntry[]; tasks?: Task[] } = {}) {
    // Every device write first ticks: at `dieAt` the process dies, and every later write fails too.
    const life = { step: 0, dieAt: Infinity, died: false, failDelete: false };
    const tick = () => {
        life.step += 1;
        if (life.died || life.step === life.dieAt) {
            life.died = true;
            throw new Death(`died before write ${life.step}`);
        }
    };
    const storage = new Map(Object.entries(options.storage ?? {}));
    const calendars = [...(options.calendars ?? [PRIMARY])];
    const entries = new Map((options.entries ?? []).map((entry) => [entry.taskId, entry]));
    const writes: unknown[][] = [];
    let nextId = 0;
    let tasks = options.tasks ?? [];
    const listeners: ((tasks: Task[]) => void)[] = [];
    const store = {
        getState: () => ({ _allTasks: tasks, _tasksById: new Map(tasks.map((entry) => [entry.id, entry])), projects: [], sections: [], settings: {} }),
        subscribe: (_selector: unknown, listener: (tasks: Task[]) => void) => {
            listeners.push(listener);
            return () => undefined;
        },
    };
    const host: CalendarPushServiceHost = {
        platform: 'android',
        os: () => options.os ?? 'android',
        storage: {
            getItem: async (key) => storage.get(key) ?? null,
            setItem: async (key, value) => { tick(); storage.set(key, value); },
            removeItem: async (key) => { tick(); storage.delete(key); },
        },
        calendars: {
            getPermissions: async () => ({ status: 'granted' }),
            requestPermissions: async () => ({ status: 'granted' }),
            getCalendars: async () => calendars.map((calendar) => ({ ...calendar })),
            getEvents: async () => [],
            getSources: async () => [{ id: 'local-source', type: 'local', name: 'Default' }],
            createCalendar: async (details) => {
                tick();
                nextId += 1;
                const id = `created-${nextId}`;
                writes.push(['createCalendar', details.title, details.source.name]);
                calendars.push({ ...details, id, allowsModifications: true, source: { ...details.source } });
                return id;
            },
            updateCalendar: async (id, details) => {
                tick();
                writes.push(['updateCalendar', id, details.color]);
                const calendar = calendars.find((entry) => entry.id === id);
                if (calendar) calendar.color = details.color;
            },
            deleteCalendar: async (id) => {
                tick();
                if (life.failDelete) throw new Error('Calendar provider refused the delete');
                writes.push(['deleteCalendar', id]);
                const index = calendars.findIndex((calendar) => calendar.id === id);
                if (index >= 0) calendars.splice(index, 1);
            },
            createEvent: async (calendarId, details) => {
                tick();
                writes.push(['createEvent', calendarId, details]);
                return `event-${writes.length}`;
            },
            updateEvent: async (id, details) => { tick(); writes.push(['updateEvent', id, details.title]); },
            deleteEvent: async (id) => { tick(); writes.push(['deleteEvent', id]); },
        },
        syncEntries: {
            ensureReady: async () => undefined,
            get: async (taskId) => entries.get(taskId) ?? null,
            upsert: async (entry) => { tick(); entries.set(entry.taskId, entry); },
            delete: async (taskId) => { tick(); writes.push(['deleteSyncEntry', taskId]); entries.delete(taskId); },
            getAll: async () => [...entries.values()],
        },
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
        store: store as unknown as CalendarPushServiceHost['store'],
    };
    return {
        host, storage, calendars, entries, writes, life,
        setTasks: (next: Task[]) => {
            tasks = next;
            listeners.forEach((listener) => listener(next));
        },
    };
}

type Phone = ReturnType<typeof device>;

/**
 * A death between each pair of steps: runs `operation` on a device that dies before its
 * first write, then before its second, and so on, until a run finishes. After each death a
 * new service over the same device (a restart) runs `retry`; `check` sees every outcome.
 */
async function everyDeath(
    setup: () => Phone,
    operation: (service: ReturnType<typeof createCalendarPushService>) => Promise<unknown>,
    check: (phone: Phone, dieAt: number) => void,
    retry = operation,
) {
    for (let dieAt = 1; dieAt < 100; dieAt += 1) {
        const phone = setup();
        phone.life.dieAt = dieAt;
        await operation(createCalendarPushService(phone.host)).catch((error: unknown) => {
            if (!(error instanceof Death)) throw error;
        });
        const died = phone.life.died;
        phone.life.dieAt = Infinity;
        phone.life.died = false;
        if (died) await retry(createCalendarPushService(phone.host));
        check(phone, dieAt);
        if (!died) return dieAt;
    }
    throw new Error('The operation never finished');
}

describe('calendar push behind the host ports', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('reuses the saved Mindwtr calendar across a restart and makes a new one only when it is gone', async () => {
        const phone = device();
        const first = createCalendarPushService(phone.host);
        expect(await first.ensureMindwtrCalendar()).toBe('created-1');
        expect(phone.writes).toEqual([['createCalendar', 'Mindwtr', 'alex@gmail.com']]);
        // A restart: a new service over the same device.
        const restarted = createCalendarPushService(phone.host);
        expect(await restarted.ensureMindwtrCalendar()).toBe('created-1');
        expect(phone.writes).toHaveLength(1);
        // Deleted outside the app: made again, once.
        phone.calendars.splice(phone.calendars.findIndex((calendar) => calendar.id === 'created-1'), 1);
        expect(await restarted.ensureMindwtrCalendar()).toBe('created-2');
        expect(phone.storage.get(CALENDAR_PUSH_CALENDAR_ID_KEY)).toBe('created-2');
    });

    it('deletes only the calendar it saved, never one another install named the same way, and forgets only its pushed events', async () => {
        const phone = device({
            calendars: [
                PRIMARY,
                { id: 'saved', title: 'Anything', ownerAccount: 'alex@gmail.com', accessLevel: 'owner', source: google },
                { id: 'app-made', title: 'Mindwtr', name: 'mindwtr', accessLevel: 'owner', source: google },
                { id: 'users-own', title: 'Mindwtr', name: 'alex@gmail.com', accessLevel: 'owner', source: google },
            ],
            storage: { [CALENDAR_PUSH_CALENDAR_ID_KEY]: 'saved', [CALENDAR_PUSH_TARGET_ID_KEY]: 'app-made' },
            entries: [
                { taskId: 't1', calendarEventId: 'e1', calendarId: 'saved', platform: 'android', lastSyncedAt: '' },
                { taskId: 't2', calendarEventId: 'e2', calendarId: 'users-own', platform: 'android', lastSyncedAt: '' },
            ],
        });
        await createCalendarPushService(phone.host).deleteMindwtrCalendar();
        expect(phone.writes).toEqual([['deleteCalendar', 'saved'], ['deleteSyncEntry', 't1']]);
        expect(phone.calendars.map((calendar) => calendar.id)).toEqual(['primary', 'app-made', 'users-own']);
        expect(phone.storage.has(CALENDAR_PUSH_CALENDAR_ID_KEY)).toBe(false);
        // The chosen calendar was not the one deleted: it stays chosen.
        expect(phone.storage.get(CALENDAR_PUSH_TARGET_ID_KEY)).toBe('app-made');
        expect([...phone.entries.keys()]).toEqual(['t2']);
    });

    it('keeps the saved ID, the chosen calendar and the pushed events when the delete fails', async () => {
        const phone = device({
            calendars: [PRIMARY, { id: 'saved', title: 'Mindwtr', name: 'mindwtr', accessLevel: 'owner', source: google }],
            storage: { [CALENDAR_PUSH_CALENDAR_ID_KEY]: 'saved', [CALENDAR_PUSH_TARGET_ID_KEY]: 'saved' },
            entries: [{ taskId: 't1', calendarEventId: 'e1', calendarId: 'saved', platform: 'android', lastSyncedAt: '' }],
        });
        phone.life.failDelete = true;
        await expect(createCalendarPushService(phone.host).deleteMindwtrCalendar()).rejects.toThrow();
        expect(phone.calendars.map((calendar) => calendar.id)).toEqual(['primary', 'saved']);
        expect(phone.storage.get(CALENDAR_PUSH_CALENDAR_ID_KEY)).toBe('saved');
        expect(phone.storage.get(CALENDAR_PUSH_TARGET_ID_KEY)).toBe('saved');
        expect([...phone.entries.keys()]).toEqual(['t1']);
        // A retry that succeeds finishes it.
        phone.life.failDelete = false;
        await createCalendarPushService(phone.host).deleteMindwtrCalendar();
        expect(phone.calendars.map((calendar) => calendar.id)).toEqual(['primary']);
        expect(phone.storage.has(CALENDAR_PUSH_CALENDAR_ID_KEY)).toBe(false);
        expect([...phone.entries.keys()]).toEqual([]);
    });

    it('finishes a delete after a death between any two of its steps', async () => {
        const writes = await everyDeath(
            () => device({
                calendars: [PRIMARY, { id: 'saved', title: 'Mindwtr', name: 'mindwtr', accessLevel: 'owner', source: google }],
                storage: { [CALENDAR_PUSH_CALENDAR_ID_KEY]: 'saved', [CALENDAR_PUSH_TARGET_ID_KEY]: 'saved' },
                entries: [
                    { taskId: 't1', calendarEventId: 'e1', calendarId: 'saved', platform: 'android', lastSyncedAt: '' },
                    { taskId: 't2', calendarEventId: 'e2', calendarId: 'primary', platform: 'android', lastSyncedAt: '' },
                ],
            }),
            (service) => service.deleteMindwtrCalendar(),
            (phone, dieAt) => {
                expect({ dieAt, calendars: phone.calendars.map((calendar) => calendar.id) }).toEqual({ dieAt, calendars: ['primary'] });
                expect({ dieAt, entries: [...phone.entries.keys()], storage: Object.fromEntries(phone.storage) }).toEqual({ dieAt, entries: ['t2'], storage: {} });
            },
        );
        expect(writes).toBeGreaterThan(3);
    });

    it('recolors only the calendar it saved', async () => {
        const phone = device({
            calendars: [PRIMARY, { id: 'other-install', title: 'Mindwtr', name: 'mindwtr', color: '#3B82F6', accessLevel: 'owner', allowsModifications: true, source: google }],
        });
        expect(await createCalendarPushService(phone.host).updateMindwtrCalendarColor('#059669')).toBe(false);
        expect(phone.writes).toEqual([]);
        expect(phone.calendars.map((calendar) => calendar.id)).toEqual(['primary', 'other-install']);
    });

    it('lists writable calendars: the managed one first, then Mindwtr-named ones, then by name', async () => {
        const phone = device({
            calendars: [
                { id: 'zeta', title: 'Zeta', accessLevel: 'owner', source: google },
                { id: 'read', title: 'Holidays', accessLevel: 'read', source: google },
                { id: 'frozen', title: 'Frozen', allowsModifications: false, source: google },
                { id: 'named', title: 'Mindwtr', accessLevel: 'owner', source: { name: 'local account', type: 'LOCAL' } },
                { id: 'alpha', title: 'Alpha', accessLevel: 'owner', source: google },
                { id: 'managed', title: 'Tasks', accessLevel: 'owner', source: google },
            ],
            storage: { [CALENDAR_PUSH_CALENDAR_ID_KEY]: 'managed' },
        });
        const targets = await createCalendarPushService(phone.host).getCalendarPushTargetCalendars();
        expect(targets.map((target) => [target.id, target.isMindwtrManaged, target.isMindwtrDedicated, target.isLocalOnly, target.sourceName])).toEqual([
            ['managed', true, false, false, 'alex@gmail.com'],
            ['named', false, true, true, 'local account'],
            ['alpha', false, false, false, 'alex@gmail.com'],
            ['zeta', false, false, false, 'alex@gmail.com'],
        ]);
    });

    it('pushes a date-only task as an Android all-day event on UTC midnights, and a store change as one debounced partial push', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const dated = task('t1', { dueDate: '2026-09-10' });
        const phone = device({ storage: { [CALENDAR_PUSH_ENABLED_KEY]: '1' }, tasks: [dated, task('t2')] });
        const service = createCalendarPushService(phone.host);
        await service.runFullCalendarSync();
        const created = phone.writes.find(([name]) => name === 'createEvent')!;
        expect(created[1]).toBe('created-1');
        expect(created[2]).toMatchObject({
            title: 'Task t1', allDay: true, timeZone: 'UTC', endTimeZone: 'UTC',
            startDate: new Date(Date.UTC(2026, 8, 10)), endDate: new Date(Date.UTC(2026, 8, 11)),
        });

        service.startCalendarPushSync();
        phone.writes.length = 0;
        phone.setTasks([{ ...dated, title: 'Renamed', updatedAt: '2026-09-02T00:00:00.000Z' }, task('t2')]);
        await vi.advanceTimersByTimeAsync(2_499);
        expect(phone.writes).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(phone.writes.map(([name, id, title]) => [name, id, title])).toEqual([['updateEvent', phone.entries.get('t1')!.calendarEventId, 'Renamed']]);
        service.stopCalendarPushSync();
    });
});
