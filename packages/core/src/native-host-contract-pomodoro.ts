/**
 * The native host contract for the Pomodoro timer (React Native's components/pomodoro-panel.tsx, lib/pomodoro-controller.ts
 * and hooks/root-layout/use-root-layout-pomodoro.ts): the Focus screen's card, its task picker, its controls, and the
 * completion alarm. Kept in its own file and spread into createNativeHostContract.
 *
 * The host gives core's session controller (pomodoro-controller.ts) on RN's device store: the session stays under
 * POMODORO_SESSION_STORAGE_KEY and the card's fold under POMODORO_COLLAPSED_STORAGE_KEY, RN's keys, so an upgrade keeps
 * both. startPomodoro loads them once the boot's data is in (RN hydrates on canonical data); until then the card shows
 * RN's loading row.
 *
 * Every control's action is the state it asks for (Start or Pause, the phase to switch to, the preset, the task, the
 * fold, Task done), under a request UUID: the request's receipt answers a retry or a replay after a restart, and an
 * action applied again changes nothing more. An action loads the stored session first, and its session write is part of
 * the request's save: one that failed is retried with the request.
 *
 * The completion alarm (planPomodoroAlarm) follows RN's root-layout effect: while the alert is on and the timer runs it
 * fires when the phase ends; it goes when the alert is turned off, the phase end is gone, or notifications are not
 * allowed (what it delivered goes too), or when the timer stops on its own (what it delivered stays, and an alarm whose
 * time already came is kept, as RN keeps a due one). The native host holds one Pomodoro alarm under
 * NATIVE_POMODORO_ALARM_ID, a request code no reminder takes, and keeps its record under
 * NATIVE_POMODORO_ALARM_STORAGE_KEY, which RN never reads; RN's own record (POMODORO_ALARM_STORAGE_KEY) is removed, its
 * alarm having been cancelled with RN's others, so an RN build installed later makes its alarm again.
 *
 * Only functions read this module's imports from native-host-contract.ts, so the import cycle between the two files is safe.
 */
import { tFallback } from './i18n';
import { buildPomodoroAlarmDetails, isExplicitPomodoroAlarmCancellation, isPomodoroAlarmDue, isPomodoroAlarmUnchanged,
    readPomodoroAlarmEntry, shouldRemoveFiredPomodoroAlarm, type PomodoroAlarmEntry } from './mobile-reminder-alarms';
import { fail, isObjectRecord, isText, page } from './native-host-contract-menu-views';
import { NATIVE_HOST_MAX_WINDOW, type NativeHostResult } from './native-host-contract';
import type { NativeReminderAlarm } from './native-host-contract-reminders';
import { createNativeRequestReceipts, runStoreWrite, settleWrite } from './native-request-receipts';
import type { PendingPomodoro } from './pending-captures';
import type { createMobilePomodoroController } from './pomodoro-controller';
import { buildPomodoroPanelModel, isPomodoroLinkedTaskGone, type PomodoroPanelAction, type PomodoroPanelModel } from './pomodoro-panel-model';
import { POMODORO_COLLAPSED_STORAGE_KEY } from './pomodoro-session';
import { resolveFeatureFlags } from './resolve-feature-flags';
import { useTaskStore } from './store';
import type { PomodoroAutoStartOptions } from './pomodoro';
import type { Task } from './types';

type Translate = (key: string) => string;

/** The request code of the native host's one Pomodoro alarm: reminders take [1, 2^31 - 1), so this one is never theirs. */
export const NATIVE_POMODORO_ALARM_ID = 2 ** 31 - 1;
/** RKStorage key of the native host's Pomodoro alarm record (core's PomodoroAlarmEntry); React Native never reads it. */
export const NATIVE_POMODORO_ALARM_STORAGE_KEY = 'mindwtr:native:pomodoro-alarm:v1';
const ALARM_KEY = 'pomodoro';

export type NativePomodoroController = ReturnType<typeof createMobilePomodoroController>;

/** The host's Pomodoro: core's controller on RN's device store, and that store (the card's fold lives beside the session). */
export type NativePomodoroHost = {
    controller: NativePomodoroController;
    storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
};

export type NativePomodoroPanel = PomodoroPanelModel & {
    /** RN's Focus screen shows the card only while the Pomodoro feature is on (Settings › GTD). */
    enabled: boolean;
};

