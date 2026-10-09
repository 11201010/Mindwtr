import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslator } from './i18n';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { NATIVE_POMODORO_ALARM_ID } from './native-host-contract-pomodoro';
import { createMobilePomodoroController } from './pomodoro-controller';
import { POMODORO_COLLAPSED_STORAGE_KEY, POMODORO_SESSION_STORAGE_KEY } from './pomodoro-session';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppSettings, Task } from './types';
import { generateUUID } from './uuid';

/** The Focus screen's Pomodoro card and its completion alarm (RN's pomodoro-panel.tsx and use-root-layout-pomodoro.ts). */
const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

const NOW = new Date('2026-10-06T09:00:00.000Z').getTime();
const task = (id: string, props: Partial<Task> = {}): Task => ({
    id, title: `Task ${id}`, status: 'next', tags: [], contexts: [], createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', ...props,
} as Task);

let saved: { tasks: Task[] } | null = null;
async function openHost(settings: AppSettings, options: { tasks?: Task[]; device?: Map<string, string> } = {}) {
    await flushPendingSave();
    resetForTests();
    let data = { tasks: options.tasks ?? [], projects: [], sections: [], areas: [], people: [], settings };
    setStorageAdapter({
        getData: async () => JSON.parse(JSON.stringify(data)),
        saveData: async (next) => {
            data = JSON.parse(JSON.stringify(next));
            saved = data as never;
        },
    });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [], settings: {}, lastDataChangeAt: 0,
        error: null, persistenceFailure: null, isLoading: false, editLockCount: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    const device = options.device ?? new Map<string, string>();
    const storage = {
        getItem: async (key: string) => device.get(key) ?? null,
        setItem: async (key: string, text: string) => { device.set(key, text); },
    };
    const controller = createMobilePomodoroController({ storage, logWarn: () => undefined });
    const host = createNativeHostContract({ pomodoro: { controller, storage } });
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' }));
    value(await host.activate({ writeSafetyReady: true }));
    return { host, device, controller };
}

const POMODORO_ON = { features: { pomodoro: true } } as AppSettings;
const action = (host: Awaited<ReturnType<typeof openHost>>['host'], next: unknown, requestId = generateUUID()) => (
    host.runPomodoroAction({ requestId, action: next as never })
);
const plan = (host: Awaited<ReturnType<typeof openHost>>['host'], storedEntry: string | null, options: { permissionGranted?: boolean; remake?: boolean; rnEntryStored?: boolean } = {}) => (
    value(host.planPomodoroAlarm({ storedEntry, rnEntryStored: options.rnEntryStored ?? false, permissionGranted: options.permissionGranted ?? true, remake: options.remake ?? false }))
);

