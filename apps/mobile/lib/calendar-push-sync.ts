/**
 * Calendar push sync service.
 *
 * One-way push of scheduled tasks and tasks with due dates into a device
 * calendar (iOS EventKit via expo-calendar). Creates, updates, or removes
 * calendar events as task dates change. Mapping between task IDs and
 * calendar event IDs is persisted in the SQLite calendar_sync table.
 */
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    buildCalendarPushEventFields,
    generateUUID,
    getTaskCalendarOccurrenceDate,
    hasTimeComponent,
    isSandboxMode,
    isProjectedRecurringTask,
    runCalendarPushFullSync,
    nameNotifyListener,
    runCalendarPushPartialSync,
    safeFormatDate,
    safeParseDate,
    resolveFeatureFlags,
    timeEstimateToMinutes,
    useTaskStore,
    type CalendarPushRunPorts,
    type Task,
} from '@mindwtr/core';
import {
    CALENDAR_PUSH_SYNC_CONCURRENCY,
    createCalendarPushScheduler,
} from '@mindwtr/core/calendar-push-scheduler';

import { logInfo, logWarn, logError } from './app-log';
import {
    ensureCalendarSyncStorageReady,
    getCalendarSyncEntry,
    upsertCalendarSyncEntry,
    deleteCalendarSyncEntry,
    getAllCalendarSyncEntries,
} from './storage-adapter';

// MARK: - Constants

