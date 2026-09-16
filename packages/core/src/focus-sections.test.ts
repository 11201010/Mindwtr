import { describe, expect, it } from 'vitest';
import { buildFocusPools, deriveFocusTaskLists, type FocusPools } from './focus-sections';
import { computeTodayFocusTasks } from './focus-widget-selection';
import type { Project, Section, Task } from './types';

const NOW = new Date('2026-03-10T09:00:00');
const iso = (value: string) => new Date(value).toISOString();

const makeTask = (overrides: Partial<Task> & Pick<Task, 'id'>): Task => ({
    title: overrides.id,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: iso('2026-01-01T08:00:00'),
    updatedAt: iso('2026-01-01T08:00:00'),
    ...overrides,
});

const makeProject = (overrides: Partial<Project> & Pick<Project, 'id'>): Project => ({
    title: overrides.id,
    status: 'active',
    color: '#2563EB',
    order: 0,
    tagIds: [],
    createdAt: iso('2026-01-01T08:00:00'),
    updatedAt: iso('2026-01-01T08:00:00'),
    ...overrides,
});

const ids = (tasks: Task[]) => tasks.map((task) => task.id);

const derive = (pools: Partial<FocusPools> & Pick<FocusPools, 'base'>, ctx: {
    projects?: Project[];
    sections?: Section[];
    sortBy?: 'default' | 'title';
    prioritiesEnabled?: boolean;
} = {}) => deriveFocusTaskLists({
    focused: pools.focused ?? [],
    active: pools.active ?? pools.base,
    schedule: pools.schedule ?? pools.base,
    upcoming: pools.upcoming ?? [],
    base: pools.base,
}, {
    now: NOW,
    projects: ctx.projects ?? [],
    sections: ctx.sections ?? [],
    sortBy: ctx.sortBy ?? 'default',
    prioritiesEnabled: ctx.prioritiesEnabled ?? false,
});

describe('buildFocusPools', () => {
    const starredHidden = makeTask({ id: 'starred-hidden', isFocusedToday: true, startTime: iso('2026-03-20T09:00:00') });
    const laterToday = makeTask({ id: 'later-today', startTime: iso('2026-03-10T18:00:00') });
    const nextWeek = makeTask({ id: 'next-week', startTime: iso('2026-03-12T09:00:00') });
    const plain = makeTask({ id: 'plain' });
    const all = [starredHidden, laterToday, nextWeek, plain];

    const pools = () => buildFocusPools({
        tasks: all,
        visibleTasks: [laterToday, nextWeek, plain],
        projects: [],
        criteria: {},
        now: NOW,
    });

    it('keeps a starred task the start-time and area rules would hide', () => {
        expect(ids(pools().focused)).toEqual(['starred-hidden']);
    });

    it('hides a later-today start from the time-granularity pool but keeps it in Today', () => {
        expect(ids(pools().active)).toEqual(['plain']);
        expect(ids(pools().schedule)).toEqual(['later-today', 'plain']);
    });

    it('sends a task deferred to another day to Upcoming, not Today', () => {
        expect(pools().upcoming.map((entry) => entry.task.id)).toEqual(['next-week']);
        expect(ids(pools().schedule)).not.toContain('next-week');
    });

    it('applies the caller predicate to every pool', () => {
        const kept = buildFocusPools({
            tasks: all,
            visibleTasks: all,
            projects: [],
            criteria: {},
            now: NOW,
            keep: (task) => task.id !== 'plain',
        });
        expect(ids(kept.active)).toEqual([]);
        expect(ids(kept.schedule)).toEqual(['later-today']);
    });
});

