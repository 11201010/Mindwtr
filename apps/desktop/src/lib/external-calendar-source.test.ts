import { describe, expect, it } from 'vitest';

import {
    getCalendarSourceFileName,
    isLocalCalendarFileUrl,
    isSupportedCalendarSourceUrl,
    localCalendarFileUrlToPath,
    localPathToCalendarFileUrl,
    maskCalendarSourceUrl,
} from './external-calendar-source';

describe('external calendar source helpers', () => {
    it('converts selected local paths into file URLs', () => {
        expect(localPathToCalendarFileUrl('/home/user/My Calendar.ics')).toBe(
            'file:///home/user/My%20Calendar.ics',
        );
        expect(localPathToCalendarFileUrl('C:\\Users\\demo\\agenda.ics')).toBe(
            'file:///C:/Users/demo/agenda.ics',
        );
    });

    it('detects and displays local calendar file URLs', () => {
        const url = 'file:///home/user/My%20Calendar.ics';

        expect(isLocalCalendarFileUrl(url)).toBe(true);
        expect(localCalendarFileUrlToPath(url)).toBe('/home/user/My Calendar.ics');
        expect(getCalendarSourceFileName(url)).toBe('My Calendar.ics');
    });

    it('validates supported calendar source URLs', () => {
        expect(isSupportedCalendarSourceUrl('https://calendar.example/work.ics')).toBe(true);
        expect(isSupportedCalendarSourceUrl('webcal://calendar.example/work.ics')).toBe(true);
        expect(isSupportedCalendarSourceUrl('file:///home/user/agenda.ics')).toBe(true);
        expect(isSupportedCalendarSourceUrl('file://agenda.ics')).toBe(false);
        expect(isSupportedCalendarSourceUrl('file:///home/user/agenda.txt')).toBe(false);
        expect(isSupportedCalendarSourceUrl('file:///home/user/bad%ZZ.ics')).toBe(false);
        expect(isSupportedCalendarSourceUrl('ftp://calendar.example/work.ics')).toBe(false);
    });

    it('lists a subscription URL without its user name and password', () => {
        expect(maskCalendarSourceUrl('https://alex:s3cret@calendar.example.com/team/basic.ics')).toBe('https://calendar.example.com/...ic.ics');
        expect(maskCalendarSourceUrl('webcal://alex:s3cret@calendar.example.com')).not.toMatch(/alex|s3cret|cret/);
        expect(maskCalendarSourceUrl(' https://calendar.example.com/team/basic.ics ')).toBe('https://calendar.example.com/...ic.ics');
        expect(maskCalendarSourceUrl('file:///home/alex/My%20Plan.ics')).toBe('Local file /.../My Plan.ics');
    });
});
