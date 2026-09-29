import { describe, expect, it } from 'vitest';
import { maskCalendarFeedUrl } from './calendar-settings-model';

describe('Settings › Calendar rules', () => {
    it('never shows the user name or password a subscription URL carries', () => {
        expect(maskCalendarFeedUrl('https://alex:s3cret@calendar.example.com/team/basic.ics')).toBe('https://calendar.example.com/...ic.ics');
        expect(maskCalendarFeedUrl('user@calendar.example.com/private/feed')).toBe('calendar.example.com/...feed');
        expect(maskCalendarFeedUrl(' https://calendar.example.com/team/basic.ics ')).toBe('https://calendar.example.com/...ic.ics');
        expect(maskCalendarFeedUrl('content://downloads/42')).toBe('content:/...42');
    });
});
