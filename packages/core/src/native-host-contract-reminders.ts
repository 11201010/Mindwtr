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
 *   A cancel whose `reason` is `withdrawn`, and a schedule `replacing` a withdrawn alarm,
 *   first removes the notification that alarm delivered; an `expired` one keeps it.
 *   A stop anywhere in between is safe: the next plan, from whichever string was stored,
 *   makes each pending alarm again under the same id and cancels the ones no longer
 *   requested, so no alarm is made twice or left behind. A pending alarm that replaces a
 *   held one keeps the held one's signature in `writeAhead`, so the replay still knows
 *   what that alarm delivered and whether it was withdrawn. Plan again after `topUpDelayMs`,
 *   and REMINDER_STORE_RESCHEDULE_DELAY_MS after the last store change that
 *   shouldRescheduleReminderAlarms accepts. Without notification permission, every alarm
 *   is cancelled and `clearDelivered` asks the host to remove delivered reminders too.
 *   The map lives under React Native's key, with each signature marked as the native
 *   host's: a React Native build installed over the native app (a recovery build) holds
 *   none of these alarms, finds no signature of its own, and makes every alarm again.
 *   A task or project reminder whose alarm expires (its time passed, so it may sit in the
 *   tray) is remembered in the native host's own state (`storedState`, stored with `alarms`)
 *   for up to 30 days, by core's rule for a held alarm: once its task or project would no
 *   longer give it (done, gone, moved, its reminders off), a cancel `withdrawn` removes what
 *   it delivered. Its id stays taken meanwhile.
 * - completeReminderTask: Done. Completes the task through the store once per request
 *   UUID (native-request-receipts.ts). On the native host the receipt commits with the
 *   task's change, so a replay after a restart answers from the first reply and writes
 *   nothing, even if the task was reopened since: a recurring task gets one next instance.
 * - snoozeReminder: Snooze. The fired alarm's details again, `snooze_interval` minutes
 *   after the tap, as an alarm of its own that no plan cancels (it can still fire after
 *   the task is done: a kept trade-off). The request UUID names it, and its first reply is
 *   a receipt, so a replay after a restart returns the same alarm and the host replaces it
 *   instead of adding one.
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
    getActiveCancelReason,
    getReminderAlarmCancelReason,
    MAX_PENDING_ONE_SHOT_REMINDER_ALARMS,
    planReminderAlarms,
    readReminderAlarmMap,
    writeReminderAlarmMap,
    type ReminderAlarmCancelReason,
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
    /** The held alarm this one replaces goes for this reason; null when none is held. */
    replacing: ReminderAlarmCancelReason | null;
};

