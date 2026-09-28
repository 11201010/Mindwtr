/**
 * The native host contract for reminder alarms and notification taps, from core's
 * mobile-reminder-alarms.ts and mobile-notification-open.ts. Kept in its own file and
 * spread into createNativeHostContract. The host does the platform IO (AlarmManager, the
 * notification, storing one string); every decision is core's.
 *
 * - planReminderAlarms: the alarms to cancel and to make for the store now, against the
 *   stored alarm map (the `alarms` string this method returned last time, or null). Apply
 *   it in this order: store `writeAhead` when it is not null, cancel each `cancel` id, make
 *   each `schedule` alarm (an alarm made under a held id replaces it), then store `alarms`.
 *   A stop anywhere in between is safe: the next plan, from whichever string was stored,
 *   makes each pending alarm again under the same id and cancels the ones no longer
 *   requested, so no alarm is made twice or left behind. Plan again after `topUpDelayMs`,
 *   and REMINDER_STORE_RESCHEDULE_DELAY_MS after the last store change that
 *   shouldRescheduleReminderAlarms accepts. Without notification permission, every alarm
 *   is cancelled and `clearDelivered` asks the host to remove delivered reminders too.
 * - completeReminderTask: Done. Completes the task through the store once per request
 *   UUID (native-request-receipts.ts). A replay after a restart finds the task done and
 *   writes nothing, so a recurring task never gets a second next instance.
 * - snoozeReminder: Snooze. The fired alarm's details again, `snooze_interval` minutes
 *   after the tap, as an alarm of its own that no plan cancels (it can still fire after
 *   the task is done: a kept trade-off). The request UUID and the tap time name it, so a
 *   replay returns the same alarm and the host replaces it instead of adding one.
 * - routeNotificationOpen: what a tap opens (Review, a task, a project, a context, Daily
 *   or Weekly Review), or `complete` for Done, or nothing for Dismiss and Snooze.
 *
 * Only functions read this module's imports from native-host-contract.ts, so the import
 * cycle between the two files is safe.
 */
import { loadTranslations } from './i18n/i18n-loader';
import type { Language } from './i18n/i18n-types';
import { logWarn } from './logger';
import {
    buildReminderAlarmDetails,
    buildReminderSnooze,
    MAX_PENDING_ONE_SHOT_REMINDER_ALARMS,
    planReminderAlarms,
    readReminderAlarmMap,
    writeReminderAlarmMap,
    type ReminderAlarmEntry,
    type ReminderAlarmPlan,
} from './mobile-reminder-alarms';
import {
    getReminderCompletionBlocker,
    REMINDER_COMPLETE_UPDATE,
    resolveNotificationOpenRoute,
    type NotificationOpenRoute,
    type ReminderCompletionBlocker,
} from './mobile-notification-open';
import type { NativeHostResult } from './native-host-contract';
import { fail, isObjectRecord, isText } from './native-host-contract-menu-views';
import { createNativeRequestReceipts, runStoreWrite, settleWrite } from './native-request-receipts';
import { useTaskStore } from './store';

export type NativeReminderAlarm = {
    key: string;
    /** The alarm's request code: a held key keeps its id, so making it again replaces it. */
    id: number;
    fireAtMs: number;
    /** `daily` and `weekly` alarms fire again at the same local time. */
    repeat: 'once' | 'daily' | 'weekly';
    /** What the notification shows and carries (React Native's alarm details: title, message, channel, buttons, data). */
    details: Record<string, unknown>;
};

export type NativeReminderAlarmPlan = {
    mode: ReminderAlarmPlan['mode'];
    cancel: { key: string; id: number }[];
    schedule: NativeReminderAlarm[];
    /** Store before applying: the held alarms plus each alarm about to be made, marked pending. Null when nothing is made. */
    writeAhead: string | null;
    /** Store after applying. */
    alarms: string;
    /** Plan again after this long so the capped one-shot window tops up; null when no one-shot is armed. */
    topUpDelayMs: number | null;
    /** No notification permission: remove every delivered reminder notification too. */
    clearDelivered: boolean;
};

export type ReminderCompletion = { changed: boolean; outcome: 'completed' | ReminderCompletionBlocker };

type ReminderDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    language: () => Language;
    requestIdPattern: RegExp;
};

// Reminder alarms take ids in [1, 2^30), snoozed alarms in [2^30, 2^31 - 1), so the two never meet.
const ID_SPAN = 2 ** 30 - 1;
const REMINDER_ID_BASE = 1;
const SNOOZE_ID_BASE = 2 ** 30;
const TASK_ID_LIMIT = 500;

/** A stable id for a key (FNV-1a), stepping past ids already taken. */
const allocateAlarmId = (key: string, taken: Set<number>, base: number): number => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < key.length; index += 1) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    let id = base + ((hash >>> 0) % ID_SPAN);
    while (taken.has(id)) id = base + ((id - base + 1) % ID_SPAN);
    return id;
};

