import { describe, expect, it } from 'vitest';
import { maskCalendarFeedUrl, planCalendarPushColor, setCalendarFeedColor } from './calendar-settings-model';

describe('Settings › Calendar rules', () => {
    it('never shows the user name or password a subscription URL carries', () => {
        expect(maskCalendarFeedUrl('https://alex:s3cret@calendar.example.com/team/basic.ics')).toBe('https://calendar.example.com/...ic.ics');
        expect(maskCalendarFeedUrl('user@calendar.example.com/private/feed')).toBe('calendar.example.com/...feed');
        expect(maskCalendarFeedUrl(' https://calendar.example.com/team/basic.ics ')).toBe('https://calendar.example.com/...ic.ics');
        expect(maskCalendarFeedUrl('content://downloads/42')).toBe('content:/...42');
    });

    it('writes nothing when a color is picked again', () => {
        const feeds = [{ id: 'team', name: 'Team', url: 'https://example.com/team.ics', enabled: true, color: '#059669' }, { id: 'auto', name: 'Auto', url: 'https://example.com/auto.ics', enabled: true }];
        expect(setCalendarFeedColor(feeds, 'team', '#059669')).toBeNull();
        expect(setCalendarFeedColor(feeds, 'auto', undefined)).toBeNull();
        expect(setCalendarFeedColor(feeds, 'team', '#2563eb')?.[0]).toMatchObject({ color: '#2563EB' });
        expect(setCalendarFeedColor(feeds, 'team', undefined)?.[0]).not.toHaveProperty('color');
        // The Mindwtr calendar's color: re-picking it must not recreate the calendar (Android).
        expect(planCalendarPushColor('#059669', '#059669')).toBeNull();
        expect(planCalendarPushColor('#7c3aed', '#7C3AED')).toBeNull();
        expect(planCalendarPushColor('#3B82F6', '#059669')).toBe('#059669');
    });
});
