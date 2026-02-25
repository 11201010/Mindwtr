import { describe, expect, it } from 'vitest';

import { getAdaptiveWidgetTaskLimit } from './widget-layout';

describe('widget-layout', () => {
    it('returns at least three items for default/small sizes', () => {
        expect(getAdaptiveWidgetTaskLimit(0)).toBe(3);
        expect(getAdaptiveWidgetTaskLimit(120)).toBe(3);
        expect(getAdaptiveWidgetTaskLimit(180)).toBe(3);
    });

    it('increases item count as widget height grows', () => {
        expect(getAdaptiveWidgetTaskLimit(249)).toBe(3);
        expect(getAdaptiveWidgetTaskLimit(250)).toBe(4);
        expect(getAdaptiveWidgetTaskLimit(320)).toBe(5);
    });

    it('caps item count to avoid overfilling very tall widgets', () => {
        expect(getAdaptiveWidgetTaskLimit(1000)).toBe(8);
    });
});

