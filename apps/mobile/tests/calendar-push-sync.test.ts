import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be set up before any imports that reference them
// ---------------------------------------------------------------------------

const {
    mockGetItem,
    mockSetItem,
    mockRemoveItem,
    mockGetCalendarsAsync,
    mockGetSourcesAsync,
    mockCreateCalendarAsync,
    mockDeleteCalendarAsync,
    mockCreateEventAsync,
    mockUpdateEventAsync,
    mockDeleteEventAsync,
    mockGetCalendarSyncEntry,
    mockUpsertCalendarSyncEntry,
    mockDeleteCalendarSyncEntry,
    mockGetAllCalendarSyncEntries,
    mockGetState,
    mockLogInfo,
    mockLogWarn,
    mockLogError,
    mockPlatform,
} = vi.hoisted(() => ({
    mockGetItem: vi.fn(async () => null as string | null),
    mockSetItem: vi.fn(async () => {}),
    mockRemoveItem: vi.fn(async () => {}),
    mockGetCalendarsAsync: vi.fn(async () => [] as Array<{ id: string; title?: string }>),
    mockGetSourcesAsync: vi.fn(async () => [{ id: 'src1', type: 'local', name: 'Local' }]),
    mockCreateCalendarAsync: vi.fn(async () => 'cal-1'),
    mockDeleteCalendarAsync: vi.fn(async () => {}),
    mockCreateEventAsync: vi.fn(async () => 'evt-1'),
    mockUpdateEventAsync: vi.fn(async () => 'evt-1'),
    mockDeleteEventAsync: vi.fn(async () => {}),
    mockGetCalendarSyncEntry: vi.fn(async () => null as null | {
        taskId: string; calendarEventId: string; calendarId: string; platform: string; lastSyncedAt: string;
    }),
    mockUpsertCalendarSyncEntry: vi.fn(async () => {}),
    mockDeleteCalendarSyncEntry: vi.fn(async () => {}),
    mockGetAllCalendarSyncEntries: vi.fn(async () => [] as Array<{
        taskId: string; calendarEventId: string; calendarId: string; platform: string; lastSyncedAt: string;
    }>),
    mockGetState: vi.fn(() => ({ tasks: [] as unknown[] })),
    mockLogInfo: vi.fn(),
    mockLogWarn: vi.fn(),
    mockLogError: vi.fn(),
    mockPlatform: { OS: 'ios' },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: mockGetItem,
        setItem: mockSetItem,
        removeItem: mockRemoveItem,
    },
}));

vi.mock('expo-calendar', () => ({
    EntityTypes: { EVENT: 'event' },
    SourceType: { LOCAL: 'local', CALDAV: 'caldav' },
    CalendarAccessLevel: { OWNER: 'owner' },
    getCalendarsAsync: mockGetCalendarsAsync,
    getSourcesAsync: mockGetSourcesAsync,
    createCalendarAsync: mockCreateCalendarAsync,
    deleteCalendarAsync: mockDeleteCalendarAsync,
    createEventAsync: mockCreateEventAsync,
    updateEventAsync: mockUpdateEventAsync,
    deleteEventAsync: mockDeleteEventAsync,
    getCalendarPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
    requestCalendarPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
}));

vi.mock('react-native', () => ({
    Platform: mockPlatform,
}));

vi.mock('@mindwtr/core', () => ({
    useTaskStore: {
        getState: mockGetState,
        subscribe: vi.fn(() => () => {}),
    },
    // Real implementation: parses YYYY-MM-DD as LOCAL midnight (not UTC).
    safeParseDate: (dateStr: string | null | undefined): Date | null => {
        if (!dateStr) return null;
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
        if (match) {
            return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        }
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    },
}));

vi.mock('@/lib/storage-adapter', () => ({
    getCalendarSyncEntry: mockGetCalendarSyncEntry,
    upsertCalendarSyncEntry: mockUpsertCalendarSyncEntry,
    deleteCalendarSyncEntry: mockDeleteCalendarSyncEntry,
    getAllCalendarSyncEntries: mockGetAllCalendarSyncEntries,
}));

vi.mock('@/lib/app-log', () => ({
    logInfo: mockLogInfo,
    logWarn: mockLogWarn,
    logError: mockLogError,
}));

// ---------------------------------------------------------------------------
// Subject under test — imported AFTER mocks are established
// ---------------------------------------------------------------------------