describe('deriveFocusTaskLists', () => {
    it('buckets Today, Review Due and Next actions without repeating a task', () => {
        const dueToday = makeTask({ id: 'due-today', dueDate: iso('2026-03-10T17:00:00') });
        const reviewDue = makeTask({ id: 'review-due', reviewAt: iso('2026-03-09T08:00:00') });
        const plain = makeTask({ id: 'plain' });
        const lists = derive({ base: [dueToday, reviewDue, plain] });
        expect(ids(lists.schedule)).toEqual(['due-today']);
        expect(ids(lists.reviewDue)).toEqual(['review-due']);
        expect(ids(lists.nextActions)).toEqual(['plain']);
    });

    it('keeps a waiting task out of Today and Next actions but in Review Due', () => {
        const waiting = makeTask({ id: 'waiting', status: 'waiting', reviewAt: iso('2026-03-09T08:00:00'), dueDate: iso('2026-03-10T10:00:00') });
        const lists = derive({ base: [waiting] });
        expect(ids(lists.schedule)).toEqual([]);
        expect(ids(lists.nextActions)).toEqual([]);
        expect(ids(lists.reviewDue)).toEqual(['waiting']);
    });

    it('breaks an equal Today time by priority and then creation order', () => {
        const at = iso('2026-03-10T17:00:00');
        const low = makeTask({ id: 'low', dueDate: at, priority: 'low', createdAt: iso('2026-01-01T08:00:00') });
        const urgent = makeTask({ id: 'urgent', dueDate: at, priority: 'urgent', createdAt: iso('2026-02-01T08:00:00') });
        const older = makeTask({ id: 'older', dueDate: at, createdAt: iso('2025-12-01T08:00:00') });
        const lists = derive({ base: [low, urgent, older] }, { prioritiesEnabled: true });
        expect(ids(lists.schedule)).toEqual(['urgent', 'low', 'older']);
        const noPriorities = derive({ base: [low, urgent, older] });
        expect(ids(noPriorities.schedule)).toEqual(['older', 'low', 'urgent']);
    });

    it('breaks an equal Review Due time by priority and then creation order', () => {
        const at = iso('2026-03-09T08:00:00');
        const low = makeTask({ id: 'low', reviewAt: at, priority: 'low', createdAt: iso('2026-01-01T08:00:00') });
        const urgent = makeTask({ id: 'urgent', reviewAt: at, priority: 'urgent', createdAt: iso('2026-02-01T08:00:00') });
        const lists = derive({ base: [low, urgent] }, { prioritiesEnabled: true });
        expect(ids(lists.reviewDue)).toEqual(['urgent', 'low']);
    });

    it('gives a sequential project one slot and keeps the blocked steps out of Upcoming', () => {
        const sequential = makeProject({ id: 'seq', isSequential: true });
        const steps = [
            makeTask({ id: 'step-1', projectId: 'seq', order: 0, orderNum: 0 }),
            makeTask({ id: 'step-2', projectId: 'seq', order: 1, orderNum: 1, startTime: iso('2026-03-12T09:00:00') }),
        ];
        const lists = deriveFocusTaskLists({
            focused: [],
            active: [steps[0]],
            schedule: [steps[0]],
            upcoming: [{ task: steps[1], appearsAt: new Date('2026-03-12T09:00:00') }],
            base: steps,
        }, { now: NOW, projects: [sequential], sections: [], sortBy: 'default', prioritiesEnabled: false });
        expect(ids(lists.nextActions)).toEqual(['step-1']);
        expect(ids(lists.upcoming)).toEqual([]);
    });

    it('sorts every bucket by the saved perspective when the sort is not the default', () => {
        const b = makeTask({ id: 'b', title: 'B', dueDate: iso('2026-03-10T08:00:00') });
        const a = makeTask({ id: 'a', title: 'A', dueDate: iso('2026-03-10T17:00:00') });
        const lists = derive({ base: [b, a] }, { sortBy: 'title' });
        expect(ids(lists.schedule)).toEqual(['a', 'b']);
        expect(lists.projectDeadlineBoosts.size).toBe(0);
    });
});

describe('computeTodayFocusTasks parity with the screen derivation', () => {
    // One fixture covering every bucket the widget flattens: a later-today
    // start, a due-today task, a review-due waiting task, a sequential project
    // whose step 3 is due today, and a starred someday task.
    const sequential = makeProject({ id: 'seq', isSequential: true });
    const tasks = [
        makeTask({ id: 'later-today', startTime: iso('2026-03-10T18:00:00') }),
        makeTask({ id: 'due-today', dueDate: iso('2026-03-10T12:00:00') }),
        makeTask({ id: 'review-waiting', status: 'waiting', reviewAt: iso('2026-03-09T08:00:00') }),
        makeTask({ id: 'starred-someday', status: 'someday', isFocusedToday: true }),
        makeTask({ id: 'step-1', projectId: 'seq', order: 0, orderNum: 0 }),
        makeTask({ id: 'step-2', projectId: 'seq', order: 1, orderNum: 1 }),
        makeTask({ id: 'step-3', projectId: 'seq', order: 2, orderNum: 2, dueDate: iso('2026-03-10T17:00:00') }),
    ];

    it('equals starred plus Today plus Next actions of the shared lists', () => {
        const widget = computeTodayFocusTasks({ activeTasks: tasks, projects: [sequential], sections: [], sortBy: 'default', now: NOW });
        const lists = deriveFocusTaskLists({
            focused: tasks.filter((task) => task.isFocusedToday === true),
            active: tasks.filter((task) => task.id !== 'later-today'),
            schedule: tasks,
            upcoming: [],
            base: tasks,
        }, { now: NOW, projects: [sequential], sections: [], sortBy: 'default', prioritiesEnabled: false });

        expect(new Set(ids(widget.starredTasks))).toEqual(new Set(ids(lists.focusedTasks)));
        expect(new Set(ids(widget.focusTasks))).toEqual(
            new Set(ids([...lists.schedule, ...lists.nextActions])),
        );
        expect(ids(widget.starredTasks)).toEqual(['starred-someday']);
        expect(ids(widget.focusTasks).sort()).toEqual(['due-today', 'later-today', 'step-3']);
    });
});
