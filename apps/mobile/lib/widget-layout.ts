const DEFAULT_WIDGET_HEIGHT_DP = 180;
const EXTRA_ITEM_HEIGHT_STEP_DP = 70;
const MIN_VISIBLE_WIDGET_ITEMS = 3;
const MAX_VISIBLE_WIDGET_ITEMS = 8;

const toFiniteNumber = (value: unknown): number => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

export const getAdaptiveWidgetTaskLimit = (widgetHeightDp: number): number => {
    const height = toFiniteNumber(widgetHeightDp);
    if (height <= 0) return MIN_VISIBLE_WIDGET_ITEMS;

    const extra = Math.floor(Math.max(0, height - DEFAULT_WIDGET_HEIGHT_DP) / EXTRA_ITEM_HEIGHT_STEP_DP);
    const next = MIN_VISIBLE_WIDGET_ITEMS + extra;
    return Math.max(MIN_VISIBLE_WIDGET_ITEMS, Math.min(MAX_VISIBLE_WIDGET_ITEMS, next));
};