import {
    ensureMindwtrCalendar,
    runFullCalendarSync,
} from '@/lib/calendar-push-sync';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<{
    id: string;
    title: string;
    status: string;
    dueDate: string | null;
    deletedAt: string | null;
    updatedAt: string;
}> = {}) {
    return {
        id: 'task-1',
        title: 'My Task',
        status: 'next',
        dueDate: '2026-04-20',
        deletedAt: null,
        updatedAt: new Date().toISOString(),
        description: '',
        ...overrides,
    };
}

/** Sets up the two AsyncStorage.getItem calls made by runFullCalendarSync. */
function setupEnabled(calendarId = 'cal-1') {
    mockGetItem
        .mockResolvedValueOnce('1')         // getCalendarPushEnabled → enabled
        .mockResolvedValueOnce(calendarId); // ensureMindwtrCalendar → stored ID
}

beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.OS = 'ios';
    // Default: the stored calendar still exists
    mockGetCalendarsAsync.mockResolvedValue([{ id: 'cal-1', title: 'Mindwtr' }]);
    // Default: no prior sync entries
    mockGetCalendarSyncEntry.mockResolvedValue(null);
    mockGetAllCalendarSyncEntries.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureMindwtrCalendar', () => {
    it('returns the stored calendar ID when the calendar still exists', async () => {
        mockGetItem.mockResolvedValueOnce('cal-1'); // CALENDAR_ID_KEY

        const id = await ensureMindwtrCalendar();

        expect(id).toBe('cal-1');
        expect(mockCreateCalendarAsync).not.toHaveBeenCalled();
    });

    it('recreates the calendar when the stored one has been deleted', async () => {
        mockGetItem.mockResolvedValueOnce('cal-old'); // stored but gone
        mockGetCalendarsAsync.mockResolvedValue([]);  // not found
        mockCreateCalendarAsync.mockResolvedValue('cal-2');

        const id = await ensureMindwtrCalendar();

        expect(mockCreateCalendarAsync).toHaveBeenCalledOnce();
        expect(id).toBe('cal-2');
        expect(mockSetItem).toHaveBeenCalledWith('mindwtr:calendar-push-sync:calendar-id', 'cal-2');
    });

    it('creates an Android local calendar with the required source metadata', async () => {
        mockPlatform.OS = 'android';
        mockGetItem.mockResolvedValueOnce(null);
        mockCreateCalendarAsync.mockResolvedValue('cal-android');

        const id = await ensureMindwtrCalendar();

        expect(id).toBe('cal-android');
        expect(mockCreateCalendarAsync).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Mindwtr',
            name: 'mindwtr',
            ownerAccount: 'Mindwtr',
            accessLevel: 'owner',
            isVisible: true,
            isSynced: true,
            source: {
                name: 'Mindwtr',
                isLocalAccount: true,
            },
        }));
    });
});

describe('buildEventDetails — date-only due date stays on correct local day', () => {
    it('does not shift a YYYY-MM-DD due date to the previous day', async () => {
        setupEnabled();
        // Use a fixed date-only string — no time, no timezone suffix.
        // new Date('2026-04-20') parses as UTC midnight and shifts to Apr 19
        // in US time zones; safeParseDate('2026-04-20') must produce Apr 20.
        const task = makeTask({ dueDate: '2026-04-20' });
        mockGetState.mockReturnValue({ tasks: [task] });
        mockGetCalendarSyncEntry.mockResolvedValue(null);
        mockGetAllCalendarSyncEntries.mockResolvedValue([]);

        await runFullCalendarSync();

        expect(mockCreateEventAsync).toHaveBeenCalledOnce();
        const call = mockCreateEventAsync.mock.calls[0] as unknown as [string, { startDate: Date; endDate: Date; allDay: boolean }];
        const [, eventData] = call;

        expect(eventData.allDay).toBe(true);
        expect(eventData.startDate.getFullYear()).toBe(2026);
        expect(eventData.startDate.getMonth()).toBe(3); // April (0-indexed)
        expect(eventData.startDate.getDate()).toBe(20);
        expect(eventData.startDate.getHours()).toBe(0);

        expect(eventData.endDate.getFullYear()).toBe(2026);
        expect(eventData.endDate.getMonth()).toBe(3);
        expect(eventData.endDate.getDate()).toBe(20);
    });
});

