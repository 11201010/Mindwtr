/**
 * Calendar push sync service.
 *
 * One-way push of tasks with due dates into a dedicated "Mindwtr" calendar on
 * the device (iOS EventKit via expo-calendar). Creates, updates, or removes
 * calendar events as task due dates change. Mapping between task IDs and
 * calendar event IDs is persisted in the SQLite calendar_sync table.
 */
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeParseDate, useTaskStore, type Task } from '@mindwtr/core';

import { logInfo, logWarn, logError } from './app-log';
import {
    getCalendarSyncEntry,
    upsertCalendarSyncEntry,
    deleteCalendarSyncEntry,
    getAllCalendarSyncEntries,
} from './storage-adapter';

// MARK: - Constants

const CALENDAR_PUSH_ENABLED_KEY = 'mindwtr:calendar-push-sync:enabled';
const CALENDAR_ID_KEY = 'mindwtr:calendar-push-sync:calendar-id';
const PLATFORM = Platform.OS;
const SYNC_DEBOUNCE_MS = 2500;
const MANAGED_CALENDAR_TITLE = 'Mindwtr';
const MANAGED_CALENDAR_NAME = 'mindwtr';

// MARK: - Settings

export const getCalendarPushEnabled = async (): Promise<boolean> => {
    const val = await AsyncStorage.getItem(CALENDAR_PUSH_ENABLED_KEY);
    return val === '1';
};

export const setCalendarPushEnabled = async (enabled: boolean): Promise<void> => {
    await AsyncStorage.setItem(CALENDAR_PUSH_ENABLED_KEY, enabled ? '1' : '0');
};

// MARK: - Permission

export const requestCalendarWritePermission = async (): Promise<boolean> => {
    try {
        const { status } = await Calendar.requestCalendarPermissionsAsync();
        return status === 'granted';
    } catch {
        return false;
    }
};

export const getCalendarWritePermissionStatus = async (): Promise<'granted' | 'denied' | 'undetermined'> => {
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

/**
 * Returns the ID of the managed "Mindwtr" calendar, creating it if needed.
 * Returns null if the calendar cannot be created (e.g. no permission, no source).
 */
export const ensureMindwtrCalendar = async (): Promise<string | null> => {
    try {
        const storedId = await getStoredCalendarId();
        if (storedId) {
            const allCalendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
            if (allCalendars.some((c) => c.id === storedId)) return storedId;
            // Calendar was deleted externally — fall through to recreate
        }

        let calendarDetails: Parameters<typeof Calendar.createCalendarAsync>[0];

        if (Platform.OS === 'android') {
            // Expo Calendar on Android requires a local-account source object
            // when creating device calendars.
            calendarDetails = {
                title: MANAGED_CALENDAR_TITLE,
                color: '#3B82F6',
                entityType: Calendar.EntityTypes.EVENT,
                name: MANAGED_CALENDAR_NAME,
                ownerAccount: MANAGED_CALENDAR_TITLE,
                accessLevel: Calendar.CalendarAccessLevel.OWNER,
                source: {
                    name: MANAGED_CALENDAR_TITLE,
                    isLocalAccount: true,
                },
                isVisible: true,
                isSynced: true,
            };
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
                title: MANAGED_CALENDAR_TITLE,
                color: '#3B82F6',
                entityType: Calendar.EntityTypes.EVENT,
                sourceId: source.id,
                source,
            };
        }

        const newId = await Calendar.createCalendarAsync(calendarDetails);

        await setStoredCalendarId(newId);
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

/**
 * Deletes the managed Mindwtr calendar and removes the stored ID.
 * Called when the user disables calendar push sync and chooses to clean up.
 */
export const deleteMindwtrCalendar = async (): Promise<void> => {
    const storedId = await getStoredCalendarId();
    if (!storedId) return;
    try {
        await Calendar.deleteCalendarAsync(storedId);
    } catch {
        // Already deleted or not found — ignore
    }
    await AsyncStorage.removeItem(CALENDAR_ID_KEY);
    void logInfo('Deleted Mindwtr calendar', { scope: 'calendar-push' });
};

// MARK: - Per-task sync

function buildEventDetails(task: Task) {
    // safeParseDate parses YYYY-MM-DD as local midnight, avoiding the UTC
    // shift that `new Date(dateString)` produces for date-only strings.
    const parsed = safeParseDate(task.dueDate);
    const startDate = parsed ?? new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
    return {
        title: task.title,
        startDate,
        endDate,
        allDay: true,
        notes: task.description ?? '',
    };
}

async function removeTaskFromCalendar(taskId: string): Promise<void> {
    const entry = await getCalendarSyncEntry(taskId, PLATFORM);
    if (!entry) return;
    try {
        await Calendar.deleteEventAsync(entry.calendarEventId);
    } catch {
        // Event may already be deleted
    }
    await deleteCalendarSyncEntry(taskId, PLATFORM);
}

/** Returns true for tasks that should not have a calendar event. */
function shouldRemoveFromCalendar(task: Task): boolean {
    return !task.dueDate || !!task.deletedAt || task.status === 'done' || task.status === 'archived';
}

async function syncTaskToCalendar(task: Task, calendarId: string): Promise<void> {
    if (shouldRemoveFromCalendar(task)) {
        await removeTaskFromCalendar(task.id);
        return;
    }

    const details = buildEventDetails(task);
    const existing = await getCalendarSyncEntry(task.id, PLATFORM);

    if (existing && existing.calendarId === calendarId) {
        try {
            await Calendar.updateEventAsync(existing.calendarEventId, details);
            await upsertCalendarSyncEntry({
                taskId: task.id,
                calendarEventId: existing.calendarEventId,
                calendarId,
                platform: PLATFORM,
                lastSyncedAt: new Date().toISOString(),
            });
            return;
        } catch {
            // Event deleted externally — fall through to create
        }
    }

    const eventId = await Calendar.createEventAsync(calendarId, { ...details, calendarId });
    await upsertCalendarSyncEntry({
        taskId: task.id,
        calendarEventId: eventId,
        calendarId,
        platform: PLATFORM,
        lastSyncedAt: new Date().toISOString(),
    });
}

// MARK: - Full sync

export const runFullCalendarSync = async (): Promise<void> => {
    const enabled = await getCalendarPushEnabled();
    if (!enabled) return;

    const calendarId = await ensureMindwtrCalendar();
    if (!calendarId) return;

    const { tasks } = useTaskStore.getState();

    // Sync all tasks currently in the store
    const results = await Promise.allSettled(
        tasks.map((task) => syncTaskToCalendar(task, calendarId))
    );

    // Reconcile: remove stale calendar_sync entries for tasks that are no
    // longer in the store or that should not have an event (completed between
    // sessions, archived, etc.)
    const activeEventIds = new Set(
        tasks.filter((t) => !shouldRemoveFromCalendar(t)).map((t) => t.id)
    );
    const syncedEntries = await getAllCalendarSyncEntries(PLATFORM);
    const staleEntries = syncedEntries.filter((e) => !activeEventIds.has(e.taskId));
    await Promise.allSettled(staleEntries.map((e) => removeTaskFromCalendar(e.taskId)));

    const failed = results.filter((r) => r.status === 'rejected').length;
    void logInfo('Full calendar sync complete', {
        scope: 'calendar-push',
        extra: {
            total: String(tasks.length),
            failed: String(failed),
            stale: String(staleEntries.length),
        },
    });
};

// MARK: - Debounced partial sync

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const scheduleSyncDebounced = (taskIds: string[]): void => {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
        syncDebounceTimer = null;
        void runPartialCalendarSync(taskIds);
    }, SYNC_DEBOUNCE_MS);
};

