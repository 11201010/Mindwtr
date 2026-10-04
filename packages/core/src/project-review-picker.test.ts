import { afterEach, describe, expect, it } from 'vitest';
import { projectReviewPickerValue } from './project-details-presentation';

// RN's Android date picker (@react-native-community/datetimepicker DatePickerModule.onDateSet): a Calendar in the device's zone
// set to the picked day at the opened value's hour and minute, seconds and milliseconds 0; RN then stores date.toISOString().
describe('projectReviewPickerValue', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });

    it('keeps the opened hour and minute and clears seconds and milliseconds, as RN Android does', () => {
        process.env.TZ = 'America/New_York';
        // Opened at 17:23:37.456 EDT; picked a winter day: 17:23 EST.
        expect(projectReviewPickerValue('2026-11-20', '2026-10-04T21:23:37.456Z')).toBe('2026-11-20T22:23:00.000Z');
    });

    it('resolves a repeated hour (clocks set back) to its later instant, as Java Calendar does', () => {
        process.env.TZ = 'America/New_York';
        // 01:30 happens twice on 2026-11-01: 05:30Z (EDT) and 06:30Z (EST). RN's Calendar answers 06:30Z.
        expect(projectReviewPickerValue('2026-11-01', '2026-10-04T05:30:12.000Z')).toBe('2026-11-01T06:30:00.000Z');
    });

    it('moves a skipped hour (clocks set forward) forward, as lenient Java Calendar does', () => {
        process.env.TZ = 'America/New_York';
        // 02:30 does not exist on 2026-03-08: RN's lenient Calendar answers 03:30 EDT, 07:30Z.
        expect(projectReviewPickerValue('2026-03-08', '2026-10-04T06:30:00.000Z')).toBe('2026-03-08T07:30:00.000Z');
    });

    it('refuses a malformed day or instant', () => {
        expect(projectReviewPickerValue('2026-3-8', '2026-10-04T06:30:00.000Z')).toBeNull();
        expect(projectReviewPickerValue('2026-03-08', 'not a date')).toBeNull();
    });
});
