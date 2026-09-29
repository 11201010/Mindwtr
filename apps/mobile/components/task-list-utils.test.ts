import { describe, expect, it } from 'vitest';

import {
  buildProjectTaskReorderGroups,
  flattenProjectReorderGroups,
  getBulkActionFailureMessage,
  resolveProjectReorderDropPlan,
  sortProjectTasksByOrder,
  type ProjectReorderFlatItem,
  type ProjectTaskReorderGroup,
} from './task-list-utils';

describe('getBulkActionFailureMessage', () => {
    it('returns the error message when one exists', () => {
        expect(getBulkActionFailureMessage(new Error('Tasks not found: t1'), 'Move failed.')).toBe('Tasks not found: t1');
    });

    it('uses the fallback when the error message is empty', () => {
        expect(getBulkActionFailureMessage(new Error('   '), 'Delete failed.')).toBe('Delete failed.');
    });
});

describe('buildProjectTaskReorderGroups', () => {
    it('groups tasks by section for section-scoped dragging', () => {
        const groups = buildProjectTaskReorderGroups([
            { type: 'section' as const, id: 'section-a', title: 'First' },
            { type: 'task' as const, task: { id: 'a1' } },
            { type: 'task' as const, task: { id: 'a2' } },
            { type: 'section' as const, id: 'section-b', title: 'Second' },
            { type: 'task' as const, task: { id: 'b1' } },
            { type: 'section' as const, id: 'empty', title: 'Empty' },
            { type: 'section' as const, id: 'no-section', title: 'No Section', muted: true, synthetic: 'none' as const },
            { type: 'task' as const, task: { id: 'u1' } },
        ]);

        expect(groups.map((group) => ({
            id: group.id,
            sectionId: group.sectionId,
            taskIds: group.tasks.map((task) => task.id),
            title: group.title,
            muted: group.muted,
        }))).toEqual([
            { id: 'section-a', sectionId: 'section-a', taskIds: ['a1', 'a2'], title: 'First', muted: undefined },
            { id: 'section-b', sectionId: 'section-b', taskIds: ['b1'], title: 'Second', muted: undefined },
            { id: 'no-section', sectionId: null, taskIds: ['u1'], title: 'No Section', muted: true },
        ]);
    });

    it('keeps unsectioned project tasks in a single project-level group', () => {
        const groups = buildProjectTaskReorderGroups([
            { type: 'task' as const, reorderSectionId: undefined, task: { id: 'first' } },
            { type: 'task' as const, reorderSectionId: undefined, task: { id: 'second' } },
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0]?.sectionId).toBeUndefined();
        expect(groups[0]?.tasks.map((task) => task.id)).toEqual(['first', 'second']);
    });

    it('distinguishes a real no-section header from the synthetic unsectioned header', () => {
        const groups = buildProjectTaskReorderGroups([
            { type: 'section', id: 'no-section', title: 'Stored' },
            { type: 'task', task: { id: 'real' } },
            { type: 'section', id: 'no-section:1', title: 'Unsectioned', synthetic: 'none' },
            { type: 'task', task: { id: 'loose' } },
        ]);
        expect(groups.map((group) => [group.id, group.sectionId])).toEqual([
            ['no-section', 'no-section'], ['no-section:1', null],
        ]);
    });

    it('can keep empty sections for section reordering', () => {
        const groups = buildProjectTaskReorderGroups([
            { type: 'section' as const, id: 'empty', title: 'Empty' },
            { type: 'section' as const, id: 'filled', title: 'Filled' },
            { type: 'task' as const, task: { id: 'task-1' } },
        ], { includeEmptySections: true });

        expect(groups.map((group) => ({
            id: group.id,
            taskIds: group.tasks.map((task) => task.id),
            title: group.title,
        }))).toEqual([
            { id: 'empty', taskIds: [], title: 'Empty' },
            { id: 'filled', taskIds: ['task-1'], title: 'Filled' },
        ]);
    });
});