const runPartialCalendarSync = async (taskIds: string[]): Promise<void> => {
    const enabled = await getCalendarPushEnabled();
    if (!enabled) return;

    const calendarId = await ensureMindwtrCalendar();
    if (!calendarId) return;

    const { tasks } = useTaskStore.getState();
    const targets = tasks.filter((t) => taskIds.includes(t.id));

    // Also handle tasks that were removed from the store (deleted)
    const storeIds = new Set(tasks.map((t) => t.id));
    const removedIds = taskIds.filter((id) => !storeIds.has(id));

    await Promise.allSettled([
        ...targets.map((t) => syncTaskToCalendar(t, calendarId)),
        ...removedIds.map((id) => removeTaskFromCalendar(id)),
    ]);
};

// MARK: - Store subscription

let unsubscribeStore: (() => void) | null = null;

/**
 * Starts watching the task store for changes and syncing due-date tasks to
 * the device calendar. Returns an unsubscribe function.
 */
export const startCalendarPushSync = (): (() => void) => {
    if (unsubscribeStore) return unsubscribeStore;

    let previousTaskMap = new Map(
        useTaskStore.getState().tasks.map((t) => [t.id, t])
    );

    unsubscribeStore = useTaskStore.subscribe((state) => {
        const changedIds: string[] = [];
        const currentMap = new Map(state.tasks.map((t) => [t.id, t]));

        // Changed or new tasks
        for (const task of state.tasks) {
            const prev = previousTaskMap.get(task.id);
            if (
                !prev ||
                prev.updatedAt !== task.updatedAt ||
                prev.dueDate !== task.dueDate ||
                prev.deletedAt !== task.deletedAt ||
                prev.status !== task.status ||
                prev.title !== task.title
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
    });

    return () => {
        unsubscribeStore?.();
        unsubscribeStore = null;
        if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
            syncDebounceTimer = null;
        }
    };
};

export const stopCalendarPushSync = (): void => {
    unsubscribeStore?.();
    unsubscribeStore = null;
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }
};