export type NativeReminderAlarmPlan = {
    mode: ReminderAlarmPlan['mode'];
    /** `withdrawn`: remove what the alarm delivered too. `expired`: keep it. */
    cancel: { key: string; id: number; reason: ReminderAlarmCancelReason }[];
    schedule: NativeReminderAlarm[];
    /** Store before applying: the held alarms plus each alarm about to be made, marked pending. Null when nothing is made. */
    writeAhead: string | null;
    /** Store after applying. */
    alarms: string;
    /** The native host's own reminder state (delivered reminders it may still withdraw): store with `alarms`. */
    state: string;
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

/**
 * Marks each signature in the stored map as the native host's. React Native's planner keeps a
 * held alarm only when its signature matches, so it keeps none of these.
 */
const NATIVE_SIGNATURE_MARK = 'native:';

/** The stored map, with only the native host's signatures; one without the mark is made again. Throws on unreadable JSON. */
const readNativeAlarmMap = (raw: string | null): Map<string, ReminderAlarmEntry> => new Map(Array.from(readReminderAlarmMap(raw), ([key, entry]) => {
    const { signature, ...rest } = entry;
    return [key, signature?.startsWith(NATIVE_SIGNATURE_MARK) ? { ...rest, signature: signature.slice(NATIVE_SIGNATURE_MARK.length) } : rest];
}));

const writeNativeAlarmMap = (map: ReadonlyMap<string, ReminderAlarmEntry>): string => writeReminderAlarmMap(new Map(Array.from(map, ([key, entry]) => (
    [key, entry.signature === undefined ? entry : { ...entry, signature: `${NATIVE_SIGNATURE_MARK}${entry.signature}` }]
))));

/** RKStorage key of the native host's own reminder state; React Native never reads it. */
export const NATIVE_REMINDER_STATE_STORAGE_KEY = 'mindwtr:native:reminders:v1';
const DELIVERED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** A task or project reminder whose alarm expired: what it delivered may still be in the tray, under `id`. */
type DeliveredReminder = { kind: 'delivered'; id: number; signature?: string; firedAtMs: number };
type NativeReminderState = Map<string, DeliveredReminder>;

/** The stored state; an unreadable one is empty (it names only notifications that may be gone already). */
const readNativeReminderState = (raw: string | null | undefined): NativeReminderState => {
    const state: NativeReminderState = new Map();
    if (!raw) return state;
    try {
        for (const [key, entry] of Object.entries(JSON.parse(raw) as Record<string, Partial<DeliveredReminder>>)) {
            if (entry?.kind === 'delivered' && Number.isInteger(entry.id) && Number.isFinite(entry.firedAtMs)) {
                state.set(key, { kind: 'delivered', id: entry.id!, firedAtMs: entry.firedAtMs!, ...(typeof entry.signature === 'string' ? { signature: entry.signature } : {}) });
            }
        }
    } catch (error) {
        void logWarn('Stored native reminder state unreadable; starting from none', { scope: 'notifications', error });
    }
    return state;
};

const signedFireAtMs = (signature: string | undefined): number | null => {
    try {
        const fireAtMs = Date.parse((JSON.parse(signature ?? '') as { fireAt?: string }).fireAt ?? '');
        return Number.isFinite(fireAtMs) ? fireAtMs : null;
    } catch {
        return null;
    }
};

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
        async planReminderAlarms(input: { storedAlarms: string | null; permissionGranted: boolean; storedState?: string | null }): Promise<NativeHostResult<NativeReminderAlarmPlan>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || (input.storedAlarms !== null && typeof input.storedAlarms !== 'string') || typeof input.permissionGranted !== 'boolean'
                || (input.storedState != null && typeof input.storedState !== 'string')) {
                return fail('INVALID_INPUT', 'The stored alarm map (a string or null) and the notification permission are required');
            }
            let held: Map<string, ReminderAlarmEntry>;
            try {
                held = readNativeAlarmMap(input.storedAlarms);
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
            const nowMs = Date.now();
            // Delivered reminders it remembers: withdrawn by core's rule for a held alarm, else kept (up to 30 days), their ids taken.
            const judge = plan.mode === 'active'
                ? { diagnostics: plan.diagnostics, tasks: new Map(state.tasks.map((task) => [task.id, task])), projects: new Map(state.projects.map((project) => [project.id, project])) }
                : null;
            const remembered: NativeReminderState = new Map();
            const withdrawnDelivered: NativeReminderAlarmPlan['cancel'] = [];
            for (const [key, entry] of readNativeReminderState(input.storedState)) {
                if (nowMs - entry.firedAtMs > DELIVERED_RETENTION_MS) continue;
                if (!judge || getActiveCancelReason(key, entry, false, judge) === 'withdrawn') withdrawnDelivered.push({ key, id: entry.id, reason: 'withdrawn' });
                else remembered.set(key, entry);
            }
            const taken = new Set([...held.values(), ...remembered.values()].map((entry) => entry.id));
            const next = new Map(held);
            const writeAhead = new Map(held);
            const schedule: NativeReminderAlarm[] = [];
            for (const key of plan.schedule) {
                const request = requests.get(key);
                if (!request) continue;
                const heldEntry = held.get(key);
                const id = heldEntry?.id ?? allocateAlarmId(key, taken, REMINDER_ID_BASE);
                taken.add(id);
                const fireAt = new Date(request.config.fireAt);
                fireAt.setMilliseconds(0);
                schedule.push({
                    key,
                    id,
                    fireAtMs: fireAt.getTime(),
                    repeat: request.config.repeatInterval ?? 'once',
                    details: buildReminderAlarmDetails(key, request.config),
                    replacing: heldEntry ? getReminderAlarmCancelReason(plan, key) : null,
                });
                next.set(key, { id, signature: request.signature });
                writeAhead.set(key, { id, signature: heldEntry ? heldEntry.signature : request.signature, pending: true });
            }
            const cancel = plan.cancel.flatMap((key) => {
                const entry = held.get(key);
                next.delete(key);
                if (!entry) return [];
                const reason = getReminderAlarmCancelReason(plan, key);
                if (reason === 'expired' && (key.startsWith('task:') || key.startsWith('project:'))) {
                    remembered.set(key, { kind: 'delivered', id: entry.id, ...(entry.signature ? { signature: entry.signature } : {}), firedAtMs: signedFireAtMs(entry.signature) ?? nowMs });
                }
                return [{ key, id: entry.id, reason }];
            });
            return {
                ok: true,
                value: {
                    mode: plan.mode,
                    cancel: [...cancel, ...withdrawnDelivered],
                    schedule,
                    writeAhead: schedule.length > 0 ? writeNativeAlarmMap(writeAhead) : null,
                    alarms: writeNativeAlarmMap(next),
                    state: JSON.stringify(Object.fromEntries(remembered)),
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
        async snoozeReminder(input: { requestId: string; requestedAt: number; details: Record<string, unknown> }): Promise<NativeHostResult<NativeReminderAlarm>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)
                || typeof input.requestedAt !== 'number' || !isObjectRecord(input.details) || !isText(input.details.title, 10_000)) {
                return fail('INVALID_INPUT', 'A request UUID, the tap time and the fired alarm\'s details are required');
            }
            const key = `snooze:${input.requestId.toLowerCase()}`;
            const snooze = buildReminderSnooze(input.details, input.requestedAt, key);
            if (!snooze) return fail('INVALID_INPUT', 'This reminder has no Snooze');
            const alarm: NativeReminderAlarm = { ...snooze, id: allocateAlarmId(key, new Set(), SNOOZE_ID_BASE), repeat: 'once', replacing: null };
            return receipts.run<NativeReminderAlarm>(input.requestId, JSON.stringify(['reminderSnooze', input.requestedAt, input.details]), async () => (
                { ok: true, value: alarm }
            ));
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