const CALENDAR_PUSH_ENABLED_KEY = 'mindwtr:calendar-push-sync:enabled';
const CALENDAR_ID_KEY = 'mindwtr:calendar-push-sync:calendar-id';
const CALENDAR_CREATION_INTENT_KEY = 'mindwtr:calendar-push-sync:creation-intent';
const CALENDAR_TARGET_ID_KEY = 'mindwtr:calendar-push-sync:target-calendar-id';
const CALENDAR_COLOR_KEY = 'mindwtr:calendar-push-sync:color';
const PLATFORM = Platform.OS;
const MANAGED_CALENDAR_TITLE = 'Mindwtr';
const MANAGED_CALENDAR_NAME = 'mindwtr';
const DEFAULT_MANAGED_CALENDAR_COLOR = '#3B82F6';
const PROJECTED_RECURRENCE_EVENT_DATE_FORMAT = 'PP';
const CREATION_TITLE_PATTERN = /^Mindwtr \([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\)$/;

type CalendarCreationIntent = { title: string; calendarId?: string };

async function getCalendarCreationIntent(): Promise<CalendarCreationIntent | null> {
    const raw = await AsyncStorage.getItem(CALENDAR_CREATION_INTENT_KEY);
    if (raw === null) return null;
    let value: CalendarCreationIntent;
    try {
        value = JSON.parse(raw) as CalendarCreationIntent;
    } catch {
        throw new Error('Invalid Mindwtr calendar creation intent');
    }
    if (!value || typeof value.title !== 'string' || !CREATION_TITLE_PATTERN.test(value.title)
        || (value.calendarId !== undefined && (typeof value.calendarId !== 'string' || !value.calendarId.trim()))) {
        throw new Error('Invalid Mindwtr calendar creation intent');
    }
    return value;
}

const setCalendarCreationIntent = (intent: CalendarCreationIntent): Promise<void> =>
    AsyncStorage.setItem(CALENDAR_CREATION_INTENT_KEY, JSON.stringify(intent));

export const CALENDAR_PUSH_COLOR_OPTIONS = [
    '#3B82F6',
    '#2563EB',
    '#7C3AED',
    '#DB2777',
    '#EA580C',
    '#059669',
    '#0891B2',
    '#65A30D',
] as const;

export type CalendarPushTargetCalendar = {
    id: string;
    name: string;
    sourceName?: string;
    color?: string;
    isMindwtrDedicated: boolean;
    isMindwtrManaged: boolean;
    isLocalOnly: boolean;
};

type CalendarPushTarget = {
    id: string;
};

function normalizeCalendarColor(value: string | null | undefined): string {
    const trimmed = value?.trim().toUpperCase() ?? '';
    return CALENDAR_PUSH_COLOR_OPTIONS.includes(trimmed as typeof CALENDAR_PUSH_COLOR_OPTIONS[number])
        ? trimmed
        : DEFAULT_MANAGED_CALENDAR_COLOR;
}

function isReadableAccountName(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0
        && normalized !== MANAGED_CALENDAR_NAME
        && normalized !== 'local account'
        && !normalized.endsWith('@group.calendar.google.com');
}

function getCalendarSourceName(calendar: Calendar.Calendar): string | undefined {
    const ownerAccount = typeof calendar.ownerAccount === 'string' && calendar.ownerAccount.trim().length > 0
        ? calendar.ownerAccount.trim()
        : undefined;
    const sourceName = typeof calendar.source?.name === 'string' && calendar.source.name.trim().length > 0
        ? calendar.source.name.trim()
        : undefined;

    if (sourceName && isReadableAccountName(sourceName)) {
        return sourceName;
    }

    if (ownerAccount && isReadableAccountName(ownerAccount)) {
        return ownerAccount;
    }

    return sourceName ?? ownerAccount;
}

function getCalendarSourceType(calendar: Calendar.Calendar): string | undefined {
    const sourceType = typeof calendar.source?.type === 'string' ? calendar.source.type.trim() : '';
    if (sourceType.length > 0) return sourceType;

    const platformCalendar = calendar as Calendar.Calendar & { type?: unknown };
    const calendarType = typeof platformCalendar.type === 'string' ? platformCalendar.type.trim() : '';
    return calendarType.length > 0 ? calendarType : undefined;
}

function isLocalOnlyCalendar(calendar: Calendar.Calendar): boolean {
    if (calendar.source?.isLocalAccount === true) return true;

    const sourceType = getCalendarSourceType(calendar)?.toLowerCase();
    if (sourceType === 'local') return true;

    const ownerAccount = typeof calendar.ownerAccount === 'string' ? calendar.ownerAccount.trim().toLowerCase() : '';
    const sourceName = typeof calendar.source?.name === 'string' ? calendar.source.name.trim().toLowerCase() : '';
    return ownerAccount === 'local account' && sourceName === 'local account';
}

// MARK: - Settings

export const getCalendarPushEnabled = async (): Promise<boolean> => {
    if (isSandboxMode()) return false;
    const val = await AsyncStorage.getItem(CALENDAR_PUSH_ENABLED_KEY);
    return val === '1';
};

export const setCalendarPushEnabled = async (enabled: boolean): Promise<void> => {
    if (isSandboxMode()) return;
    await AsyncStorage.setItem(CALENDAR_PUSH_ENABLED_KEY, enabled ? '1' : '0');
};

export const getCalendarPushTargetCalendarId = async (): Promise<string | null> => {
    if (isSandboxMode()) return null;
    const value = await AsyncStorage.getItem(CALENDAR_TARGET_ID_KEY);
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
};

export const setCalendarPushTargetCalendarId = async (calendarId: string | null): Promise<void> => {
    if (isSandboxMode()) return;
    const trimmed = calendarId?.trim() ?? '';
    if (trimmed.length === 0) {
        await AsyncStorage.removeItem(CALENDAR_TARGET_ID_KEY);
        return;
    }
    await AsyncStorage.setItem(CALENDAR_TARGET_ID_KEY, trimmed);
};

export const getCalendarPushColor = async (): Promise<string> => {
    if (isSandboxMode()) return DEFAULT_MANAGED_CALENDAR_COLOR;
    const value = await AsyncStorage.getItem(CALENDAR_COLOR_KEY);
    return normalizeCalendarColor(value);
};

export const setCalendarPushColor = async (color: string): Promise<string> => {
    const normalized = normalizeCalendarColor(color);
    if (isSandboxMode()) return normalized;
    await AsyncStorage.setItem(CALENDAR_COLOR_KEY, normalized);
    return normalized;
};

// MARK: - Permission

export const requestCalendarWritePermission = async (): Promise<boolean> => {
    if (isSandboxMode()) return false;
    try {
        const { status } = await Calendar.requestCalendarPermissionsAsync();
        return status === 'granted';
    } catch {
        return false;
    }
};

export const getCalendarWritePermissionStatus = async (): Promise<'granted' | 'denied' | 'undetermined'> => {
    if (isSandboxMode()) return 'undetermined';
    try {
        const { status } = await Calendar.getCalendarPermissionsAsync();
        if (status === 'granted') return 'granted';
        if (status === 'denied') return 'denied';
        return 'undetermined';
    } catch {
        return 'undetermined';
    }
};

// MARK: - Managed Calendar

const getStoredCalendarId = (): Promise<string | null> =>
    AsyncStorage.getItem(CALENDAR_ID_KEY);

const setStoredCalendarId = (id: string): Promise<void> =>
    AsyncStorage.setItem(CALENDAR_ID_KEY, id);

const READ_ONLY_ACCESS_LEVELS = new Set([
    Calendar.CalendarAccessLevel.FREEBUSY,
    Calendar.CalendarAccessLevel.NONE,
    Calendar.CalendarAccessLevel.READ,
    Calendar.CalendarAccessLevel.RESPOND,
    Calendar.CalendarAccessLevel.UNKNOWN,
]);

function getCalendarDisplayName(calendar: Calendar.Calendar): string {
    const legacyName = (calendar as Calendar.Calendar & { name?: string }).name;
    const preferred = typeof calendar.title === 'string' && calendar.title.trim().length > 0
        ? calendar.title
        : typeof legacyName === 'string' && legacyName.trim().length > 0
            ? legacyName
            : 'Calendar';
    return preferred.trim() || 'Calendar';
}

function isWritableCalendar(calendar: Calendar.Calendar): boolean {
    if (calendar.allowsModifications === false) return false;
    if (calendar.accessLevel && READ_ONLY_ACCESS_LEVELS.has(calendar.accessLevel)) return false;
    return true;
}

function isMindwtrNamedCalendar(calendar: Calendar.Calendar): boolean {
    const title = getCalendarDisplayName(calendar).trim().toLowerCase();
    const name = typeof calendar.name === 'string' ? calendar.name.trim().toLowerCase() : '';
    return title === MANAGED_CALENDAR_TITLE.toLowerCase() || name === MANAGED_CALENDAR_NAME;
}

function isStoredMindwtrManagedCalendar(calendar: Calendar.Calendar, storedCalendarId: string | null): boolean {
    return Boolean(storedCalendarId && calendar.id === storedCalendarId);
}

function isAppCreatedMindwtrCalendar(calendar: Calendar.Calendar): boolean {
    const title = getCalendarDisplayName(calendar).trim().toLowerCase();
    const name = typeof calendar.name === 'string' ? calendar.name.trim().toLowerCase() : '';
    return title === MANAGED_CALENDAR_TITLE.toLowerCase() && name === MANAGED_CALENDAR_NAME;
}

export const getCalendarPushTargetCalendars = async (): Promise<CalendarPushTargetCalendar[]> => {
    if (isSandboxMode()) return [];
    try {
        const [storedCalendarId, calendars] = await Promise.all([
            getStoredCalendarId(),
            Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT),
        ]);
        return calendars
            .filter((calendar) =>
                typeof calendar.id === 'string'
                && calendar.id.trim().length > 0
                && isWritableCalendar(calendar)
            )
            .map((calendar) => {
                const isMindwtrDedicated = isMindwtrNamedCalendar(calendar);
                return {
                    id: calendar.id,
                    name: getCalendarDisplayName(calendar),
                    sourceName: getCalendarSourceName(calendar),
                    color: typeof calendar.color === 'string' && calendar.color.trim().length > 0 ? calendar.color : undefined,
                    isMindwtrDedicated,
                    isMindwtrManaged: isStoredMindwtrManagedCalendar(calendar, storedCalendarId),
                    isLocalOnly: isLocalOnlyCalendar(calendar),
                };
            })
            .sort((a, b) => {
                if (a.isMindwtrManaged !== b.isMindwtrManaged) return a.isMindwtrManaged ? -1 : 1;
                if (a.isMindwtrDedicated !== b.isMindwtrDedicated) return a.isMindwtrDedicated ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    } catch (error) {
        void logError(error, { scope: 'calendar-push', extra: { operation: 'getCalendarPushTargetCalendars' } });
        return [];
    }
};

function getAndroidManagedCalendarSeed(
    calendars: Awaited<ReturnType<typeof Calendar.getCalendarsAsync>>,
    color: string
): Parameters<typeof Calendar.createCalendarAsync>[0] | null {
    const ownedCalendar = calendars.find((calendar) =>
        calendar.accessLevel === Calendar.CalendarAccessLevel.OWNER
        && typeof calendar.ownerAccount === 'string'
        && calendar.ownerAccount.trim().length > 0
        && typeof calendar.source?.name === 'string'
        && calendar.source.name.trim().length > 0
    ) ?? calendars.find((calendar) =>
        calendar.allowsModifications
        && typeof calendar.ownerAccount === 'string'
        && calendar.ownerAccount.trim().length > 0
        && typeof calendar.source?.name === 'string'
        && calendar.source.name.trim().length > 0
    );

    if (!ownedCalendar || !ownedCalendar.source) {
        return null;
    }

    return {
        title: MANAGED_CALENDAR_TITLE,
        color,
        entityType: Calendar.EntityTypes.EVENT,
        name: MANAGED_CALENDAR_NAME,
        ownerAccount: ownedCalendar.ownerAccount,
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
        source: {
            name: ownedCalendar.source.name,
            ...(ownedCalendar.source.type ? { type: ownedCalendar.source.type } : {}),
            ...(typeof ownedCalendar.source.isLocalAccount === 'boolean'
                ? { isLocalAccount: ownedCalendar.source.isLocalAccount }
                : {}),
        },
        isVisible: true,
        isSynced: true,
    };
}

/**
 * Returns the ID of the managed "Mindwtr" calendar, creating it if needed.
 * Returns null if the calendar cannot be created (e.g. no permission, no source).
 */
let pendingCalendarEnsure: Promise<string | null> | null = null;
let pendingCalendarDelete: Promise<void> | null = null;
let pendingCalendarColorUpdate: Promise<boolean> | null = null;

export const ensureMindwtrCalendar = (): Promise<string | null> => {
    if (isSandboxMode()) return Promise.resolve(null);
    if (pendingCalendarDelete) return Promise.resolve(null);
    if (pendingCalendarEnsure) return pendingCalendarEnsure;
    const run = ensureMindwtrCalendarUnsafe();
    pendingCalendarEnsure = run;
    void run.then(() => { pendingCalendarEnsure = null; }, () => { pendingCalendarEnsure = null; });
    return run;
};

const ensureMindwtrCalendarUnsafe = async (): Promise<string | null> => {
    try {
        const storedId = await getStoredCalendarId();
        const intent = Platform.OS === 'ios'
            ? await getCalendarCreationIntent()
            : null;
        const allCalendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const storedCalendar = allCalendars.find((calendar) => calendar.id === storedId);
        if (intent) {
            const matches = allCalendars.filter((calendar) => calendar.title === intent.title);
            if (matches.length > 1) return null;
            if (intent.calendarId && matches.some((calendar) => calendar.id !== intent.calendarId)) return null;
            if (storedCalendar && storedCalendar.id !== intent.calendarId) return null;
            const recovered = intent.calendarId
                ? allCalendars.find((calendar) => calendar.id === intent.calendarId)
                : matches[0];
            if (recovered) {
                if (recovered.title !== intent.title && recovered.title !== MANAGED_CALENDAR_TITLE) return null;
                if (!intent.calendarId) {
                    await setCalendarCreationIntent({ ...intent, calendarId: recovered.id });
                }
                await setStoredCalendarId(recovered.id);
                if (recovered.title === intent.title) {
                    await Calendar.updateCalendarAsync(recovered.id, {
                        title: MANAGED_CALENDAR_TITLE,
                        color: recovered.color ?? await getCalendarPushColor(),
                    });
                }
                await AsyncStorage.removeItem(CALENDAR_CREATION_INTENT_KEY);
                void logInfo('Recovered Mindwtr calendar creation', {
                    scope: 'calendar-push',
                    extra: { releaseCheck: 'v1.3.4/ios-calendar-create-recovery' },
                });
                return recovered.id;
            }
            if (intent.calendarId) return null;
        } else if (storedCalendar) {
            return storedCalendar.id;
        }

        const color = await getCalendarPushColor();
        let calendarDetails: Parameters<typeof Calendar.createCalendarAsync>[0];

        if (Platform.OS === 'android') {
            // Android calendars need to be attached to a real device account/source
            // or some calendar providers will keep them hidden from the OS calendar app.
            const androidSeed = getAndroidManagedCalendarSeed(allCalendars, color);
            if (!androidSeed) {
                void logWarn('No owned Android calendar source available; cannot create Mindwtr calendar', {
                    scope: 'calendar-push',
                    extra: { calendarCount: String(allCalendars.length) },
                });
                return null;
            }
            calendarDetails = androidSeed;
        } else {
            // iOS requires a source
            const sources = await Calendar.getSourcesAsync();
            const source =
                sources.find((s) => s.type === Calendar.SourceType.LOCAL) ??
                sources.find((s) => s.type === Calendar.SourceType.CALDAV) ??
                sources[0];

            if (!source) {
                void logWarn('No calendar source available; cannot create Mindwtr calendar', {
                    scope: 'calendar-push',
                });
                return null;
            }

            calendarDetails = {
                title: intent?.title ?? `Mindwtr (${generateUUID()})`,
                color,
                entityType: Calendar.EntityTypes.EVENT,
                sourceId: source.id,
                source,
            };
        }

        if (Platform.OS === 'ios' && !intent) {
            await setCalendarCreationIntent({ title: calendarDetails.title! });
        }

        const newId = await Calendar.createCalendarAsync(calendarDetails);

        if (Platform.OS === 'ios') {
            await setCalendarCreationIntent({ title: calendarDetails.title!, calendarId: newId });
        }
        await setStoredCalendarId(newId);
        if (Platform.OS === 'ios') {
            await Calendar.updateCalendarAsync(newId, { title: MANAGED_CALENDAR_TITLE, color });
            await AsyncStorage.removeItem(CALENDAR_CREATION_INTENT_KEY);
        }
        void logInfo('Created Mindwtr calendar', {
            scope: 'calendar-push',
            extra: { calendarId: newId },
        });
        return newId;
    } catch (error) {
        void logError(error, { scope: 'calendar-push', extra: { operation: 'ensureMindwtrCalendar' } });
        return null;
    }
};

export const updateMindwtrCalendarColor = (color: string): Promise<boolean> => {
    if (isSandboxMode()) return Promise.resolve(false);
    if (Platform.OS === 'ios') {
        const previous = pendingCalendarColorUpdate;
        const run = (async () => {
            if (previous) await previous;
            return updateMindwtrCalendarColorUnsafe(color);
        })();
        pendingCalendarColorUpdate = run;
        void run.then(
            () => { if (pendingCalendarColorUpdate === run) pendingCalendarColorUpdate = null; },
            () => { if (pendingCalendarColorUpdate === run) pendingCalendarColorUpdate = null; },
        );
        return run;
    }
    return updateMindwtrCalendarColorUnsafe(color);
};

const updateMindwtrCalendarColorUnsafe = async (color: string): Promise<boolean> => {
    const normalized = await setCalendarPushColor(color);
    try {
        if (pendingCalendarDelete) return false;
        if (pendingCalendarEnsure) await pendingCalendarEnsure;
        if (pendingCalendarDelete) return false;
        if (typeof Calendar.updateCalendarAsync !== 'function') return false;
        const storedCalendarId = await getStoredCalendarId();
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const target = calendars.find((calendar) => storedCalendarId && calendar.id === storedCalendarId)
            ?? (Platform.OS === 'android' ? calendars.find(isAppCreatedMindwtrCalendar) : undefined);
        if (!target || !isWritableCalendar(target)) return false;

        // Android's CalendarProvider only stores a calendar's color at creation
        // time, and expo-calendar's update path never writes CALENDAR_COLOR, so
        // updating it in place never reaches third-party calendar apps (#726).
        // Recreate the managed calendar with the freshly stored color instead.
        if (Platform.OS === 'android') {
            return await recreateManagedMindwtrCalendar();
        }

        const finalizePending = Platform.OS === 'ios' && await getCalendarCreationIntent();
        if (pendingCalendarDelete) return false;
        if (finalizePending) {
            if (await ensureMindwtrCalendar() !== target.id) return false;
        }
        await Calendar.updateCalendarAsync(target.id, {
            title: finalizePending ? MANAGED_CALENDAR_TITLE : getCalendarDisplayName(target),
            color: normalized,
        });
        return true;
    } catch (error) {
        void logWarn('Failed to update Mindwtr calendar color', {
            scope: 'calendar-push',
            extra: { error: getCalendarErrorMessage(error) },
        });
        return false;
    }
};

/**
 * Deletes and recreates the managed "Mindwtr" calendar so a color change takes
 * effect on Android. The provider ignores post-creation color updates, so the
 * only way to change the color third-party calendar apps render is to drop the
 * calendar and create a fresh one with the already-stored color, then re-push
 * its events. Serialized on the calendar sync queue so it cannot race a
 * concurrent push and duplicate events (#743). Returns true when a new managed
 * calendar was created.
 */
async function recreateManagedMindwtrCalendar(): Promise<boolean> {
    let recreatedId: string | null = null;
    await enqueueCalendarSync(async () => {
        await deleteMindwtrCalendar();
        recreatedId = await ensureMindwtrCalendar();
        if (!recreatedId) return;
        await runFullCalendarSyncUnsafe();
    });
    return recreatedId !== null;
}

async function resolveCalendarPushTarget(): Promise<CalendarPushTarget | null> {
    const selectedId = await getCalendarPushTargetCalendarId();
    if (selectedId) {
        try {
            const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
            const selected = calendars.find((calendar) => calendar.id === selectedId);
            if (selected && isWritableCalendar(selected)) {
                return { id: selectedId };
            }
            await setCalendarPushTargetCalendarId(null);
            void logWarn('Selected calendar push target is unavailable; falling back to Mindwtr calendar', {
                scope: 'calendar-push',
                extra: { calendarId: selectedId },
            });
        } catch (error) {
            void logError(error, { scope: 'calendar-push', extra: { operation: 'resolveCalendarPushTargetId' } });
        }
    }

    const managedId = await ensureMindwtrCalendar();
    return managedId ? { id: managedId } : null;
}

/**
 * Deletes the managed Mindwtr calendar and removes the stored ID.
 * Called when the user disables calendar push sync and chooses to clean up.
 */
export const deleteMindwtrCalendar = (): Promise<void> => {
    if (isSandboxMode()) return Promise.resolve();
    if (pendingCalendarDelete) return pendingCalendarDelete;
    const run = deleteMindwtrCalendarUnsafe();
    pendingCalendarDelete = run;
    void run.then(() => { pendingCalendarDelete = null; }, () => { pendingCalendarDelete = null; });
    return run;
};

const deleteMindwtrCalendarUnsafe = async (): Promise<void> => {
    if (pendingCalendarEnsure) await pendingCalendarEnsure;
    if (pendingCalendarColorUpdate) await pendingCalendarColorUpdate;
    const storedId = await getStoredCalendarId();
    const intent = Platform.OS === 'ios'
        ? await getCalendarCreationIntent()
        : null;
    const selectedTargetId = await getCalendarPushTargetCalendarId();
    const calendarIdsToDelete = new Set<string>();
    const deletedIds = new Set<string>();
    let deleteFailed = false;
    let clearCreationIntent = false;
    let pendingCalendarId: string | null = null;
    let pendingInspectionFailed = false;
    if (storedId) {
        calendarIdsToDelete.add(storedId);
    }

    try {
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        if (intent?.calendarId && storedId && storedId !== intent.calendarId
            && calendars.some((calendar) => calendar.id === storedId)) {
            pendingInspectionFailed = true;
        }
        if (storedId && !calendars.some((calendar) => calendar.id === storedId)) {
            deletedIds.add(storedId);
        }
        calendars.forEach((calendar) => {
            if (Platform.OS === 'android' && isAppCreatedMindwtrCalendar(calendar)) {
                calendarIdsToDelete.add(calendar.id);
            }
        });
        if (intent) {
            const matches = calendars.filter((calendar) => calendar.title === intent.title);
            if (matches.length > 1) pendingInspectionFailed = true;
            if (intent.calendarId) {
                if (matches.some((calendar) => calendar.id !== intent.calendarId)) pendingInspectionFailed = true;
                const bound = calendars.find((calendar) => calendar.id === intent.calendarId);
                if (bound) pendingCalendarId = bound.id;
                else if (matches.length === 0) clearCreationIntent = true;
            } else if (matches.length === 1) {
                pendingCalendarId = matches[0].id;
            } else if (matches.length === 0) {
                clearCreationIntent = true;
            }
            if (pendingCalendarId) {
                calendarIdsToDelete.add(pendingCalendarId);
            }
        }
    } catch (error) {
        if (intent) pendingInspectionFailed = true;
        void logWarn('Failed to inspect calendars before deleting Mindwtr calendar', {
            scope: 'calendar-push',
            extra: { error: String(error) },
        });
    }
    if (pendingInspectionFailed) throw new Error('Cannot identify pending Mindwtr calendar');

    if (calendarIdsToDelete.size === 0) {
        await AsyncStorage.removeItem(CALENDAR_ID_KEY);
        if (clearCreationIntent) await AsyncStorage.removeItem(CALENDAR_CREATION_INTENT_KEY);
        if (selectedTargetId) {
            const targets = await getCalendarPushTargetCalendars();
            if (!targets.some((target) => target.id === selectedTargetId)) {
                await setCalendarPushTargetCalendarId(null);
            }
        }
        void logInfo('Deleted Mindwtr calendar', {
            scope: 'calendar-push',
            extra: { deletedCalendars: '0' },
        });
        return;
    }

    const ids = Array.from(calendarIdsToDelete);
    const outcomes = await Promise.allSettled(ids.map((calendarId) => Calendar.deleteCalendarAsync(calendarId)));
    outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') deletedIds.add(ids[index]);
        else if (!deletedIds.has(ids[index])) deleteFailed = true;
    });
    if (pendingCalendarId) {
        clearCreationIntent = deletedIds.has(pendingCalendarId);
    }

    if (!storedId || deletedIds.has(storedId)) await AsyncStorage.removeItem(CALENDAR_ID_KEY);
    if (clearCreationIntent) await AsyncStorage.removeItem(CALENDAR_CREATION_INTENT_KEY);
    if (selectedTargetId && deletedIds.has(selectedTargetId)) {
        await setCalendarPushTargetCalendarId(null);
    }

    try {
        const syncedEntries = await getAllCalendarSyncEntries(PLATFORM);
        const deletedEntries = syncedEntries.filter((entry) => deletedIds.has(entry.calendarId));
        await Promise.allSettled(
            deletedEntries.map((entry) => deleteCalendarSyncEntry(entry.taskId, PLATFORM))
        );
    } catch (error) {
        void logWarn('Failed to clear deleted Mindwtr calendar sync entries', {
            scope: 'calendar-push',
            extra: { error: String(error) },
        });
    }

    if (deleteFailed) throw new Error('Failed to delete Mindwtr calendar');

    void logInfo('Deleted Mindwtr calendar', {
        scope: 'calendar-push',
        extra: { deletedCalendars: String(deletedIds.size) },
    });
};

