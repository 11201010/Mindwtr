import { beforeEach, describe, expect, it } from 'vitest';
import type { AppData, Task } from '@mindwtr/core';
import { resetFocusWidgetFilter } from './focus-widget-filter';
import { normalizeWidgetListDestinationId, resolveWidgetListDestination } from './widget-list-destination';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, status: 'next', tags: [], contexts: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const data = (tasks: Task[]): AppData => ({ tasks, projects: [], sections: [], areas: [], settings: {} });

describe('widget list destination', () => {
  beforeEach(resetFocusWidgetFilter);
  it('accepts exact Next and filter identifiers, not route or criteria payloads', () => {
    expect(normalizeWidgetListDestinationId('next')).toBe('next');
    expect(normalizeWidgetListDestinationId('filter:desk')).toBe('filter:desk');
    for (const invalid of [undefined, ['next'], 'inbox', 'filter:', 'filter:  ', 'next/../settings', 'next?status=done', 'filter:a\u0000b', 'x'.repeat(1025)]) {
      expect(normalizeWidgetListDestinationId(invalid)).toBeNull();
    }
  });
  it('opens the full live Next list rather than the widget snapshot cap', () => {
    const tasks = Array.from({ length: 90 }, (_, i) => task(`next-${i}`));
    const result = resolveWidgetListDestination(data([...tasks, task('done', { status: 'done' }), task('deleted', { deletedAt: '2026-01-02T00:00:00Z' })]), 'en', 'next');
    expect(result?.tasks).toHaveLength(90);
    expect(new Set(result?.tasks.map((item) => item.id))).toEqual(new Set(tasks.map((item) => item.id)));
  });
  it('resolves a saved filter by identity using its latest criteria and rejects deleted filters', () => {
    const source = data([task('desk', { contexts: ['@desk'] }), task('home', { contexts: ['@home'] })]);
    const filters = [{ id: 'same-title-id', name: 'Desk', view: 'next' as const, criteria: { contexts: ['@desk'] }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: undefined as string | undefined }];
    source.settings.savedFilters = filters;
    expect(resolveWidgetListDestination(source, 'en', 'filter:same-title-id')?.tasks.map((item) => item.id)).toEqual(['desk']);
    filters[0].criteria = { contexts: ['@home'] };
    expect(resolveWidgetListDestination(source, 'en', 'filter:same-title-id')?.tasks.map((item) => item.id)).toEqual(['home']);
    filters[0].deletedAt = '2026-01-02T00:00:00Z';
    expect(resolveWidgetListDestination(source, 'en', 'filter:same-title-id')).toBeNull();
    expect(resolveWidgetListDestination(source, 'en', 'filter:missing')).toBeNull();
  });
});