/** The completion alarm's changes, applied in this order: `entryAhead` stored, the plan applied, `clearEntry`, `forgetRn`. */
export type NativePomodoroAlarmPlan = {
    /** The record to store before the alarm is made, so a process death after making it still names it. */
    entryAhead: string | null;
    /** `withdrawn`: what the alarm delivered goes too. `expired`: it stays. */
    cancel: { key: string; id: number; reason: 'withdrawn' | 'expired' }[];
    schedule: NativeReminderAlarm[];
    /** Remove the native record once the plan is applied. */
    clearEntry: boolean;
    /** Remove RN's record (its alarm was cancelled with RN's others). */
    forgetRn: boolean;
    /** What happened, for the log: scheduled, unchanged, preserved, cancelled, none or loading. */
    outcome: 'scheduled' | 'unchanged' | 'preserved' | 'cancelled' | 'none' | 'loading';
    /** RN's reason for a cancellation (completion-alert-off, timer-not-running, no-phase-end, notification-permission-denied). */
    reason: string | null;
};

type PomodoroDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    t: () => Translate;
    requestIdPattern: RegExp;
    host: () => NativePomodoroHost | null;
    /** The picker's tasks for the Focus controls the host shows (getFocus's `controls`); null when they are not valid. */
    pickerTasks: (controls: unknown) => Task[] | null;
};

const autoStartOf = (): PomodoroAutoStartOptions => {
    const pomodoro = useTaskStore.getState().settings.gtd?.pomodoro;
    return { autoStartBreaks: pomodoro?.autoStartBreaks === true, autoStartFocus: pomodoro?.autoStartFocus === true };
};

const TASK_ID_LIMIT = 500;

/** A control's action as a host sends it back; null when it is not one the card offers. */
const readAction = (value: unknown): PomodoroPanelAction | null => {
    if (!isObjectRecord(value)) return null;
    const only = (...keys: string[]) => Object.keys(value).every((key) => key === 'type' || keys.includes(key));
    const minutes = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 180;
    const ok = (() => {
        switch (value.type) {
            case 'run':
            case 'collapse':
                return only('value') && typeof value.value === 'boolean';
            case 'reset': return only();
            case 'phase': return only('value') && (value.value === 'focus' || value.value === 'break');
            case 'preset': return only('focusMinutes', 'breakMinutes') && minutes(value.focusMinutes) && minutes(value.breakMinutes);
            case 'selectTask': return only('taskId') && (value.taskId === null || (isText(value.taskId, TASK_ID_LIMIT) && value.taskId !== ''));
            case 'markDone': return only('taskId') && isText(value.taskId, TASK_ID_LIMIT) && value.taskId !== '';
            default: return false;
        }
    })();
    return ok ? value as PomodoroPanelAction : null;
};