describe('flattenProjectReorderGroups + resolveProjectReorderDropPlan', () => {
  type TestTask = { id: string };
  const makeGroups = (): ProjectTaskReorderGroup<TestTask>[] => [
    { id: 'sec-a', sectionId: 'sec-a', title: 'Section A', tasks: [{ id: 't1' }] },
    { id: 'sec-b', sectionId: 'sec-b', title: 'Section B', tasks: [{ id: 't2' }, { id: 't3' }] },
    { id: 'sec-empty', sectionId: 'sec-empty', title: 'Empty', tasks: [] },
  ];

  it('flattens titled groups into header rows followed by their tasks', () => {
    const items = flattenProjectReorderGroups(makeGroups());
    expect(items.map((item) => item.key)).toEqual([
      'section:sec-a', 'task:t1', 'section:sec-b', 'task:t2', 'task:t3', 'section:sec-empty',
    ]);
  });

  it('omits header rows for untitled leading groups', () => {
    const items = flattenProjectReorderGroups([
      { id: 'project', sectionId: null, tasks: [{ id: 't0' }] },
      ...makeGroups(),
    ]);
    expect(items[0]).toEqual({ type: 'task', key: 'task:t0', task: { id: 't0' } });
    expect(items[1]).toEqual(expect.objectContaining({ key: 'section:sec-a' }));
  });

  const header = (id: string): ProjectReorderFlatItem<TestTask> => ({
    type: 'header',
    key: `header-${id}`,
    group: { id, sectionId: id, title: id, tasks: [] },
  });
  const task = (id: string): ProjectReorderFlatItem<TestTask> => ({ type: 'task', key: id, task: { id } });

  it('keeps a task in its own section when reordered within it', () => {
    const plan = resolveProjectReorderDropPlan(
      [header('sec-b'), task('t3'), task('t2'), header('sec-c'), task('t4')],
      't3',
    );
    expect(plan).toEqual({ sectionId: 'sec-b', orderedIds: ['t3', 't2'] });
  });

  it('assigns the section whose header sits above the drop position', () => {
    const plan = resolveProjectReorderDropPlan(
      [header('sec-a'), task('t1'), header('sec-b'), task('t2'), task('t1-moved-away'), task('t3')],
      't1-moved-away',
    );
    expect(plan).toEqual({ sectionId: 'sec-b', orderedIds: ['t2', 't1-moved-away', 't3'] });
  });

  it('drops a task into an empty section', () => {
    const plan = resolveProjectReorderDropPlan(
      [header('sec-a'), task('t1'), header('sec-empty'), task('t2')],
      't2',
    );
    expect(plan).toEqual({ sectionId: 'sec-empty', orderedIds: ['t2'] });
  });

  it('treats tasks above the first header as unsectioned', () => {
    const plan = resolveProjectReorderDropPlan(
      [task('t2'), header('sec-a'), task('t1')],
      't2',
    );
    expect(plan).toEqual({ sectionId: null, orderedIds: ['t2'] });
  });

  it('returns null when the moved task is not present', () => {
    expect(resolveProjectReorderDropPlan([header('sec-a'), task('t1')], 'missing')).toBeNull();
  });
});

describe('sortProjectTasksByOrder', () => {
    it('sorts by order values before falling back to created time', () => {
        expect(sortProjectTasksByOrder([
            { id: 'no-order-old', createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'second', order: 2, createdAt: '2026-01-02T00:00:00.000Z' },
            { id: 'first', orderNum: 1, createdAt: '2026-01-03T00:00:00.000Z' },
            { id: 'no-order-new', createdAt: '2026-01-04T00:00:00.000Z' },
        ]).map((task) => task.id)).toEqual(['first', 'second', 'no-order-old', 'no-order-new']);
    });

    it('falls back to created time when no task has an order value', () => {
        expect(sortProjectTasksByOrder([
            { id: 'newer', createdAt: '2026-01-02T00:00:00.000Z' },
            { id: 'older', createdAt: '2026-01-01T00:00:00.000Z' },
        ]).map((task) => task.id)).toEqual(['older', 'newer']);
    });

    it('pins full (order, createdAt) ties by id regardless of array order (#784)', () => {
        const tied = (id: string) => ({ id, order: 5, createdAt: '2026-01-01T00:00:00.000Z' });
        expect(sortProjectTasksByOrder([tied('dup-b'), tied('dup-c'), tied('dup-a')]).map((task) => task.id))
            .toEqual(['dup-a', 'dup-b', 'dup-c']);
        expect(sortProjectTasksByOrder([tied('dup-c'), tied('dup-a'), tied('dup-b')]).map((task) => task.id))
            .toEqual(['dup-a', 'dup-b', 'dup-c']);
    });
});