// MARK: - Per-task sync

function formatProjectedRecurrenceEventDate(task: Task): string {
    return safeFormatDate(getTaskCalendarOccurrenceDate(task), PROJECTED_RECURRENCE_EVENT_DATE_FORMAT);
}

function formatCalendarEventTitle(title: string, occurrenceDateLabel = ''): string {
    const trimmed = title.trim() || 'Task';
    return occurrenceDateLabel ? `${trimmed} (${occurrenceDateLabel})` : trimmed;
}

function formatProjectedRecurrenceNote(task: Task): string {
    const occurrenceDateLabel = formatProjectedRecurrenceEventDate(task);
    return occurrenceDateLabel
        ? `Projected recurring occurrence for ${occurrenceDateLabel}. Complete the current Mindwtr task to create the real next task.`
        : 'Projected recurring occurrence. Complete the current Mindwtr task to create the real next task.';
}

function buildEventDetails(task: Task) {
    // safeParseDate parses YYYY-MM-DD as local midnight, avoiding the UTC
    // shift that `new Date(dateString)` produces for date-only strings.
    const dateValue = task.startTime ?? task.dueDate;
    const parsed = safeParseDate(dateValue);
    const startDate = parsed ?? new Date();
    const projectedOccurrenceDateLabel = isProjectedRecurringTask(task)
        ? formatProjectedRecurrenceEventDate(task)
        : '';
    const title = formatCalendarEventTitle(task.title, projectedOccurrenceDateLabel);
    const location = typeof task.location === 'string' ? task.location.trim() : '';
    const { projects, sections, settings } = useTaskStore.getState();
    const projectName = task.projectId
        ? projects.find((project) => project.id === task.projectId)?.title
        : undefined;
    const sectionName = task.sectionId
        ? sections.find((section) => section.id === task.sectionId)?.title
        : undefined;
    const leadingNote = isProjectedRecurringTask(task) ? formatProjectedRecurrenceNote(task) : undefined;
    const { notes, url } = buildCalendarPushEventFields(task, { projectName, sectionName, leadingNote });

    if (hasTimeComponent(dateValue)) {
        // The pushed event's length comes from the estimate, so it must honour
        // the feature the same way the in-app calendar does — an estimate
        // written before the feature was switched off must not keep stretching
        // events.
        const estimateMinutes = timeEstimateToMinutes(task.timeEstimate, {
            enabled: resolveFeatureFlags(settings).timeEstimates,
        });
        const endDate = new Date(startDate.getTime() + estimateMinutes * 60 * 1000);
        return {
            title,
            startDate,
            endDate,
            allDay: false,
            notes,
            location,
            ...(url ? { url } : {}),
        };
    }

    const startDateOnly = buildAllDayBoundary(startDate);
    // Android's CalendarContract wants an EXCLUSIVE end at the next UTC
    // midnight; EventKit counts every day the range touches, so on iOS that
    // same end reads as a second day and Google Calendar (synced through the
    // iOS account) shows a two-day event (#1065). iOS ends inside the day.
    const endDate = Platform.OS === 'android'
        ? buildAllDayBoundary(startDate, 1)
        : buildAllDayEndOfDay(startDate);
    return {
        title,
        startDate: startDateOnly,
        endDate,
        allDay: true,
        notes,
        location,
        ...(url ? { url } : {}),
        ...(Platform.OS === 'android' ? { timeZone: 'UTC', endTimeZone: 'UTC' } : {}),
    };
}

