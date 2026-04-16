import { describe, expect, it } from 'vitest';

import {
    formatFocusTimeEstimateLabel,
    getFocusTokenOptions,
    NO_PROJECT_FILTER_ID,
    splitFocusedTasks,
    taskMatchesFocusFilters,
} from './focus-screen-utils';

describe('splitFocusedTasks', () => {
    it('separates focused tasks while preserving relative order inside each group', () => {
        const { focusedTasks, otherTasks } = splitFocusedTasks([
            { id: 'due-1', isFocusedToday: false },
            { id: 'focus-1', isFocusedToday: true },
            { id: 'due-2', isFocusedToday: false },
            { id: 'focus-2', isFocusedToday: true },
            { id: 'focus-3', isFocusedToday: true },
        ]);

        expect(focusedTasks.map((task) => task.id)).toEqual([
            'focus-1',
            'focus-2',
            'focus-3',
        ]);
        expect(otherTasks.map((task) => task.id)).toEqual([
            'due-1',
            'due-2',
        ]);
    });

    it('returns empty groups when one side is absent', () => {
        const tasks = [
            { id: 'focus-1', isFocusedToday: true },
            { id: 'focus-2', isFocusedToday: true },
        ];

        expect(splitFocusedTasks(tasks)).toEqual({
            focusedTasks: tasks,
            otherTasks: [],
        });
    });
});

describe('getFocusTokenOptions', () => {
    it('returns sorted unique contexts and tags', () => {
        expect(getFocusTokenOptions([
            { contexts: ['@work', '@home', ''], tags: ['#deep'] },
            { contexts: ['@work/calls', '@home'], tags: ['#deep', '#ops'] },
            { contexts: [], tags: [] },
        ] as any)).toEqual(['@home', '@work', '@work/calls', '#deep', '#ops']);
    });
});

describe('taskMatchesFocusFilters', () => {
    it('matches direct and hierarchical token filters', () => {
        const task = { contexts: ['@work/deep', '@home'], tags: ['#ops'], projectId: 'p1' };

        expect(taskMatchesFocusFilters(task as any, {
            tokens: ['@work'],
            projects: [],
            priorities: [],
            energyLevels: [],
            timeEstimates: [],
        })).toBe(true);
        expect(taskMatchesFocusFilters(task as any, {
            tokens: ['#ops'],
            projects: [],
            priorities: [],
            energyLevels: [],
            timeEstimates: [],
        })).toBe(true);
        expect(taskMatchesFocusFilters(task as any, {
            tokens: ['@errands'],
            projects: [],
            priorities: [],
            energyLevels: [],
            timeEstimates: [],
        })).toBe(false);
    });

    it('matches project, no-project, priority, energy and time filters', () => {
        const task = {
            contexts: ['@work'],
            tags: ['#ops'],
            projectId: 'project-1',
            priority: 'high',
            energyLevel: 'medium',
            timeEstimate: '30min',
        };

        expect(taskMatchesFocusFilters(task as any, {
            tokens: [],
            projects: ['project-1'],
            priorities: ['high'],
            energyLevels: ['medium'],
            timeEstimates: ['30min'],
        })).toBe(true);

        expect(taskMatchesFocusFilters(task as any, {
            tokens: [],
            projects: [NO_PROJECT_FILTER_ID],
            priorities: [],
            energyLevels: [],
            timeEstimates: [],
        })).toBe(false);
    });
});

describe('formatFocusTimeEstimateLabel', () => {
    it('formats estimate chips compactly', () => {
        expect(formatFocusTimeEstimateLabel('5min')).toBe('5m');
        expect(formatFocusTimeEstimateLabel('4hr+')).toBe('4h+');
    });
});
