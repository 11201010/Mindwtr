import { describe, expect, it } from 'vitest';

import { normalizeDateInputValue } from './task-item-helpers';

describe('normalizeDateInputValue', () => {
    const referenceNow = new Date('2026-02-24T12:00:00.000Z');

    it('keeps fully specified dates unchanged', () => {
        expect(normalizeDateInputValue('2026-03-05', referenceNow)).toBe('2026-03-05');
    });

    it('fills blank year/month/day segments from current date', () => {
        expect(normalizeDateInputValue('0000-00-15', referenceNow)).toBe('2026-02-15');
        expect(normalizeDateInputValue('2027-00-00', referenceNow)).toBe('2027-02-24');
    });

    it('clamps overflow day after filling blanks', () => {
        expect(normalizeDateInputValue('0000-02-31', referenceNow)).toBe('2026-02-28');
    });

    it('returns non-date input unchanged', () => {
        expect(normalizeDateInputValue('not-a-date', referenceNow)).toBe('not-a-date');
    });
});
