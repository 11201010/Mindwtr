import { describe, expect, it } from 'vitest';

import { getProjectMenuStyle } from './project-menu-position';

const rect = (overrides: Partial<DOMRect>): DOMRect => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...overrides,
});

describe('getProjectMenuStyle', () => {
    it('flips above a trigger near the viewport bottom', () => {
        const style = getProjectMenuStyle(
            rect({ top: 560, bottom: 588, right: 310, width: 28, height: 28 }),
            rect({ width: 220, height: 200 }),
            320,
            600,
        );

        expect(style.top).toBe(356);
        expect(style.left).toBe(90);
        expect(style.maxHeight).toBe(548);
        expect(style.overflowY).toBe('auto');
    });

    it('clamps an oversized menu to the larger viewport side and horizontal gutter', () => {
        const style = getProjectMenuStyle(
            rect({ top: 300, bottom: 328, right: 90, width: 28, height: 28 }),
            rect({ width: 240, height: 700 }),
            320,
            600,
        );

        expect(style.top).toBe(8);
        expect(style.left).toBe(8);
        expect(style.maxHeight).toBe(288);
        expect(style.overflowY).toBe('auto');
    });
});