function buildAllDayBoundary(date: Date, dayOffset = 0): Date {
    if (Platform.OS === 'android') {
        return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset));
    }
    const boundary = new Date(date);
    boundary.setHours(0, 0, 0, 0);
    boundary.setDate(boundary.getDate() + dayOffset);
    return boundary;
}

function buildAllDayEndOfDay(date: Date): Date {
    const boundary = new Date(date);
    boundary.setHours(23, 59, 59, 0);
    return boundary;
}

function getCalendarErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
        const value = error as { code?: unknown; message?: unknown; name?: unknown };
        return [value.name, value.code, value.message]
            .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
            .join(' ');
    }
    return String(error);
}

function isCalendarEventMissingError(error: unknown): boolean {
    const message = getCalendarErrorMessage(error).toLowerCase();
    return message.includes('event-not-found')
        || message.includes('calendar event not found')
        || message.includes('event not found')
        || message.includes('event does not exist')
        || message.includes('event already deleted')
        || (message.includes('event') && message.includes('not found'));
}

function createCalendarPushRunPorts(target: CalendarPushTarget): CalendarPushRunPorts {
    return {
        platform: PLATFORM,
        nowIso: () => new Date().toISOString(),
        createEvent: async (task) => {
            const details = buildEventDetails(task);
            return Calendar.createEventAsync(target.id, { ...details, calendarId: target.id });
        },
        updateEvent: async (entry, task) => {
            try {
                await Calendar.updateEventAsync(entry.calendarEventId, buildEventDetails(task));
                return { status: 'updated', eventId: entry.calendarEventId };
            } catch (error) {
                if (isCalendarEventMissingError(error)) {
                    return { status: 'missing' };
                }
                void logWarn('Failed to update calendar event; keeping local sync mapping for retry', {
                    scope: 'calendar-push',
                    extra: {
                        taskId: entry.taskId,
                        eventId: entry.calendarEventId,
                        error: getCalendarErrorMessage(error),
                    },
                });
                throw error;
            }
        },
        deleteEvent: async (entry) => {
            try {
                await Calendar.deleteEventAsync(entry.calendarEventId);
            } catch (error) {
                if (isCalendarEventMissingError(error)) {
                    return;
                }
                void logWarn('Failed to delete calendar event; keeping local sync mapping for retry', {
                    scope: 'calendar-push',
                    extra: {
                        taskId: entry.taskId,
                        eventId: entry.calendarEventId,
                        error: getCalendarErrorMessage(error),
                    },
                });
                throw error;
            }
        },
        getSyncEntry: (taskId) => getCalendarSyncEntry(taskId, PLATFORM),
        getAllSyncEntries: () => getAllCalendarSyncEntries(PLATFORM),
        upsertSyncEntry: upsertCalendarSyncEntry,
        deleteSyncEntry: (taskId) => deleteCalendarSyncEntry(taskId, PLATFORM),
    };
}