export function createReminderMethods(deps: ReminderDeps) {
    const receipts = createNativeRequestReceipts({
        save: async () => {
            if (useTaskStore.getState().persistenceFailure) {
                try {
                    await useTaskStore.getState().retryPersistence();
                } catch (error) {
                    return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
                }
            }
            return deps.save();
        },
    });
    let taskOpenSequence = 0;

    return {
        /** The alarms to cancel and make now, from the stored alarm map (see the file comment for the order). */
        async planReminderAlarms(input: { storedAlarms: string | null; permissionGranted: boolean }): Promise<NativeHostResult<NativeReminderAlarmPlan>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || (input.storedAlarms !== null && typeof input.storedAlarms !== 'string') || typeof input.permissionGranted !== 'boolean') {
                return fail('INVALID_INPUT', 'The stored alarm map (a string or null) and the notification permission are required');
            }
            let held: Map<string, ReminderAlarmEntry>;
            try {
                held = readReminderAlarmMap(input.storedAlarms);
            } catch (error) {
                // As on React Native: an unreadable map is replaced, since nothing in it can be cancelled.
                void logWarn('Stored reminder alarm map unreadable; starting from none', { scope: 'notifications', error });
                held = new Map();
            }
            const state = useTaskStore.getState();
            const plan = planReminderAlarms({
                settings: state.settings,
                tasks: state.tasks,
                projects: state.projects,
                now: new Date(),
                translations: await loadTranslations(deps.language()),
                maxOneShotReminders: MAX_PENDING_ONE_SHOT_REMINDER_ALARMS.android,
                alarms: held,
                permissionGranted: input.permissionGranted,
            });
            const requests = new Map([...plan.recurring, ...plan.oneShot].map((request) => [request.key, request]));
            const taken = new Set(Array.from(held.values(), (entry) => entry.id));
            const next = new Map(held);
            const writeAhead = new Map(held);
            const schedule: NativeReminderAlarm[] = [];
            for (const key of plan.schedule) {
                const request = requests.get(key);
                if (!request) continue;
                const id = held.get(key)?.id ?? allocateAlarmId(key, taken, REMINDER_ID_BASE);
                taken.add(id);
                const fireAt = new Date(request.config.fireAt);
                fireAt.setMilliseconds(0);
                schedule.push({
                    key,
                    id,
                    fireAtMs: fireAt.getTime(),
                    repeat: request.config.repeatInterval ?? 'once',
                    details: buildReminderAlarmDetails(key, request.config),
                });
                next.set(key, { id, signature: request.signature });
                writeAhead.set(key, { id, signature: request.signature, pending: true });
            }
            const cancel = plan.cancel.flatMap((key) => {
                const entry = held.get(key);
                next.delete(key);
                return entry ? [{ key, id: entry.id }] : [];
            });
            return {
                ok: true,
                value: {
                    mode: plan.mode,
                    cancel,
                    schedule,
                    writeAhead: schedule.length > 0 ? writeReminderAlarmMap(writeAhead) : null,
                    alarms: writeReminderAlarmMap(next),
                    topUpDelayMs: plan.topUpDelayMs,
                    clearDelivered: plan.mode === 'revoked',
                },
            };
        },

        /** Done on a task reminder. Reuse `requestId` to retry; a replay after a restart writes nothing. */
        async completeReminderTask(input: { requestId: string; taskId: string }): Promise<NativeHostResult<ReminderCompletion>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isText(input.taskId, TASK_ID_LIMIT) || !input.taskId) {
                return fail('INVALID_INPUT', 'A request UUID and a task ID are required');
            }
            const taskId = input.taskId;
            return receipts.run<ReminderCompletion>(input.requestId, JSON.stringify(['reminderComplete', taskId]), async () => {
                const blocker = getReminderCompletionBlocker(useTaskStore.getState()._tasksById.get(taskId));
                if (blocker) return { ok: true, value: { changed: false, outcome: blocker } };
                const written = await runStoreWrite(() => useTaskStore.getState().updateTask(taskId, { ...REMINDER_COMPLETE_UPDATE }));
                return settleWrite<ReminderCompletion>(written, { changed: true, outcome: 'completed' });
            });
        },

        /** Snooze on a fired reminder: its details as the plan gave them, and when the tap happened. */
        snoozeReminder(input: { requestId: string; requestedAt: number; details: Record<string, unknown> }): NativeHostResult<NativeReminderAlarm> {
            if (!isObjectRecord(input) || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)
                || typeof input.requestedAt !== 'number' || !isObjectRecord(input.details) || !isText(input.details.title, 10_000)) {
                return fail('INVALID_INPUT', 'A request UUID, the tap time and the fired alarm\'s details are required');
            }
            const key = `snooze:${input.requestId.toLowerCase()}`;
            const snooze = buildReminderSnooze(input.details, input.requestedAt, key);
            if (!snooze) return fail('INVALID_INPUT', 'This reminder has no Snooze');
            return { ok: true, value: { ...snooze, id: allocateAlarmId(key, new Set(), SNOOZE_ID_BASE), repeat: 'once' } };
        },

        /** What a notification tap, or one of its buttons, opens or does. */
        routeNotificationOpen(payload: Record<string, unknown>): NativeHostResult<NotificationOpenRoute> {
            if (!isObjectRecord(payload)) return fail('INVALID_INPUT', 'A notification payload object is required');
            return {
                ok: true,
                value: resolveNotificationOpenRoute(payload, {
                    now: () => Date.now(),
                    nextTaskOpenSequence: () => {
                        taskOpenSequence += 1;
                        return taskOpenSequence;
                    },
                }),
            };
        },
    };
}
