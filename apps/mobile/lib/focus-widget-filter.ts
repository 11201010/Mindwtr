import type { FilterCriteria, SortField } from '@mindwtr/core';

import { DEFAULT_FOCUS_SORT_BY } from './focus-sections';

/**
 * What the Focus screen is filtering and sorting by right now, so the widget's
 * Focus list can show the same rows (#1173). The screen holds these in React
 * state, not on disk: they last exactly as long as the process does. This
 * module matches that lifetime deliberately — a copy on disk would keep the
 * widget filtered after a restart cleared the screen's own selections, which
 * is the one way the two could disagree with nobody able to see why.
 */
export interface FocusWidgetFilter {
    criteria: FilterCriteria;
    sortBy: SortField;
    /** The active saved filter's direction, when it has one. */
    sortOrder?: 'asc' | 'desc';
}

export const NO_FOCUS_WIDGET_FILTER: FocusWidgetFilter = { criteria: {}, sortBy: DEFAULT_FOCUS_SORT_BY };

let current: FocusWidgetFilter = NO_FOCUS_WIDGET_FILTER;

/** Identity of a selection, for the change check and the widget render fingerprint. */
export function focusWidgetFilterKey(filter: FocusWidgetFilter): string {
    return JSON.stringify([filter.criteria, filter.sortBy, filter.sortOrder ?? null]);
}

export function getFocusWidgetFilter(): FocusWidgetFilter {
    return current;
}

/** Stores the screen's current selection; true when it differs from the last one. */
export function setFocusWidgetFilter(next: FocusWidgetFilter): boolean {
    if (focusWidgetFilterKey(next) === focusWidgetFilterKey(current)) return false;
    current = next;
    return true;
}

export function resetFocusWidgetFilter(): void {
    current = NO_FOCUS_WIDGET_FILTER;
}