let calendarSyncStorageWarningShown = false;
async function canUseCalendarSyncStorage(): Promise<boolean> {
    try {
        await ensureCalendarSyncStorageReady();
        calendarSyncStorageWarningShown = false;
        return true;
    } catch (error) {
        if (!calendarSyncStorageWarningShown) {
            calendarSyncStorageWarningShown = true;
            void logWarn('Calendar sync skipped because SQLite storage is unavailable', {
                scope: 'calendar-push',
                extra: { error: getCalendarErrorMessage(error) },
            });
        }
        return false;
    }
}

// MARK: - Full sync

// Serializes every calendar write and coalesces store changes; the runs below
// stay unqueued so the scheduler owns ordering (#743).
const calendarPushScheduler = createCalendarPushScheduler({
    runFull: () => runFullCalendarSyncUnsafe(),
    runPartial: (taskIds) => runPartialCalendarSyncUnsafe(taskIds),
});

const enqueueCalendarSync = calendarPushScheduler.enqueue;

export const runFullCalendarSync = (): Promise<void> => (
    isSandboxMode() ? Promise.resolve() : calendarPushScheduler.runFull()
);

const runFullCalendarSyncUnsafe = async (): Promise<void> => {
    const enabled = await getCalendarPushEnabled();
    if (!enabled) return;
    if (!await canUseCalendarSyncStorage()) return;

    const target = await resolveCalendarPushTarget();
    if (!target) return;

    const { _allTasks } = useTaskStore.getState();
    const result = await runCalendarPushFullSync({
        tasks: _allTasks as Task[],
        target,
        ports: createCalendarPushRunPorts(target),
        concurrency: CALENDAR_PUSH_SYNC_CONCURRENCY,
    });
    void logInfo('Full calendar sync complete', {
        scope: 'calendar-push',
        extra: {
            total: String(result.total),
            failed: String(result.failed),
            stale: String(result.stale),
            releaseCheck: 'v1.3.0/calendar-push-inventory',
        },
    });
};

