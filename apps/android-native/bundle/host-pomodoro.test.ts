import { describe, expect, it } from 'bun:test';
import { createMobilePomodoroController, type NativePomodoroAlarmPlan } from '@mindwtr/core';
import { createNativePomodoro } from './host-pomodoro';

/** The engine side of the Pomodoro alarm (host-pomodoro.ts): how a plan is applied, and made again after a failure. */
describe('native Pomodoro alarm engine', () => {
    it('makes the alarm again on the next plan after one failed to arm', async () => {
        const device = new Map<string, string>();
        const controller = createMobilePomodoroController({
            storage: { getItem: async (key) => device.get(key) ?? null, setItem: async (key, value) => { device.set(key, value); } },
            getTaskStore: () => ({ tasks: [], updateTask: async () => undefined }),
            logWarn: () => undefined,
        });
        let stored: string | null = null;
        let wanted = 'E1';
        let failArm = false;
        const applied: string[] = [];
        const remakes: boolean[] = [];
        const pomodoro = createNativePomodoro({
            controller,
            start: async () => { await controller.ensureHydrated(); return { ok: true, value: { hydrated: true } }; },
            plan: ({ storedEntry, remake }) => {
                remakes.push(remake);
                const base: NativePomodoroAlarmPlan = { entryAhead: null, cancel: [], schedule: [], clearEntry: false, forgetRn: false, outcome: 'unchanged', reason: null };
                if (!remake && storedEntry === wanted) return { ok: true, value: base };
                return { ok: true, value: { ...base, entryAhead: wanted, outcome: 'scheduled',
                    schedule: [{ key: 'pomodoro', id: 1, fireAtMs: 1, repeat: 'once', details: {}, replacing: null }] } };
            },
            readStored: async () => ({ entry: stored, rnEntry: null, rnUnfired: null }),
            storeEntry: async (entry) => { stored = entry; },
            forgetRn: async () => undefined,
            permissionGranted: () => true,
            apply: (planJson) => {
                if (failArm) throw new Error('alarm refused');
                applied.push(planJson);
            },
        });
        await pomodoro.start();
        expect(await pomodoro.cycle(false)).toEqual({ mode: 'active', outcome: 'unchanged' });
        expect(applied).toHaveLength(1);
        remakes.length = 0;
        wanted = 'E2';
        failArm = true;
        await expect(pomodoro.cycle(false)).rejects.toThrow('alarm refused');
        // The record already names E2, but its alarm was never made: the next plan makes it.
        failArm = false;
        expect(await pomodoro.cycle(false)).toEqual({ mode: 'active', outcome: 'scheduled' });
        expect(remakes).toEqual([false, true]);
        expect(applied).toHaveLength(2);
    });
});
