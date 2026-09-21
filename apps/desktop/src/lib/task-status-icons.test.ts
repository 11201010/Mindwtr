import { describe, expect, it } from 'vitest';

import { INCUBATE_ICON, START_LATER_ICON, TASK_STATUS_ICONS } from './task-status-icons';

// #1256: an icon only helps while it means one thing. The wizard shows Start later, Someday and
// Incubate in one row, next to statuses the editor shows as pills.
describe('task status icons', () => {
    it('gives every status, Start later and Incubate a glyph of its own', () => {
        const glyphs = [...Object.values(TASK_STATUS_ICONS), START_LATER_ICON, INCUBATE_ICON];
        expect(new Set(glyphs).size).toBe(glyphs.length);
    });
});