export function createPomodoroMethods(deps: PomodoroDeps) {
    // A session write that failed is an owed save (SAVE_FAILED: the journal keeps the request): its retry stores the session again.
    const receipts = createNativeRequestReceipts({
        save: async (requestId) => {
            try {
                await deps.host()?.controller.retryPersistence();
            } catch {
                return fail('SAVE_FAILED', 'The Pomodoro session was not stored');
            }
            return deps.save(requestId);
        },
    });
    /** The card's fold as stored (RN reads it once when the card mounts; it starts expanded). */
    let collapsed = false;
    let collapsedRead = false;

    /**
     * The stored session and the card's fold, loaded once. Every action loads them first: the boot replays journaled actions
     * before the Pomodoro start, and an action on the unloaded default session would overwrite the stored one.
     */
    const load = async (host: NativePomodoroHost) => {
        await host.controller.ensureHydrated(autoStartOf());
        if (collapsedRead) return;
        try {
            const raw = await host.storage.getItem(POMODORO_COLLAPSED_STORAGE_KEY);
            if (raw !== null) collapsed = raw === 'true';
            collapsedRead = true;
        } catch {
            // RN logs and keeps the card expanded.
        }
    };

    const requireHost = (): NativeHostResult<NativePomodoroHost> => {
        const host = deps.host();
        return host ? { ok: true, value: host } : fail('NOT_READY', 'This host has no Pomodoro timer');
    };

    const panel = (host: NativePomodoroHost): NativePomodoroPanel => {
        const { settings, tasks } = useTaskStore.getState();
        // RN's card ticks its clock from the root layout's one-second reconcile; a read is that tick here.
        host.controller.reconcile(autoStartOf());
        // RN's card drops a linked task that is no longer a visible task while Link task is on.
        if (isPomodoroLinkedTaskGone(host.controller.getSnapshot(), settings, tasks)) host.controller.setSelectedTaskId(undefined);
        return {
            enabled: resolveFeatureFlags(settings).pomodoro,
            ...buildPomodoroPanelModel({ session: host.controller.getSnapshot(), settings, tasks, collapsed, t: deps.t() }),
        };
    };

    return {
        /**
         * Loads the stored session and the card's fold (RN's hydration once canonical data is in, and the card's mount).
         * A session whose phase ended while the app was closed finishes then, as RN's does. Safe to call again.
         */
        async startPomodoro(): Promise<NativeHostResult<{ hydrated: boolean }>> {
            const host = requireHost();
            if (!host.ok) return host;
            await load(host.value);
            return { ok: true, value: { hydrated: !host.value.controller.getSnapshot().isHydrating } };
        },

        /** The Focus screen's Pomodoro card now; read it each second while it shows a running timer. */
        getPomodoroPanel(): NativeHostResult<NativePomodoroPanel> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const host = requireHost();
            if (!host.ok) return host;
            return { ok: true, value: panel(host.value) };
        },

        /**
         * The card's task picker: RN's Focus lists (Today's Focus, Today, Next actions, Review due) for the Focus controls the
         * host shows (`controls`, as getFocus takes them), a window at a time; each row's action links it.
         */
        getPomodoroTaskPicker(input: { controls?: unknown; offset: number; limit: number }): NativeHostResult<{
            total: number;
            items: { id: string; title: string; selected: boolean; action: PomodoroPanelAction }[];
        }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const host = requireHost();
            if (!host.ok) return host;
            if (!isObjectRecord(input) || !Number.isSafeInteger(input.offset) || input.offset < 0
                || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > NATIVE_HOST_MAX_WINDOW) {
                return fail('INVALID_INPUT', 'A valid window is required');
            }
            const tasks = deps.pickerTasks(input.controls);
            if (!tasks) return fail('INVALID_INPUT', 'The Focus controls are not valid');
            const selectedId = host.value.controller.getSnapshot().selectedTaskId;
            return {
                ok: true,
                value: {
                    total: tasks.length,
                    items: page(tasks, input).map((task) => ({
                        id: task.id, title: task.title, selected: task.id === selectedId, action: { type: 'selectTask', taskId: task.id },
                    })),
                },
            };
        },

        /**
         * One control's `action` (the card's or the picker's), under a request UUID. Answers whether anything changed and the
         * card after it. The session is on the device's store before the answer.
         */
        async runPomodoroAction(input: { requestId: string; action: PomodoroPanelAction }): Promise<NativeHostResult<{ changed: boolean; panel: NativePomodoroPanel }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const host = requireHost();
            if (!host.ok) return host;
            const action = isObjectRecord(input) ? readAction(input.action) : null;
            if (!action || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)) {
                return fail('INVALID_INPUT', 'A request UUID and an action the Pomodoro card offers are required');
            }
            const { controller, storage } = host.value;
            return receipts.run(input.requestId, JSON.stringify(['pomodoro', action]), async () => {
                await load(host.value);
                const options = autoStartOf();
                controller.reconcile(options);
                const session = controller.getSnapshot();
                let changed = false;
                if (action.type === 'markDone') {
                    const task = useTaskStore.getState()._tasksById.get(action.taskId);
                    if (!task || task.deletedAt) return fail('TASK_NOT_FOUND', 'The linked task is gone');
                    // RN's onMarkDone: the task done and out of Today's Focus, then the finished-phase line cleared.
                    if (task.status !== 'done' || task.isFocusedToday) {
                        const written = await runStoreWrite(() => useTaskStore.getState().updateTask(action.taskId, { status: 'done', isFocusedToday: false }));
                        if (!written.ok) return settleWrite(written, { changed: true, panel: panel(host.value) });
                        changed = true;
                    }
                    if (session.lastEvent) changed = controller.clearLastEvent() || changed;
                } else if (action.type === 'collapse') {
                    if (collapsed !== action.value) {
                        try {
                            await storage.setItem(POMODORO_COLLAPSED_STORAGE_KEY, String(action.value));
                        } catch {
                            return fail('ACTION_FAILED', 'The Pomodoro card\'s fold was not stored');
                        }
                        collapsed = action.value;
                        changed = true;
                    }
                } else if (action.type === 'run') {
                    if (session.timerState.isRunning !== action.value) changed = controller.toggle(options);
                } else if (action.type === 'phase') {
                    if (session.timerState.phase !== action.value) changed = controller.switchPhase(options);
                } else if (action.type === 'reset') {
                    changed = controller.reset(options);
                } else if (action.type === 'preset') {
                    // RN's preset chip sets its durations and resets the timer, the active chip too.
                    changed = controller.setDurations({ focusMinutes: action.focusMinutes, breakMinutes: action.breakMinutes }, options);
                } else {
                    const taskId = action.taskId ?? undefined;
                    if (session.selectedTaskId !== taskId) changed = controller.setSelectedTaskId(taskId);
                }
                // The receipts' save stores the session before the answer.
                return { ok: true, value: { changed, panel: panel(host.value) } };
            });
        },

        /**
         * A queued Watch command (pending-captures.ts `pomodoro` items), as RN's queue drain applies it: Link task decides
         * whether its task is taken. Null on a host without a timer: the item stays queued.
         */
        pomodoroQueueCommand(): ((command: PendingPomodoro) => Promise<'applied' | 'already-applied' | 'stale'>) | null {
            const host = deps.host();
            if (!host) return null;
            return (command) => host.controller.applyWatchCommand(command, autoStartOf(), {
                linkTaskEnabled: useTaskStore.getState().settings.gtd?.pomodoro?.linkTask === true,
            });
        },

        /**
         * The completion alarm's changes now (RN's useRootLayoutPomodoro and its alarm service). `storedEntry` is the native
         * record as stored, `rnEntryStored` whether RN's record is still there, `remake` true for a process's first plan or a
         * rebuild (Android dropped every alarm on a reboot, a force-stop or revoked exact-alarm access): the alarm is made again
         * even when its record already names it.
         */
        planPomodoroAlarm(input: { storedEntry: string | null; rnEntryStored: boolean; permissionGranted: boolean; remake: boolean }): NativeHostResult<NativePomodoroAlarmPlan> {
            const host = requireHost();
            if (!host.ok) return host;
            if (!isObjectRecord(input) || (input.storedEntry !== null && typeof input.storedEntry !== 'string')
                || typeof input.rnEntryStored !== 'boolean' || typeof input.permissionGranted !== 'boolean' || typeof input.remake !== 'boolean') {
                return fail('INVALID_INPUT', 'The stored records, the permission and remake are required');
            }
            const base = { entryAhead: null, cancel: [], schedule: [], clearEntry: false, forgetRn: input.rnEntryStored, reason: null };
            const snapshot = host.value.controller.getSnapshot();
            if (snapshot.isHydrating) return { ok: true, value: { ...base, forgetRn: false, outcome: 'loading' } };
            let entry: PomodoroAlarmEntry | null;
            try {
                entry = readPomodoroAlarmEntry(input.storedEntry);
            } catch {
                // An unreadable record may still name an armed alarm: it is cancelled or replaced.
                entry = { id: NATIVE_POMODORO_ALARM_ID };
            }
            const nowMs = Date.now();
            const completionAlert = useTaskStore.getState().settings.gtd?.pomodoro?.completionAlert !== false;
            const reason = !completionAlert ? 'completion-alert-off'
                : !snapshot.timerState.isRunning ? 'timer-not-running'
                    : !snapshot.phaseEndsAt ? 'no-phase-end'
                        : !input.permissionGranted ? 'notification-permission-denied' : null;
            if (reason !== null) {
                // A timer that stopped on its own keeps an alarm whose time came: its alert is (about to be) shown.
                if (!isExplicitPomodoroAlarmCancellation(reason) && isPomodoroAlarmDue(entry, nowMs)) {
                    return { ok: true, value: { ...base, outcome: 'preserved', reason } };
                }
                if (!entry) return { ok: true, value: { ...base, outcome: 'none', reason } };
                const id = entry.id ?? NATIVE_POMODORO_ALARM_ID;
                const removeFired = reason === 'notification-permission-denied'
                    || shouldRemoveFiredPomodoroAlarm({ reason, entry, id, requestedAtMs: nowMs });
                return { ok: true, value: { ...base, cancel: [{ key: ALARM_KEY, id, reason: removeFired ? 'withdrawn' : 'expired' }], clearEntry: true,
                    outcome: 'cancelled', reason } };
            }
            const fireAtMs = new Date(snapshot.phaseEndsAt!).getTime();
            const phase = snapshot.timerState.phase === 'focus' ? 'focus-complete' : 'break-complete';
            if (!input.remake && entry?.id === NATIVE_POMODORO_ALARM_ID && isPomodoroAlarmUnchanged(entry, fireAtMs, phase)) {
                return { ok: true, value: { ...base, outcome: 'unchanged' } };
            }
            const t = deps.t();
            const title = tFallback(t, 'pomodoro.mobileTitle', 'Pomodoro Timer');
            const message = snapshot.timerState.phase === 'focus'
                ? tFallback(t, 'pomodoro.focusComplete', 'Focus session complete. Take a short break.')
                : tFallback(t, 'pomodoro.breakComplete', 'Break complete. Ready for the next focus session.');
            const alarm: NativeReminderAlarm = {
                key: ALARM_KEY, id: NATIVE_POMODORO_ALARM_ID, fireAtMs, repeat: 'once', details: buildPomodoroAlarmDetails(title, message, { phase }), replacing: null,
            };
            const next: PomodoroAlarmEntry = { id: NATIVE_POMODORO_ALARM_ID, fireAtMs, phase };
            return { ok: true, value: { ...base, entryAhead: JSON.stringify(next), schedule: [alarm], outcome: 'scheduled' } };
        },
    };
}