describe('native host contract: the Pomodoro card', () => {
    afterEach(async () => {
        vi.useRealTimers();
        saved = null;
        await flushPendingSave();
        resetForTests();
    });

    it('shows RN\'s loading row until the session loads, then RN\'s card', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const { host } = await openHost(POMODORO_ON);
        const t = getTranslator('en');
        const loading = value(host.getPomodoroPanel());
        expect(loading).toMatchObject({ enabled: true, loading: t('common.loading'), clock: '25:00', phaseLabel: t('pomodoro.phaseFocusShort') });
        expect(value(await host.startPomodoro())).toEqual({ hydrated: true });
        const card = value(host.getPomodoroPanel());
        expect(card).toMatchObject({
            loading: null, collapsed: false, title: t('pomodoro.mobileTitle'), running: false, link: null, event: null,
            status: `${t('pomodoro.phaseFocusShort')} · ${t('pomodoro.paused')}`,
            primary: { label: t('common.start'), action: { type: 'run', value: true } },
            switchPhase: { label: t('pomodoro.switchToBreak'), action: { type: 'phase', value: 'break' } },
            collapseToggle: { label: t('pomodoro.collapse'), action: { type: 'collapse', value: true } },
            sessions: `${t('pomodoro.sessionsDone')}: 0`,
        });
        expect(card.presets.map((preset) => [preset.label, preset.active])).toEqual([['15/3', false], ['25/5', true], ['50/10', false]]);
        expect(value((await openHost({})).host.getPomodoroPanel()).enabled).toBe(false);
    });

    it('applies each control as the state it asks for; a replay or a repeat changes nothing more', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const { host, device } = await openHost(POMODORO_ON);
        value(await host.startPomodoro());
        const requestId = generateUUID();
        expect(value(await action(host, { type: 'run', value: true }, requestId))).toMatchObject({ changed: true, panel: { running: true } });
        expect(JSON.parse(device.get(POMODORO_SESSION_STORAGE_KEY)!).timerState.isRunning).toBe(true);
        // The same request answers from its receipt; a new Start while running is a no-op.
        expect(value(await action(host, { type: 'run', value: true }, requestId)).changed).toBe(true);
        expect(value(await action(host, { type: 'run', value: true })).changed).toBe(false);
        vi.setSystemTime(NOW + 61_000);
        expect(value(host.getPomodoroPanel()).clock).toBe('23:59');
        expect(value(await action(host, { type: 'run', value: false })).panel).toMatchObject({ running: false, clock: '23:59' });
        expect(value(await action(host, { type: 'phase', value: 'break' })).panel).toMatchObject({ phase: 'break', clock: '05:00' });
        expect(value(await action(host, { type: 'phase', value: 'break' })).changed).toBe(false);
        expect(value(await action(host, { type: 'preset', focusMinutes: 50, breakMinutes: 10 })).panel.clock).toBe('10:00');
        expect(value(await action(host, { type: 'collapse', value: true })).panel).toMatchObject({ collapsed: true });
        expect(device.get(POMODORO_COLLAPSED_STORAGE_KEY)).toBe('true');
        expect(value(await action(host, { type: 'collapse', value: true })).changed).toBe(false);
        for (const bad of [{ type: 'toggle' }, { type: 'run', value: 'yes' }, { type: 'preset', focusMinutes: 0, breakMinutes: 5 },
            { type: 'reset', extra: 1 }, { type: 'selectTask', taskId: '' }]) {
            const result = await action(host, bad);
            expect(result.ok ? null : result.error.code).toBe('INVALID_INPUT');
        }
    });

    it('keeps the fold and the session across a restart, as RN stores them', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const first = await openHost(POMODORO_ON);
        value(await first.host.startPomodoro());
        value(await action(first.host, { type: 'run', value: true }));
        value(await action(first.host, { type: 'collapse', value: true }));
        vi.setSystemTime(NOW + 10_000);
        const second = await openHost(POMODORO_ON, { device: first.device });
        value(await second.host.startPomodoro());
        expect(value(second.host.getPomodoroPanel())).toMatchObject({ collapsed: true, running: true, clock: '24:50' });
    });

    it('links a task from RN\'s Focus lists, marks it done once, and drops one that is gone', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const tasks = [task('a', { isFocusedToday: true }), task('b'), task('c', { status: 'inbox' }), task('d', { status: 'next', deletedAt: '2026-10-02T00:00:00.000Z' })];
        const { host } = await openHost({ ...POMODORO_ON, gtd: { pomodoro: { linkTask: true } } } as AppSettings, { tasks });
        value(await host.startPomodoro());
        const t = getTranslator('en');
        expect(value(host.getPomodoroPanel()).link).toEqual({ label: t('pomodoro.selectedTask'), value: t('pomodoro.timerOnly'), changeLabel: t('pomodoro.linkTask'), markDone: null });
        const picker = value(host.getPomodoroTaskPicker({ offset: 0, limit: 50 }));
        expect(picker.items.map((item) => item.id)).toEqual(['a', 'b']);
        expect(value(await action(host, picker.items[1].action)).panel.link).toMatchObject({ value: 'Task b', changeLabel: t('common.change'),
            markDone: { label: t('pomodoro.taskDoneShort'), action: { type: 'markDone', taskId: 'b' } } });
        expect(value(host.getPomodoroTaskPicker({ offset: 1, limit: 1 })).items).toEqual([{ id: 'b', title: 'Task b', selected: true, action: { type: 'selectTask', taskId: 'b' } }]);
        const requestId = generateUUID();
        expect(value(await action(host, { type: 'markDone', taskId: 'b' }, requestId)).changed).toBe(true);
        await flushPendingSave();
        expect(saved?.tasks.find((row) => row.id === 'b')).toMatchObject({ status: 'done', isFocusedToday: false });
        const rev = saved?.tasks.find((row) => row.id === 'b')?.rev;
        expect(value(await action(host, { type: 'markDone', taskId: 'b' })).changed).toBe(false);
        await flushPendingSave();
        expect(saved?.tasks.find((row) => row.id === 'b')?.rev).toBe(rev);
        // A linked task outside the picker's lists (an Inbox task) stays linked (RN's 08e882590).
        expect(value(await action(host, { type: 'selectTask', taskId: 'c' })).panel.link?.value).toBe('Task c');
        value(await action(host, { type: 'selectTask', taskId: 'b' }));
        // A deleted task is no longer a visible task: RN's card drops it.
        await useTaskStore.getState().deleteTask('b');
        expect(value(host.getPomodoroPanel()).link?.value).toBe(t('pomodoro.timerOnly'));
        expect((await action(host, { type: 'markDone', taskId: 'zzz' })).ok).toBe(false);
    });
});

