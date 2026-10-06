import {
    canOpenExternalCalendarEvent,
    getReviewCalendarRange,
    logInfo,
    logWarn,
    useTaskStore,
    type ExternalCalendarEvent,
    type NativeCalendarFeedSlot,
    type NativeCalendarHost,
} from '@mindwtr/core';

/** RN's AsyncStorage in place (host-entry.ts keyValue, over RnKeyValue.kt): a write is on disk when it resolves. */
type KeyValue = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
};

/** host-polyfills.js's device calendar call (HostCalendars.kt) and the attachment file port's (HostFiles.kt) readBytes. */
type CalendarCall = (request: Record<string, unknown>) => Promise<unknown>;
type FileCall = (request: Record<string, unknown>) => Promise<unknown>;

/**
 * Core's external calendar device (createNativeHostContract's `calendar`, native-host-contract-settings-calendar.ts) on an
 * Android host as RN's external-calendar.ts binds it: RN's AsyncStorage keys, the polyfill's fetch (OkHttp, no Origin header,
 * a body cut short or past the limit rejects), a picked .ics read through the content resolver (expo-file-system's UTF-8 read),
 * and the device calendars through HostCalendars (expo-calendar's Android reads). Calendar push (its writes and the
 * calendar_sync table) is pass C4: core then answers its commands ACTION_FAILED. No log line carries a URL or an event title.
 */
export const createNativeCalendar = (keyValue: KeyValue, call: () => CalendarCall, fileCall: () => FileCall): NativeCalendarHost => ({
    platform: { os: 'android' },
    storage: {
        getItem: (key) => keyValue.get(key),
        setItem: (key, value) => keyValue.set(key, value),
        removeItem: (key) => keyValue.remove(key),
    },
    fetch: (input, init) => fetch(input, init),
    readLocalFile: async (url) => new TextDecoder('utf-8', { fatal: false }).decode(await fileCall()({ op: 'readBytes', uri: url }) as Uint8Array),
    calendars: {
        getPermissions: () => call()({ op: 'getPermissions' }) as Promise<{ status: unknown }>,
        requestPermissions: () => call()({ op: 'requestPermissions' }) as Promise<{ status: unknown }>,
        getCalendars: () => call()({ op: 'getCalendars' }) as never,
        getEvents: (calendarIds, start, end) => call()({ op: 'getEvents', calendarIds, start: start.toISOString(), end: end.toISOString() }) as never,
    },
    log: {
        info: (message, context) => { try { logInfo(message, { scope: context.scope, context: context.extra }); } catch { /* a diagnostic line never fails its caller */ } },
        warn: (message, context) => { try { logWarn(message, { scope: context.scope, context: context.extra }); } catch { /* as above */ } },
        // An error's text can name a feed's host: only its kind is logged.
        error: (error, context) => {
            try { logWarn('Calendar settings failed', { scope: context.scope, context: { error: error instanceof Error ? error.name : typeof error } }); } catch { /* as above */ }
        },
    },
});

type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
type Event = ExternalCalendarEvent;
/** native-host-contract-calendar.ts NativeCalendarFeed. */
type Feed =
    | { status: 'loading'; calendars?: unknown[] }
    | { status: 'error'; message: string; calendars?: unknown[] }
    | { status: 'ready'; calendars: unknown[]; events: Event[] };
type LoadInput = { slot: NativeCalendarFeedSlot; start: string; end: string; timeoutMs?: number; refresh?: boolean };

/** The Daily Review's whole load is bounded, as RN's daily-review-modal.tsx bounds it. */
const DAILY_REVIEW_TIMEOUT_MS = 15_000;

/**
 * The external calendars each screen shows (core's NATIVE_CALENDAR_FEED_SLOTS), as RN's screens hold them in state: the
 * Calendar's for the view's `range`, the Weekly Review's for 7 days and the Daily Review's for 2 from the start of today
 * (getReviewCalendarRange). A view read attaches the slot's feed; a slot with no load for that range or for the subscriptions
 * now synced starts one (RN's effect deps), and the screen is told when it ends (`changed`), so Kotlin only reads again.
 * `refresh` is RN's reload on focus and on a return to the app. While the Calendar reloads the same range its events stay
 * (RN keeps them); a new range, and a review's reload, show loading.
 */
