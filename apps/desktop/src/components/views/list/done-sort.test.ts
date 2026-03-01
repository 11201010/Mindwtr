import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';
import { sortDoneTasksForListView } from './done-sort';

const createTask = (id: string, title: string, completedAt?: string): Task => ({
    id,
    title,
    status: 'done',
    tags: [],
    contexts: [],
    completedAt,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: completedAt ?? '2026-02-01T00:00:00.000Z',
});

describe('sortDoneTasksForListView', () => {
    it('sorts done tasks by most recent completion first', () => {
        const sorted = sortDoneTasksForListView([
            createTask('a', 'Old', '2026-02-20T10:00:00.000Z'),
            createTask('b', 'Newest', '2026-02-22T10:00:00.000Z'),
            createTask('c', 'Middle', '2026-02-21T10:00:00.000Z'),
        ]);

        expect(sorted.map((task) => task.id)).toEqual(['b', 'c', 'a']);
    });

    it('falls back to updatedAt when completedAt is missing', () => {
        const sorted = sortDoneTasksForListView([
            {
                ...createTask('a', 'Alpha'),
                updatedAt: '2026-02-20T10:00:00.000Z',
            },
            {
                ...createTask('b', 'Beta'),
                updatedAt: '2026-02-22T10:00:00.000Z',
            },
        ]);

        expect(sorted.map((task) => task.id)).toEqual(['b', 'a']);
    });
});
