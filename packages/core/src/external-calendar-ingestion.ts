import type {
    ExternalCalendarEvent,
    ExternalCalendarSubscription,
} from './ics';
import { hasCalendarPushTaskMarker } from './calendar-scheduling';

const MINDWTR_PUSHED_EVENT_PREFIX = 'mindwtr: ';
const MINDWTR_MIRROR_CALENDAR_NAMES = new Set([
    'mindwtr',
    'mindwtr calendar',
    'mindwtrcal',
]);

export type ExternalCalendarSourceResult = {
    calendars: ExternalCalendarSubscription[];
    events: ExternalCalendarEvent[];
};

export function isMindwtrMirrorCalendar(
    calendar: Pick<ExternalCalendarSubscription, 'name'>,
): boolean {
    return MINDWTR_MIRROR_CALENDAR_NAMES.has(
        calendar.name.trim().toLowerCase().replace(/\s+/g, ' '),
    );
}

export function isMindwtrMirrorEvent(
    event: Pick<ExternalCalendarEvent, 'sourceId' | 'title' | 'description'>,
    calendarById: ReadonlyMap<string, ExternalCalendarSubscription>,
): boolean {
    const calendar = calendarById.get(event.sourceId);
    if (calendar && isMindwtrMirrorCalendar(calendar)) return true;
    if (hasCalendarPushTaskMarker(event.description)) return true;
    return event.title.trim().toLowerCase().startsWith(
        MINDWTR_PUSHED_EVENT_PREFIX,
    );
}

export function mergeExternalCalendarSources(
    sources: readonly ExternalCalendarSourceResult[],
): ExternalCalendarSourceResult {
    const calendarById = new Map<string, ExternalCalendarSubscription>();
    for (const source of sources) {
        for (const calendar of source.calendars) {
            calendarById.set(calendar.id, calendar);
        }
    }

    const eventByKey = new Map<string, ExternalCalendarEvent>();
    for (const source of sources) {
        for (const event of source.events) {
            if (isMindwtrMirrorEvent(event, calendarById)) continue;
            eventByKey.set(
                `${event.sourceId}:${event.id}:${event.start}:${event.end}`,
                event,
            );
        }
    }

    const events = Array.from(eventByKey.values());
    events.sort((left, right) => {
        if (left.start === right.start) {
            return left.title.localeCompare(right.title);
        }
        return left.start.localeCompare(right.start);
    });

    return {
        calendars: Array.from(calendarById.values()).filter(
            (calendar) => !isMindwtrMirrorCalendar(calendar),
        ),
        events,
    };
}
