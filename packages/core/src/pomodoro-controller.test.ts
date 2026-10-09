import { describe, expect, it } from 'vitest';
import { createMobilePomodoroController } from './pomodoro-controller';
import { POMODORO_SESSION_STORAGE_KEY } from './pomodoro-session';
import type { Task } from './types';

/** A finished focus session's task credit across the two stores it touches (the session on the device, the task in the database). */
const NOW = Date.now();
const stored = JSON.stringify({
    durations: { focusMinutes: 25, breakMinutes: 5 },
    timerState: { phase: 'focus', remainingSeconds: 600, isRunning: true, completedFocusSessions: 0 },
    selectedTaskId: 't1',
    phaseEndsAt: new Date(NOW - 60_000).toISOString(),
    updatedAtMs: NOW - 1_500_000,
});

function open(device: Map<string, string>, tasks: Task[], options: { failWrites?: () => boolean; failUpdates?: () => boolean } = {}) {
    return createMobilePomodoroController({
        storage: {
            getItem: async (key) => device.get(key) ?? null,
            setItem: async (key, value) => {
                if (options.failWrites?.()) throw new Error('disk full');
                device.set(key, value);
            },
        },
        getTaskStore: () => ({
            tasks,
            updateTask: async (id, updates) => {
                if (options.failUpdates?.()) return { success: false, error: 'locked' };
                Object.assign(tasks.find((task) => task.id === id)!, updates);
                return { success: true };
            },
        }),
        logWarn: () => undefined,
    });
}

const settle = async (controller: ReturnType<typeof open>) => {
    await controller.flushPersistence().catch(() => undefined);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('Pomodoro task credit', () => {
    it('credits once when the session write failed and the app restarts', async () => {
        const tasks = [{ id: 't1', title: 'One', status: 'next', timeSpentMinutes: 5 } as Task];
        const device = new Map([[POMODORO_SESSION_STORAGE_KEY, stored]]);
        const first = open(device, tasks, { failWrites: () => true });
        await first.ensureHydrated();
        await settle(first);
        const second = open(device, tasks);
        await second.ensureHydrated();
        await settle(second);
        expect(tasks[0].timeSpentMinutes).toBe(30);
    });

    it('credits once when the task write failed after the session was stored', async () => {
        const tasks = [{ id: 't1', title: 'One', status: 'next', timeSpentMinutes: 5 } as Task];
        const device = new Map([[POMODORO_SESSION_STORAGE_KEY, stored]]);
        const first = open(device, tasks, { failUpdates: () => true });
        await first.ensureHydrated();
        await settle(first);
        expect(tasks[0].timeSpentMinutes).toBe(5);
        const second = open(device, tasks);
        await second.ensureHydrated();
        await settle(second);
        expect(tasks[0].timeSpentMinutes).toBe(30);
        // A third start finds nothing owed.
        const third = open(device, tasks);
        await third.ensureHydrated();
        await settle(third);
        expect(tasks[0].timeSpentMinutes).toBe(30);
    });

    it('credits once when the app stopped after the task write and before the session was stored again', async () => {
        const tasks = [{ id: 't1', title: 'One', status: 'next', timeSpentMinutes: 5 } as Task];
        const device = new Map([[POMODORO_SESSION_STORAGE_KEY, stored]]);
        let writes = 0;
        // The first session write (the credit owed) lands; the next (the credit settled) does not.
        const first = open(device, tasks, { failWrites: () => (writes += 1) > 1 });
        await first.ensureHydrated();
        await settle(first);
        expect(tasks[0].timeSpentMinutes).toBe(30);
        const second = open(device, tasks);
        await second.ensureHydrated();
        await settle(second);
        expect(tasks[0].timeSpentMinutes).toBe(30);
    });

    it('credits two sessions of one task in a row', async () => {
        const tasks = [{ id: 't1', title: 'One', status: 'next', timeSpentMinutes: 5 } as Task];
        const device = new Map([[POMODORO_SESSION_STORAGE_KEY, JSON.stringify({ ...JSON.parse(stored),
            durations: { focusMinutes: 1, breakMinutes: 1 }, timerState: { phase: 'focus', remainingSeconds: 60, isRunning: true } })]]);
        let nowMs = NOW;
        const controller = createMobilePomodoroController({
            storage: { getItem: async (key) => device.get(key) ?? null, setItem: async (key, value) => { device.set(key, value); } },
            getTaskStore: () => ({ tasks, updateTask: async (id, updates) => { Object.assign(tasks[0], updates); return { success: true }; } }),
            now: () => nowMs,
            logWarn: () => undefined,
            });
        await controller.ensureHydrated({ autoStartBreaks: true, autoStartFocus: true });
        nowMs += 61_000;
        controller.reconcile({ autoStartBreaks: true, autoStartFocus: true });
        nowMs += 61_000;
        controller.reconcile({ autoStartBreaks: true, autoStartFocus: true });
        await settle(controller);
        expect(tasks[0].timeSpentMinutes).toBe(7);
    });
});
