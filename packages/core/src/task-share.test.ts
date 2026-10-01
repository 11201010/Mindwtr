import { expect, it } from 'vitest';
import { buildTaskShare } from './task-share';
import type { Task } from './types';

const task: Task = {
    id: 'task-1', title: 'Saved title', status: 'next', priority: 'medium',
    contexts: ['saved'], tags: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};
const labels: Record<string, string> = {
    'taskEdit.statusLabel': 'Status', 'status.waiting': 'Waiting', 'status.next': 'Next',
    'taskEdit.priorityLabel': 'Priority', 'priority.high': 'High',
    'taskEdit.startDateLabel': 'Start', 'taskEdit.dueDateLabel': 'Due', 'taskEdit.reviewDateLabel': 'Review',
    'taskEdit.timeEstimateLabel': 'Estimate', 'taskEdit.contextsLabel': 'Contexts', 'taskEdit.tagsLabel': 'Tags',
    'taskEdit.descriptionLabel': 'Description', 'taskEdit.checklist': 'Checklist',
};
const callbacks = {
    t: (key: string) => labels[key] ?? key,
    formatDate: (value?: string) => `date(${value})`,
    formatDueDate: (value?: string) => `due(${value})`,
    formatTimeEstimateLabel: (value: NonNullable<Task['timeEstimate']>) => `estimate(${value})`,
};

it('preserves the RN editor Share payload, field order, blank lines, raw checklist, and date callbacks', () => {
    const content = buildTaskShare({ task, rawTitle: '  Draft title  ', mergedTask: {
        title: 'Merged title', status: 'waiting', priority: 'high',
        startTime: '2026-10-03', dueDate: '2026-10-04T15:00:00.000Z', reviewAt: '2026-10-05',
        timeEstimate: '30min', contexts: ['home', ''], tags: ['🚀', ''],
        description: '  Line one\nLine two  ',
        checklist: [
            { id: 'a', title: 'Done item', isCompleted: true },
            { id: 'b', title: 'Open item', isCompleted: false },
            { id: 'c', title: '', isCompleted: false },
        ],
        assignedTo: 'Someone',
        attachments: [{ id: 'file', kind: 'link', title: 'Example', uri: 'https://example.invalid/',
            createdAt: task.createdAt, updatedAt: task.updatedAt }],
    }, prioritiesEnabled: true, timeEstimatesEnabled: true, ...callbacks });
    expect(content).toEqual({ title: 'Draft title', message: [
        'Draft title', 'Status: Waiting', 'Priority: High', 'Start: date(2026-10-03)',
        'Due: due(2026-10-04T15:00:00.000Z)', 'Review: date(2026-10-05)', 'Estimate: estimate(30min)',
        'Contexts: home', 'Tags: 🚀', '', 'Description:', 'Line one\nLine two', '', 'Checklist:',
        '[x] Done item', '[ ] Open item',
    ].join('\n') });
});

it('uses the exact title fallbacks and leaves disabled or empty metadata out', () => {
    expect(buildTaskShare({ task, rawTitle: null, mergedTask: { title: '  Merged  ', priority: 'high',
        timeEstimate: '30min', contexts: ['', ''], tags: [], description: '  ', checklist: [] },
    prioritiesEnabled: false, timeEstimatesEnabled: false, ...callbacks })).toEqual({
        title: 'Merged', message: 'Merged\nStatus: Next',
    });
    expect(buildTaskShare({ task, rawTitle: '', mergedTask: {}, prioritiesEnabled: false,
        timeEstimatesEnabled: false, ...callbacks })).toEqual({ title: undefined, message: 'Status: Next' });
    expect(buildTaskShare({ task: null, mergedTask: {}, prioritiesEnabled: true,
        timeEstimatesEnabled: true, ...callbacks })).toBeNull();
});