describe('native host contract: a Pomodoro action replayed or retried', () => {
    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
    });

    const storedSession = (props: Record<string, unknown>) => JSON.stringify({
        durations: { focusMinutes: 50, breakMinutes: 10 },
        timerState: { phase: 'break', remainingSeconds: 400, isRunning: false, completedFocusSessions: 1 },
        selectedTaskId: 'a', updatedAtMs: NOW - 60_000, ...props,
    });

    it('loads the stored session before a replayed action runs (the boot replays before the Pomodoro start)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const settings = { ...POMODORO_ON, gtd: { pomodoro: { linkTask: true } } } as AppSettings;
        const device = new Map([[POMODORO_SESSION_STORAGE_KEY, storedSession({})]]);
        const reset = await openHost(settings, { tasks: [task('a')], device });
        value(await action(reset.host, { type: 'reset' }));
        expect(JSON.parse(device.get(POMODORO_SESSION_STORAGE_KEY)!)).toMatchObject({
            durations: { focusMinutes: 50, breakMinutes: 10 }, timerState: { phase: 'break', remainingSeconds: 600, isRunning: false }, selectedTaskId: 'a' });

        device.set(POMODORO_SESSION_STORAGE_KEY, storedSession({ timerState: { phase: 'focus', remainingSeconds: 900, isRunning: true },
            phaseEndsAt: new Date(NOW + 900_000).toISOString() }));
        const pause = await openHost(settings, { tasks: [task('a')], device });
        expect(value(await action(pause.host, { type: 'run', value: false })).changed).toBe(true);
        expect(JSON.parse(device.get(POMODORO_SESSION_STORAGE_KEY)!).timerState).toMatchObject({ phase: 'focus', isRunning: false });

        device.set(POMODORO_COLLAPSED_STORAGE_KEY, 'true');
        const fold = await openHost(settings, { tasks: [task('a')], device });
        expect(value(await action(fold.host, { type: 'collapse', value: false })).changed).toBe(true);
        expect(device.get(POMODORO_COLLAPSED_STORAGE_KEY)).toBe('false');
    });

    it('keeps a session write that failed as an owed save, and stores it on the retry', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const { device } = await openHost(POMODORO_ON);
        let failing = true;
        const setItem = async (key: string, text: string) => {
            if (failing && key === POMODORO_SESSION_STORAGE_KEY) throw new Error('disk full');
            device.set(key, text);
        };
        const failingHost = createNativeHostContract({ pomodoro: { controller: createMobilePomodoroController({
            storage: { getItem: async (key: string) => device.get(key) ?? null, setItem }, logWarn: () => undefined }),
        storage: { getItem: async (key: string) => device.get(key) ?? null, setItem } } });
        value(await failingHost.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' }));
        value(await failingHost.activate({ writeSafetyReady: true }));
        value(await failingHost.startPomodoro());
        const requestId = generateUUID();
        const first = await action(failingHost, { type: 'run', value: true }, requestId);
        // It landed in memory only: the journal keeps it (SAVE_FAILED) and its retry stores the session.
        expect(first.ok ? null : first.error.code).toBe('SAVE_FAILED');
        failing = false;
        expect(value(await action(failingHost, { type: 'run', value: true }, requestId))).toMatchObject({ panel: { running: true } });
        expect(JSON.parse(device.get(POMODORO_SESSION_STORAGE_KEY)!).timerState.isRunning).toBe(true);
    });
});

