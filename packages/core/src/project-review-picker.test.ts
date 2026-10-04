import { afterEach, describe, expect, it } from 'vitest';
import { projectReviewPickerValue } from './project-details-presentation';

// RN's Android date picker (@react-native-community/datetimepicker DatePickerModule.onDateSet): a Calendar in the device's zone
// set to the picked day at the opened value's hour and minute, seconds and milliseconds 0; RN then stores date.toISOString().
// The zone's rules come from Intl (ICU on Android, as Java's Calendar), never the engine's local Date conversion: QuickJS
// resolves local times near a transition with the wrong offset. Each case runs with the process in another zone to prove it.
describe('projectReviewPickerValue', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });
    const ny = (day: string, opened: string) => {
        process.env.TZ = 'Asia/Tokyo';
        return projectReviewPickerValue(day, opened, 'America/New_York');
    };

    it('keeps the opened hour and minute and clears seconds and milliseconds, as RN Android does', () => {
        // Opened at 17:23:37.456 EDT; picked a winter day: 17:23 EST.
        expect(ny('2026-11-20', '2026-10-04T21:23:37.456Z')).toBe('2026-11-20T22:23:00.000Z');
    });

    it('takes the standard offset after clocks are set back, as Java Calendar does', () => {
        // 2026-11-01 03:30 is EST (UTC-5): 08:30Z.
        expect(ny('2026-11-01', '2026-10-04T07:30:00.000Z')).toBe('2026-11-01T08:30:00.000Z');
    });

    it('resolves a repeated hour (clocks set back) to its later instant, as Java Calendar does', () => {
        // 01:30 happens twice on 2026-11-01: 05:30Z (EDT) and 06:30Z (EST). RN's Calendar answers 06:30Z.
        expect(ny('2026-11-01', '2026-10-04T05:30:12.000Z')).toBe('2026-11-01T06:30:00.000Z');
    });

    it('moves a skipped hour (clocks set forward) forward, as lenient Java Calendar does', () => {
        // 02:30 does not exist on 2026-03-08: RN's lenient Calendar answers 03:30 EDT, 07:30Z.
        expect(ny('2026-03-08', '2026-10-04T06:30:00.000Z')).toBe('2026-03-08T07:30:00.000Z');
        // 03:30 that day is EDT (UTC-4): 07:30Z.
        expect(ny('2026-03-08', '2026-10-04T07:30:00.000Z')).toBe('2026-03-08T07:30:00.000Z');
    });

    it('refuses a malformed day, instant or zone', () => {
        expect(projectReviewPickerValue('2026-3-8', '2026-10-04T06:30:00.000Z', 'America/New_York')).toBeNull();
        expect(projectReviewPickerValue('2026-03-08', 'not a date', 'America/New_York')).toBeNull();
        expect(projectReviewPickerValue('2026-03-08', '2026-10-04T06:30:00.000Z', 'Not/AZone')).toBeNull();
    });
});
