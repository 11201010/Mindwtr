/**
 * The Pomodoro timer's engine side on the Android host, as React Native's hooks/root-layout/use-root-layout-pomodoro.ts runs
 * it: once the boot's data is in, the stored session loads (core's startPomodoro); while the timer runs it is reconciled each
 * second (a phase that ends starts the next one or stops, and credits its task); and whenever the timer's run, phase end or
 * the completion alert changes, core plans the completion alarm again (core's planPomodoroAlarm) and Kotlin applies the plan
 * as it applies a reminder plan (Reminders.kt). Every rule is core's (native-host-contract-pomodoro.ts):
 *
 * - the native record goes to RKStorage before the alarm is made, and goes after it is cancelled, so a process death leaves
 *   no alarm without its record; the process's first plan, and a rebuild, makes the alarm again (Android drops alarms on a
 *   reboot, a force-stop or revoked exact-alarm access);
 * - React Native's record goes once its alarm was cancelled with RN's others (Kotlin's RnAlarmCleanup, before the first
 *   reminder plan), so an RN build installed later makes its alarm again;
 * - none of this runs in sandbox mode, as RN's hook does not.
 */
import {
    REMINDER_NOTIFICATION_CHANNEL_NAME,
    isSandboxMode,
    logInfo,
    logWarn,
    nameNotifyListener,
    useTaskStore,
    type NativeHostResult,
    type NativePomodoroAlarmPlan,
    type NativePomodoroController,
} from '@mindwtr/core';

export type NativePomodoroBindings = {
    controller: NativePomodoroController;
    /** Core's startPomodoro: the stored session and the card's fold loaded. */
    start: () => Promise<NativeHostResult<{ hydrated: boolean }>>;
    plan: (input: { storedEntry: string | null; rnEntryStored: boolean; permissionGranted: boolean; remake: boolean }) => NativeHostResult<NativePomodoroAlarmPlan>;
    /** The native record and RN's record, as stored (RKStorage). */
    readStored: () => Promise<{ entry: string | null; rnEntry: string | null }>;
    /** The native record stored (null removes it), on disk when it resolves. */
    storeEntry: (entry: string | null) => Promise<void>;
    /** RN's record removed. */
    forgetRn: () => Promise<void>;
    /** Kotlin: the notification permission, as RN reads it. */
    permissionGranted: () => boolean;
    /** Kotlin: the plan applied as a reminder plan (ReminderPlan.apply). */
    apply: (planJson: string) => void;
};

const TICK_MS = 1_000;

const log = (message: string, context: Record<string, unknown>, warn = false) => {
    try {
        (warn ? logWarn : logInfo)(`[Local Notifications] ${message}`, { scope: 'pomodoro', context });
    } catch { /* a diagnostic line must never fail its caller */ }
};

const autoStart = () => {
    const pomodoro = useTaskStore.getState().settings.gtd?.pomodoro;
    return { autoStartBreaks: pomodoro?.autoStartBreaks === true, autoStartFocus: pomodoro?.autoStartFocus === true };
};

export const createNativePomodoro = (bindings: NativePomodoroBindings) => {
    let started = false;
    let remade = false;
    let queue: Promise<unknown> = Promise.resolve();
    let tick: ReturnType<typeof setTimeout> | null = null;
    let lastKey = '';

    /** What RN's alarm effect follows: the session's load, run, phase and phase end, and the completion alert. */
    const alarmKey = () => {
        const { isHydrating, phaseEndsAt, timerState } = bindings.controller.getSnapshot();
        const alert = useTaskStore.getState().settings.gtd?.pomodoro?.completionAlert !== false;
        return JSON.stringify([isHydrating, phaseEndsAt ?? null, timerState.phase, timerState.isRunning, alert]);
    };

    const runCycle = async (remake: boolean) => {
        const stored = await bindings.readStored();
        const result = bindings.plan({ storedEntry: stored.entry, rnEntryStored: stored.rnEntry !== null,
            permissionGranted: bindings.permissionGranted(), remake: remake || !remade });
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        const plan = result.value;
        if (plan.outcome === 'loading') return plan.outcome;
        if (plan.entryAhead !== null) await bindings.storeEntry(plan.entryAhead);
        if (plan.cancel.length > 0 || plan.schedule.length > 0) {
            bindings.apply(JSON.stringify({ mode: 'active', cancel: plan.cancel, schedule: plan.schedule, writeAhead: null, stateAhead: null,
                unchanged: true, state: null, clearDelivered: false, channelName: REMINDER_NOTIFICATION_CHANNEL_NAME }));
        }
        if (plan.clearEntry) await bindings.storeEntry(null);
        if (plan.forgetRn) await bindings.forgetRn();
        remade = true;
        if (plan.outcome !== 'unchanged' && plan.outcome !== 'none') {
            log('Native Android pomodoro alarm', { outcome: plan.outcome, reason: plan.reason ?? '', forgotRn: String(plan.forgetRn) });
        }
        return plan.outcome;
    };

    /** One plan after what was queued before it; the queue itself never rejects. */
    const cycle = (remake: boolean) => {
        const next = queue.catch(() => undefined).then(() => runCycle(remake));
        queue = next.catch(() => undefined);
        return next;
    };
    const enqueue = (remake: boolean) => {
        cycle(remake).catch((error) => log('Native Android pomodoro alarm failed', { error: error instanceof Error ? error.message : String(error) }, true));
    };

    /** RN's one-second reconcile, armed only while the timer runs (a stopped timer's reconcile changes nothing). */
    const follow = () => {
        const key = alarmKey();
        if (key !== lastKey) {
            lastKey = key;
            enqueue(false);
        }
        const running = bindings.controller.getSnapshot().timerState.isRunning;
        if (running && tick === null) {
            tick = setTimeout(function reconcile() {
                tick = null;
                try {
                    bindings.controller.reconcile(autoStart());
                } catch (error) {
                    log('Native Android pomodoro reconcile failed', { error: error instanceof Error ? error.message : String(error) }, true);
                }
                follow();
            }, TICK_MS);
        } else if (!running && tick !== null) {
            clearTimeout(tick);
            tick = null;
        }
    };

    return {
        /** After the reminders' start (RN's alarms are cancelled by then): the session loads, then the first plan remakes the alarm. */
        async start() {
            if (isSandboxMode()) return { mode: 'sandbox' };
            if (!started) {
                started = true;
                bindings.controller.subscribe(() => follow());
                useTaskStore.subscribe(nameNotifyListener('pomodoro-alarm', (state, previous) => {
                    if (state.settings !== previous.settings) follow();
                }));
            }
            const loaded = await bindings.start();
            if (!loaded.ok) throw new Error(`${loaded.error.code}: ${loaded.error.message}`);
            lastKey = alarmKey();
            const outcome = await cycle(false);
            follow();
            return { mode: 'active', outcome };
        },
        /** One plan now: a resume (the permission may have changed), or a rebuild that makes the alarm again. */
        async cycle(remake: boolean) {
            if (isSandboxMode() || !started) return { mode: 'idle' };
            return { mode: 'active', outcome: await cycle(remake) };
        },
    };
};

export type NativePomodoro = ReturnType<typeof createNativePomodoro>;
