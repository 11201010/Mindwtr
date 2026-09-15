import { describe, expect, it } from 'vitest';
import type { Area, Project, Task } from '@mindwtr/core';

import {
  DEFAULT_APPLE_SEARCH_FILTERS,
  revalidateAppleSearchMatches,
} from './apple-search-evaluation';

const now = '2026-09-14T12:00:00.000Z';
const task = (id: string, title: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title,
  status: 'next',
  tags: [],
  contexts: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const project = (id: string, overrides: Partial<Project> = {}): Project => ({
  id,
  title: `Project ${id}`,
  status: 'active',
  color: '#000000',
  order: 0,
  tagIds: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const area = (id: string): Area => ({
  id,
  name: `Area ${id}`,
  order: 0,
  createdAt: now,
  updatedAt: now,
});

describe('apple-search-evaluation revalidation', () => {
  it('uses stable ids to select one of two tasks with the same title', () => {
    const tasks = [task('task-1', 'Renew passport'), task('task-2', 'Renew passport')];
    const result = revalidateAppleSearchMatches({
      query: 'passport paperwork',
      nativeMatches: [{ indexedId: 'opaque-2', taskId: 'task-2' }],
      tasks,
      projects: [],
      areas: [],
      filters: DEFAULT_APPLE_SEARCH_FILTERS,
    });

    expect(result.tasks.map((item) => item.id)).toEqual(['task-2']);
  });

  it('drops deleted and missing indexed ids instead of substituting a title match', () => {
    const tasks = [
      task('deleted', 'Book appointment', { deletedAt: now }),
      task('replacement', 'Book appointment'),
    ];
    const result = revalidateAppleSearchMatches({
      query: 'appointment',
      nativeMatches: [
        { indexedId: 'opaque-deleted', taskId: 'deleted' },
        { indexedId: 'opaque-missing', taskId: 'missing' },
      ],
      tasks,
      projects: [],
      areas: [],
      filters: DEFAULT_APPLE_SEARCH_FILTERS,
    });

    expect(result.tasks).toEqual([]);
    expect(result.unavailableTaskIds).toEqual(['deleted', 'missing']);
  });

  it('keeps explicit status, area, token, and project-scope filters authoritative', () => {
    const tasks = [
      task('allowed', 'Submit forms', { status: 'waiting', projectId: 'p1', tags: ['#admin'] }),
      task('wrong-status', 'Submit forms', { status: 'next', projectId: 'p1', tags: ['#admin'] }),
      task('wrong-area', 'Submit forms', { status: 'waiting', projectId: 'p2', tags: ['#admin'] }),
      task('wrong-token', 'Submit forms', { status: 'waiting', projectId: 'p1', tags: ['#travel'] }),
    ];
    const nativeMatches = tasks.map((item, index) => ({ indexedId: `opaque-${index}`, taskId: item.id }));
    const result = revalidateAppleSearchMatches({
      query: 'forms',
      nativeMatches,
      tasks,
      projects: [project('p1', { areaId: 'a1' }), project('p2', { areaId: 'a2' })],
      areas: [area('a1'), area('a2')],
      filters: {
        ...DEFAULT_APPLE_SEARCH_FILTERS,
        selectedStatuses: ['waiting'],
        selectedArea: 'a1',
        selectedTokens: ['#admin'],
        scope: 'project_tasks',
      },
    });

    expect(result.tasks.map((item) => item.id)).toEqual(['allowed']);
    expect(result.filteredTaskIds).toEqual(['wrong-status', 'wrong-area', 'wrong-token']);
  });

  it('hydrates current task fields instead of returning stale indexed text', () => {
    const current = task('task-1', 'Renew Canadian passport');
    const result = revalidateAppleSearchMatches({
      query: 'passport',
      nativeMatches: [{ indexedId: 'opaque-old-record', taskId: 'task-1' }],
      tasks: [current],
      projects: [],
      areas: [],
      filters: DEFAULT_APPLE_SEARCH_FILTERS,
    });

    expect(result.tasks).toEqual([current]);
    expect(result.tasks[0].title).toBe('Renew Canadian passport');
  });
});