// MARK: - Debounced partial sync

export const scheduleSyncDebounced = (taskIds: string[]): void => {
    if (isSandboxMode()) return;
    calendarPushScheduler.scheduleDebounced(taskIds);
};

const runPartialCalendarSyncUnsafe = async (taskIds: string[]): Promise<void> => {
    const enabled = await getCalendarPushEnabled();
    if (!enabled) return;
    if (!await canUseCalendarSyncStorage()) return;

    const target = await resolveCalendarPushTarget();
    if (!target) return;

    const { _tasksById } = useTaskStore.getState();
    await runCalendarPushPartialSync({
        taskIds,
        tasksById: _tasksById as Map<string, Task>,
        target,
        ports: createCalendarPushRunPorts(target),
        concurrency: CALENDAR_PUSH_SYNC_CONCURRENCY,
    });
};

// MARK: - Store subscription

let unsubscribeStore: (() => void) | null = null;

const buildCalendarSyncTaskMap = (tasks: Task[]) => new Map(tasks.map((task) => [task.id, task]));

/**
 * Starts watching the task store for changes and syncing due-date tasks to
 * the device calendar. Returns an unsubscribe function.
 */
export const startCalendarPushSync = (): (() => void) => {
    if (isSandboxMode()) return () => {};
    if (unsubscribeStore) return unsubscribeStore;

    let previousTaskMap = buildCalendarSyncTaskMap(useTaskStore.getState()._allTasks);

    unsubscribeStore = useTaskStore.subscribe(
        (state) => state._allTasks,
        nameNotifyListener('calendar-push', (currentTasks: Task[]) => {
            const changedIds: string[] = [];
            const currentMap = buildCalendarSyncTaskMap(currentTasks);

            // Changed or new tasks
            for (const task of currentTasks) {
                const prev = previousTaskMap.get(task.id);
                if (
                    !prev ||
                    prev.updatedAt !== task.updatedAt ||
                    prev.startTime !== task.startTime ||
                    prev.dueDate !== task.dueDate ||
                    prev.deletedAt !== task.deletedAt ||
                    prev.status !== task.status ||
                    prev.title !== task.title ||
                    prev.description !== task.description ||
                    prev.location !== task.location ||
                    prev.timeEstimate !== task.timeEstimate ||
                    prev.suppressMindwtrReminders !== task.suppressMindwtrReminders ||
                    prev.recurrence !== task.recurrence ||
                    prev.showFutureRecurrence !== task.showFutureRecurrence
                ) {
                    changedIds.push(task.id);
                }
            }

            // Tasks removed from store entirely
            for (const id of previousTaskMap.keys()) {
                if (!currentMap.has(id)) {
                    changedIds.push(id);
                }
            }

            previousTaskMap = currentMap;

            if (changedIds.length > 0) {
                scheduleSyncDebounced(changedIds);
            }
        })
    );

    return stopCalendarPushSync;
};

export const stopCalendarPushSync = (): void => {
    if (isSandboxMode()) return;
    unsubscribeStore?.();
    unsubscribeStore = null;
    calendarPushScheduler.cancelPending();
};
