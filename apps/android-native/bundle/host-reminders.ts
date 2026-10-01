/**
 * Reminder alarms on the Android host: core's planner (native-host-contract-reminders.ts) and core's timers, run in the engine as
 * React Native's lib/notification-service-local.ts runs them; Kotlin (Reminders.kt) only applies each plan and reads the
 * notification permission. Every rule is core's:
 *
 * - a cycle plans against the stored alarm map (RN's key in RN's RKStorage) and the permission, and Kotlin applies the plan in
 *   core's order (writeAhead, cancels, alarms, then the map); cycles run one at a time, as RN's queue runs them;
 * - a store change that shouldRescheduleReminderAlarms accepts plans again REMINDER_STORE_RESCHEDULE_DELAY_MS after the last
 *   one (one store subscription; no polling), the capped one-shot window tops up after the plan's topUpDelayMs, and a tap on a
 *   task's or project's notification plans again after REMINDER_NOTIFICATION_EVENT_RESCHEDULE_DELAY_MS;
 * - a rebuild (a reboot dropped every alarm, a clock change, Android just allowed exact alarms) plans with every held alarm marked
 *   pending, core's mark for "not made yet": core makes each again under its own id, which replaces it, and keeps or withdraws what
 *   it delivered by core's reason;
 * - React Native's own alarms are cancelled once (Kotlin's RnAlarmCleanup) before this host's first plan;
 * - none of this runs in sandbox mode, as RN's notification service does not.
 */
import {
    REMINDER_NOTIFICATION_CHANNEL_NAME,
    REMINDER_NOTIFICATION_EVENT_RESCHEDULE_DELAY_MS,
    REMINDER_STORE_RESCHEDULE_DELAY_MS,
    hasActiveMobileNotificationFeature,
    isSandboxMode,
    logInfo,
    logWarn,
    nameNotifyListener,
    shouldRescheduleReminderAlarms,
    useTaskStore,
    type NativeHostResult,
} from '@mindwtr/core';

type ReminderPlan = {
    mode: 'active' | 'inactive' | 'revoked';
    cancel: { reason: 'withdrawn' | 'expired' }[];
    schedule: unknown[];
    alarms: string;
    topUpDelayMs: number | null;
};

export type NativeReminderBindings = {
    /** Core's planReminderAlarms. */
    plan: (input: { storedAlarms: string | null; permissionGranted: boolean }) => Promise<NativeHostResult<ReminderPlan>>;
    /** RN's alarm map as stored (RKStorage). */
    readStored: () => Promise<string | null>;
    /** Kotlin: the notification permission, as RN reads it. */
    permissionGranted: () => boolean;
    /** Kotlin: the plan applied in core's order. */
    apply: (planJson: string) => void;
    /** Kotlin: RN's alarms cancelled and its alarm maps removed; how many were cancelled. */
    cleanupRn: () => number;
};

/** Every held alarm marked pending, so core makes each again under its id; an unreadable map goes as it is (core starts from none). */
const allPending = (stored: string | null): string | null => {
    if (!stored) return stored;
    try {
        const map = JSON.parse(stored) as Record<string, unknown>;
        if (!map || typeof map !== 'object' || Array.isArray(map)) return stored;
        return JSON.stringify(Object.fromEntries(Object.entries(map).map(([key, entry]) => [
            key, entry && typeof entry === 'object' ? { ...(entry as object), pending: true } : entry,
        ])));
    } catch {
        return stored;
    }
};

const log = (message: string, context: Record<string, unknown>, warn = false) => {
    try {
        (warn ? logWarn : logInfo)(`[Local Notifications] ${message}`, { scope: 'notifications', context });
    } catch { /* a diagnostic line must never fail its caller */ }
};

