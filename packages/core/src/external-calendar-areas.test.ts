import { describe, expect, it } from 'vitest';
import { calendarMatchesAreaSelection, filterCalendarEventsForAreas } from './external-calendar-ingestion';
import { expandCategoryCalendars, type ExternalCalendarEvent, type ExternalCalendarSubscription } from './ics';
import { sanitizeMergedSettingsForSync } from './sync-merge-settings';
import type { AppSettings, Area } from './types';

const areas = [{ id: 'work' }, { id: 'home' }] as Area[];
const selection = (included: string[] = [], excluded: string[] = []) => ({ included, excluded });
const calendar = (areaIds?: string[]): ExternalCalendarSubscription => ({
    id: 'feed', name: 'Feed', url: 'https://example.com/feed.ics', enabled: true, areaIds,
});
const event: ExternalCalendarEvent = {
    id: 'event', sourceId: 'feed', title: 'Busy', start: '2026-10-01T13:00:00Z', end: '2026-10-01T14:00:00Z', allDay: false,
};

describe('external calendar Area association', () => {
    it('shows global calendars everywhere and matches any surviving association', () => {
        expect(calendarMatchesAreaSelection(calendar(), selection(['work']), areas)).toBe(true);
        expect(calendarMatchesAreaSelection(calendar(['work', 'home']), selection(['work']), areas)).toBe(true);
        expect(calendarMatchesAreaSelection(calendar(['work', 'home']), selection(['home'], ['home']), areas)).toBe(false);
        expect(calendarMatchesAreaSelection(calendar(['work', 'home']), selection([], ['work']), areas)).toBe(true);
        expect(calendarMatchesAreaSelection(calendar(['work']), selection(['__none__']), areas)).toBe(false);
        expect(calendarMatchesAreaSelection(calendar(['work']), selection(), areas)).toBe(true);
    });

    it('treats only deleted or missing associations as global without rewriting stored IDs', () => {
        const stored = calendar(['deleted']);
        expect(calendarMatchesAreaSelection(stored, selection(['work']), areas)).toBe(true);
        expect(stored.areaIds).toEqual(['deleted']);
    });

    it('retains a child category association and leaves enabled source events available', () => {
        const parent = calendar(['work']);
        const child = expandCategoryCalendars(parent, [{ ...event, sourceId: 'feed#Team' }]);
        expect(child[0].areaIds).toEqual(['work']);
        const hidden = filterCalendarEventsForAreas([{ ...event, sourceId: 'feed#Team' }], child, selection(['home']), areas);
        expect(hidden).toEqual([]);
        expect(filterCalendarEventsForAreas([event], [{ ...parent, enabled: false }], selection(), areas)).toEqual([]);
    });

    it('preserves area IDs through settings sanitization and old payloads', () => {
        const newer = { externalCalendars: [calendar(['work', 'home'])] } as AppSettings;
        expect(sanitizeMergedSettingsForSync(newer, newer).externalCalendars?.[0]?.areaIds).toEqual(['work', 'home']);
        const older = { externalCalendars: [calendar()] } as AppSettings;
        expect(sanitizeMergedSettingsForSync(older, older).externalCalendars?.[0]?.areaIds).toBeUndefined();
    });
    it('bounds untrusted associations and drops malformed IDs during settings sanitization', () => {
        const ids = ['work', 'work', '', 42, 'x'.repeat(201), ...Array.from({ length: 300 }, (_, i) => `area-${i}`)];
        const settings = { externalCalendars: [{ ...calendar(), areaIds: ids }] } as unknown as AppSettings;
        const clean = sanitizeMergedSettingsForSync(settings, settings);
        expect(clean.externalCalendars?.[0].areaIds).toHaveLength(196);
        expect(clean.externalCalendars?.[0].areaIds?.slice(0, 2)).toEqual(['work', 'area-0']);
        expect(sanitizeMergedSettingsForSync(clean, clean)).toEqual(clean);
    });

});