describe('native host contract: the Pomodoro completion alarm', () => {
    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
    });

    it('arms one alarm at the phase end with RN\'s alert, once; a remake arms it again', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const { host } = await openHost(POMODORO_ON);
        expect(plan(host, null)).toMatchObject({ outcome: 'loading', schedule: [], cancel: [], forgetRn: false });
        value(await host.startPomodoro());
        expect(plan(host, null, { rnEntryStored: true })).toMatchObject({ outcome: 'none', reason: 'timer-not-running', forgetRn: true });
        value(await action(host, { type: 'run', value: true }));
        const t = getTranslator('en');
        const armed = plan(host, null);
        const fireAtMs = NOW + 25 * 60_000;
        expect(armed).toMatchObject({ outcome: 'scheduled', cancel: [], clearEntry: false, forgetRn: false,
            entryAhead: JSON.stringify({ id: NATIVE_POMODORO_ALARM_ID, fireAtMs, phase: 'focus-complete' }) });
        expect(armed.schedule).toEqual([{ key: 'pomodoro', id: NATIVE_POMODORO_ALARM_ID, fireAtMs, repeat: 'once', replacing: null,
            details: expect.objectContaining({ title: t('pomodoro.mobileTitle'), message: t('pomodoro.focusComplete'), channel: 'mindwtr_reminders_v2',
                has_button: false, data: { kind: 'pomodoro', phase: 'focus-complete' } }) }]);
        expect(plan(host, armed.entryAhead)).toMatchObject({ outcome: 'unchanged', schedule: [] });
        expect(plan(host, armed.entryAhead, { remake: true }).schedule).toHaveLength(1);
        // Without the notification permission the alarm and what it showed go.
        expect(plan(host, armed.entryAhead, { permissionGranted: false })).toMatchObject({ outcome: 'cancelled', reason: 'notification-permission-denied',
            cancel: [{ key: 'pomodoro', id: NATIVE_POMODORO_ALARM_ID, reason: 'withdrawn' }], clearEntry: true });
    });

    it('alerts whether or not task reminders are on (RN\'s #528)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const { host } = await openHost({ ...POMODORO_ON, notificationsEnabled: false } as AppSettings);
        value(await host.startPomodoro());
        value(await action(host, { type: 'run', value: true }));
        expect(plan(host, null).outcome).toBe('scheduled');
    });

    it('cancels on pause and when the alert is turned off, and keeps a due alarm when the timer stopped on its own', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const { host } = await openHost({ ...POMODORO_ON, gtd: { pomodoro: { autoStartBreaks: false } } } as AppSettings);
        value(await host.startPomodoro());
        value(await action(host, { type: 'preset', focusMinutes: 15, breakMinutes: 3 }));
        value(await action(host, { type: 'run', value: true }));
        const entry = plan(host, null).entryAhead;
        value(await action(host, { type: 'run', value: false }));
        expect(plan(host, entry)).toMatchObject({ outcome: 'cancelled', reason: 'timer-not-running', cancel: [{ reason: 'withdrawn' }] });

        value(await action(host, { type: 'run', value: true }));
        const running = plan(host, null).entryAhead;
        // The phase ends: the timer stops on its own (no auto-start) and its alarm is due: kept, with what it shows.
        vi.setSystemTime(NOW + 16 * 60_000);
        expect(value(host.getPomodoroPanel()).event).toBe(getTranslator('en')('pomodoro.focusComplete'));
        expect(plan(host, running)).toMatchObject({ outcome: 'preserved', reason: 'timer-not-running', cancel: [] });

        value(await action(host, { type: 'run', value: true }));
        const breakEntry = plan(host, null).entryAhead;
        useTaskStore.setState({ settings: { ...useTaskStore.getState().settings, gtd: { pomodoro: { completionAlert: false } } } } as never);
        expect(plan(host, breakEntry)).toMatchObject({ outcome: 'cancelled', reason: 'completion-alert-off', cancel: [{ reason: 'withdrawn' }] });
    });

    it('applies a queued Watch command through the drain and removes its file', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const { host, controller } = await openHost(POMODORO_ON);
        value(await host.startPomodoro());
        const files = new Map([['timer.json', JSON.stringify({ kind: 'pomodoro', id: 'p1', action: 'start', createdAt: new Date(NOW + 1000).toISOString(), source: 'apple-watch' })]]);
        let record: string | null = null;
        const result = await host.ingestPendingCaptures({
            requestId: generateUUID(),
            queue: { list: async () => [...files.keys()], read: async (name) => files.get(name)!, delete: async (name) => { files.delete(name); } },
            lastApplied: { read: async () => record, write: async (next) => { record = next; } },
        });
        expect(value(result)).toEqual({ ingested: 1 });
        expect(files.size).toBe(0);
        expect(controller.getSnapshot().timerState.isRunning).toBe(true);
    });
});
