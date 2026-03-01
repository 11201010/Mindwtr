import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';
import { resolveGlobalSearchTaskView } from './GlobalSearch';

const baseTask: Task = {
    id: 'task-1',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-02-27T00:00:00.000Z',
    updatedAt: '2026-02-27T00:00:00.000Z',
};

describe('resolveGlobalSearchTaskView', () => {
    it('falls back to review for deferred next tasks', () => {
        const result = resolveGlobalSearchTaskView(
            {
                ...baseTask,
                status: 'next',
                startTime: '2026-02-28T10:00:00.000Z',
            },
            new Date('2026-02-27T09:00:00.000Z')
        );
        expect(result).toBe('review');
    });

    it('keeps next view for currently visible next tasks', () => {
        const result = resolveGlobalSearchTaskView(
            {
                ...baseTask,
                status: 'next',
                startTime: '2026-02-27T10:00:00.000Z',
            },
            new Date('2026-02-27T09:00:00.000Z')
        );
        expect(result).toBe('next');
    });

    it('maps reference tasks to reference view', () => {
        const result = resolveGlobalSearchTaskView({
            ...baseTask,
            status: 'reference',
        });
        expect(result).toBe('reference');
    });
});