export const createCalendarFeeds = (deps: {
    load: (input: LoadInput) => Promise<Reply<Feed>>;
    changed: (slot: NativeCalendarFeedSlot, feed: Feed) => void;
}) => {
    type Entry = { range: string; subscriptions: string; feed: Feed; load: LoadInput; token: number };
    const entries = new Map<NativeCalendarFeedSlot, Entry>();
    let tokens = 0;
    const subscriptions = () => JSON.stringify(useTaskStore.getState().settings.externalCalendars ?? null);

    const reviewRange = (slot: NativeCalendarFeedSlot): LoadInput => {
        const range = getReviewCalendarRange(new Date(), slot === 'dailyReview' ? 2 : 7);
        return { slot, start: range.start.toISOString(), end: range.end.toISOString(), ...(slot === 'dailyReview' ? { timeoutMs: DAILY_REVIEW_TIMEOUT_MS } : {}) };
    };

    const start = (input: LoadInput, refresh: boolean) => {
        const previous = entries.get(input.slot);
        const range = `${input.start}|${input.end}`;
        const sameRange = previous?.range === range;
        const calendars = previous?.feed.calendars;
        const kept = input.slot === 'calendar' && sameRange && previous!.feed.status === 'ready' ? previous!.feed : null;
        const token = ++tokens;
        entries.set(input.slot, { range, subscriptions: subscriptions(), feed: kept ?? { status: 'loading', ...(calendars ? { calendars } : {}) }, load: input, token });
        void deps.load(refresh ? { ...input, refresh: true } : input).then((answer) => {
            const entry = entries.get(input.slot);
            // A newer load replaced it (STALE_REVISION), or the slot moved on: nothing to show.
            if (!answer.ok || entry?.token !== token) return;
            entries.set(input.slot, { ...entry, feed: answer.value });
            deps.changed(input.slot, answer.value);
        }, () => undefined);
    };

    /** The slot's feed for a load of [input]: the one shown, after starting a load where none is for it. */
    const feedFor = (input: LoadInput): Feed => {
        const entry = entries.get(input.slot);
        if (!entry || entry.range !== `${input.start}|${input.end}` || entry.subscriptions !== subscriptions()) start(input, false);
        return entries.get(input.slot)!.feed;
    };

    const reviewFeed = (slot: 'weeklyReview' | 'dailyReview') => {
        const feed = feedFor(reviewRange(slot));
        return feed.status === 'ready' ? { status: 'ready' as const, events: feed.events }
            : feed.status === 'error' ? { status: 'error' as const, message: feed.message } : { status: 'loading' as const };
    };

    return {
        /** A Calendar call's input with the feed the Calendar shows (none before its first view). */
        calendar: <T,>(input: T): T => {
            const feed = entries.get('calendar')?.feed;
            return feed && input && typeof input === 'object' && !('calendar' in input) ? { ...input, calendar: feed } : input;
        },
        /**
         * The Calendar's view: read with the feed shown, then, when that view's `range` (core's window) has no load yet, read
         * again with the load it starts. A later window's read finds the same feed, so its revision matches.
         */
        calendarView: <T extends { range: { start: string; end: string } }>(input: unknown, read: (input: never) => Reply<T>): Reply<T> => {
            if (!input || typeof input !== 'object' || 'calendar' in input) return read(input as never);
            const shown = entries.get('calendar')?.feed;
            const first = read((shown ? { ...input, calendar: shown } : input) as never);
            if (!first.ok) return first;
            const feed = feedFor({ slot: 'calendar', start: first.value.range.start, end: first.value.range.end });
            return feed === shown ? first : read({ ...input, calendar: feed } as never);
        },
        /** A review read's input with its feed (core's NativeReviewCalendar). */
        review: <T extends Record<string, unknown>>(slot: 'weeklyReview' | 'dailyReview', input: T): T => (
            input && typeof input === 'object' && !('calendar' in input) ? { ...input, calendar: reviewFeed(slot) } : input
        ),
        /** RN's reload on focus and on a return to the app; a slot never loaded loads at its first read. */
        refresh: (slot: NativeCalendarFeedSlot) => {
            const entry = entries.get(slot);
            if (!entry) return { started: false };
            start(slot === 'calendar' ? entry.load : reviewRange(slot), true);
            return { started: true };
        },
        /** An event the Calendar's feed shows, by its id, and whether the calendar app can open it (a device calendar's). */
        event: (eventId: string): { event: Event; canOpen: boolean } | null => {
            const feed = entries.get('calendar')?.feed;
            const event = feed?.status === 'ready' ? feed.events.find((candidate) => candidate.id === eventId) : undefined;
            return event ? { event, canOpen: canOpenExternalCalendarEvent(event, 'android') } : null;
        },
    };
};