describe('runFullCalendarSync — completion removes event', () => {
    it('removes a calendar event when the task is marked done', async () => {
        setupEnabled();
        const task = makeTask({ status: 'done' });
        mockGetState.mockReturnValue({ tasks: [task] });
        const entry = { taskId: task.id, calendarEventId: 'evt-done', calendarId: 'cal-1', platform: 'ios', lastSyncedAt: '' };
        mockGetCalendarSyncEntry.mockResolvedValue(entry);
        mockGetAllCalendarSyncEntries.mockResolvedValue([]);

        await runFullCalendarSync();

        expect(mockDeleteEventAsync).toHaveBeenCalledWith('evt-done');
        expect(mockDeleteCalendarSyncEntry).toHaveBeenCalledWith(task.id, 'ios');
        expect(mockCreateEventAsync).not.toHaveBeenCalled();
    });

    it('removes a calendar event when the task is archived', async () => {
        setupEnabled();
        const task = makeTask({ status: 'archived' });
        mockGetState.mockReturnValue({ tasks: [task] });
        mockGetCalendarSyncEntry.mockResolvedValue(
            { taskId: task.id, calendarEventId: 'evt-arch', calendarId: 'cal-1', platform: 'ios', lastSyncedAt: '' }
        );
        mockGetAllCalendarSyncEntries.mockResolvedValue([]);

        await runFullCalendarSync();

        expect(mockDeleteEventAsync).toHaveBeenCalledWith('evt-arch');
        expect(mockCreateEventAsync).not.toHaveBeenCalled();
    });
});

describe('runFullCalendarSync — event removal', () => {
    it('removes a calendar event when dueDate is cleared', async () => {
        setupEnabled();
        const task = makeTask({ dueDate: null });
        mockGetState.mockReturnValue({ tasks: [task] });
        mockGetCalendarSyncEntry.mockResolvedValue(
            { taskId: task.id, calendarEventId: 'evt-old', calendarId: 'cal-1', platform: 'ios', lastSyncedAt: '' }
        );
        mockGetAllCalendarSyncEntries.mockResolvedValue([]);

        await runFullCalendarSync();

        expect(mockDeleteEventAsync).toHaveBeenCalledWith('evt-old');
        expect(mockCreateEventAsync).not.toHaveBeenCalled();
    });

    it('removes a calendar event when the task is soft-deleted', async () => {
        setupEnabled();
        const task = makeTask({ deletedAt: new Date().toISOString() });
        mockGetState.mockReturnValue({ tasks: [task] });
        mockGetCalendarSyncEntry.mockResolvedValue(
            { taskId: task.id, calendarEventId: 'evt-del', calendarId: 'cal-1', platform: 'ios', lastSyncedAt: '' }
        );
        mockGetAllCalendarSyncEntries.mockResolvedValue([]);

        await runFullCalendarSync();

        expect(mockDeleteEventAsync).toHaveBeenCalledWith('evt-del');
    });
});

describe('runFullCalendarSync — startup reconciliation', () => {
    it('removes stale events for tasks no longer in the store', async () => {
        setupEnabled();
        mockGetState.mockReturnValue({ tasks: [] });
        const ghostEntry = { taskId: 'ghost-task', calendarEventId: 'evt-ghost', calendarId: 'cal-1', platform: 'ios', lastSyncedAt: '' };
        mockGetAllCalendarSyncEntries.mockResolvedValue([ghostEntry]);
        mockGetCalendarSyncEntry.mockResolvedValue(ghostEntry);

        await runFullCalendarSync();

        expect(mockDeleteEventAsync).toHaveBeenCalledWith('evt-ghost');
        expect(mockDeleteCalendarSyncEntry).toHaveBeenCalledWith('ghost-task', 'ios');
    });

    it('removes stale events for tasks completed between sessions', async () => {
        setupEnabled();
        const task = makeTask({ status: 'done' });
        mockGetState.mockReturnValue({ tasks: [task] });
        const staleEntry = { taskId: task.id, calendarEventId: 'evt-stale', calendarId: 'cal-1', platform: 'ios', lastSyncedAt: '' };
        mockGetAllCalendarSyncEntries.mockResolvedValue([staleEntry]);
        mockGetCalendarSyncEntry.mockResolvedValue(staleEntry);

        await runFullCalendarSync();

        expect(mockDeleteEventAsync).toHaveBeenCalledWith('evt-stale');
    });

    it('does not touch events for active tasks with due dates', async () => {
        setupEnabled();
        const task = makeTask();
        mockGetState.mockReturnValue({ tasks: [task] });
        const activeEntry = { taskId: task.id, calendarEventId: 'evt-active', calendarId: 'cal-1', platform: 'ios', lastSyncedAt: '' };
        mockGetCalendarSyncEntry.mockResolvedValue(activeEntry);
        mockGetAllCalendarSyncEntries.mockResolvedValue([activeEntry]);

        await runFullCalendarSync();

        expect(mockDeleteEventAsync).not.toHaveBeenCalled();
        expect(mockUpdateEventAsync).toHaveBeenCalledOnce();
    });
});
