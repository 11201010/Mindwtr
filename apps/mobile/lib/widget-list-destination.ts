import type { AppData, Language } from '@mindwtr/core';
import { createWidgetPayloadProjection } from './widget-data';
import { getFocusWidgetFilter } from './focus-widget-filter';

/** Route parameters are untrusted. They select local data, never contain criteria. */
export function normalizeWidgetListDestinationId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (value === 'next') return value;
  return value.startsWith('filter:') && value.slice(7).trim().length > 0 ? value : null;
}

export function resolveWidgetListDestination(data: AppData, language: Language, value: unknown) {
  const id = normalizeWidgetListDestinationId(value);
  if (!id) return null;
  // Use the very same core-derived pools as the widget, but keep all live Task
  // entities rather than the capped cached snapshot. Deleted filters fail closed.
  return createWidgetPayloadProjection(data, language, {
    listIds: [id],
    focusFilter: getFocusWidgetFilter(),
  }).getTaskList(id);
}
