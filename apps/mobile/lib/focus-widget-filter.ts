// The Focus screen's widget selection lives in core (focus-widget-filter.ts),
// which the widget payload builder reads; this app's Focus screen sets it.
import {
    focusWidgetFilterKey,
    getFocusWidgetFilter,
    NO_FOCUS_WIDGET_FILTER,
    resetFocusWidgetFilter,
    setFocusWidgetFilter,
} from '@mindwtr/core/focus-widget-filter';

export type { FocusWidgetFilter } from '@mindwtr/core/focus-widget-filter';
export { focusWidgetFilterKey, getFocusWidgetFilter, NO_FOCUS_WIDGET_FILTER, resetFocusWidgetFilter, setFocusWidgetFilter };