export const createNativeReminders = (bindings: NativeReminderBindings) => {
    let started = false;
    let rnCancelled: number | null = null;
    let queue: Promise<unknown> = Promise.resolve();
    let storeTimer: ReturnType<typeof setTimeout> | null = null;
    let topUpTimer: ReturnType<typeof setTimeout> | null = null;
    let eventTimer: ReturnType<typeof setTimeout> | null = null;

    const runCycle = async (rebuild: boolean) => {
        // RN's alarms go before the first plan; until that succeeds no plan runs (the next cycle tries again).
        if (rnCancelled === null) rnCancelled = bindings.cleanupRn();
        const stored = await bindings.readStored();
        const permissionGranted = bindings.permissionGranted();
        const result = await bindings.plan({ storedAlarms: rebuild ? allPending(stored) : stored, permissionGranted });
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        const plan = result.value;
        // Nothing to make, cancel or store: the stored map already says it (none stored reads as an empty map).
        const unchanged = plan.schedule.length === 0 && plan.cancel.length === 0 && (plan.alarms === stored || (stored === null && plan.alarms === '{}'));
        bindings.apply(JSON.stringify({ ...plan, channelName: REMINDER_NOTIFICATION_CHANNEL_NAME, unchanged }));
        if (topUpTimer) clearTimeout(topUpTimer);
        topUpTimer = plan.topUpDelayMs === null ? null : setTimeout(() => {
            topUpTimer = null;
            enqueue(false);
        }, plan.topUpDelayMs);
        const summary = {
            mode: plan.mode,
            rebuild,
            scheduled: plan.schedule.length,
            withdrawn: plan.cancel.filter((item) => item.reason === 'withdrawn').length,
            expired: plan.cancel.filter((item) => item.reason === 'expired').length,
            held: Object.keys(JSON.parse(plan.alarms) as object).length,
        };
        log('Native Android reminder cycle', summary);
        return summary;
    };

    /** One cycle after the ones queued before it (RN's queueRescheduleCycle); the queue itself never rejects. */
    const cycle = (rebuild: boolean) => {
        const next = queue.catch(() => undefined).then(() => runCycle(rebuild));
        queue = next.catch(() => undefined);
        return next;
    };
    const enqueue = (rebuild: boolean) => {
        cycle(rebuild).catch((error) => log('Native Android reminder cycle failed', { error: error instanceof Error ? error.message : String(error) }, true));
    };

    return {
        /**
         * The first cycle, then core's store-change timer. `ask`: RN would ask for the notification permission now (a reminder
         * feature is on and notifications are not allowed). Later calls run one more cycle, as RN's start does once started.
         */
        async start() {
            if (isSandboxMode()) return { mode: 'sandbox', ask: false };
            const first = await cycle(false);
            if (!started) {
                started = true;
                useTaskStore.subscribe(nameNotifyListener('notification-reschedule', (state, previous) => {
                    if (!shouldRescheduleReminderAlarms(state, previous)) return;
                    if (storeTimer) clearTimeout(storeTimer);
                    storeTimer = setTimeout(() => {
                        storeTimer = null;
                        enqueue(false);
                    }, REMINDER_STORE_RESCHEDULE_DELAY_MS);
                }));
            }
            const active = hasActiveMobileNotificationFeature(useTaskStore.getState().settings);
            const permissionGranted = bindings.permissionGranted();
            return { ...first, rnCancelled, active, permissionGranted, ask: active && !permissionGranted };
        },
        /** One cycle now (a resume, Done, a reboot or a clock change); `rebuild` remakes every alarm. */
        async cycle(rebuild: boolean) {
            if (isSandboxMode()) return { mode: 'sandbox' };
            return cycle(rebuild);
        },
        /** A tap on a task's or project's notification: one cycle shortly after (RN's notification event re-arm). */
        event() {
            if (isSandboxMode()) return;
            if (eventTimer) clearTimeout(eventTimer);
            eventTimer = setTimeout(() => {
                eventTimer = null;
                enqueue(false);
            }, REMINDER_NOTIFICATION_EVENT_RESCHEDULE_DELAY_MS);
        },
    };
};

export type NativeReminders = ReturnType<typeof createNativeReminders>;
