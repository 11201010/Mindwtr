import { describe, expect, it } from 'vitest';
import { buildProjectTaskListModel } from './project-task-list-model';
import { buildProjectTaskReorderGroups, buildProjectTaskReorderModel, flattenProjectReorderGroups, planProjectTaskOrderMove, resolveProjectReorderDropPlan } from './project-task-reorder';
import type { Project, Section, Task } from './types';

const stamp = '2026-09-01T00:00:00.000Z';
const project: Project = { id: 'p', title: 'Project', status: 'active', order: 0, color: '#123456',
    createdAt: stamp, updatedAt: stamp };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, projectId: 'p',
    status: 'next', tags: [], contexts: [], createdAt: stamp, updatedAt: stamp, ...extra });
const section = (id: string, order: number): Section => ({ id, projectId: 'p', title: id, order,
    createdAt: stamp, updatedAt: stamp });
const input = (overrides: Partial<Parameters<typeof buildProjectTaskReorderModel>[0]> = {}) => ({
    project, tasks: [task('b', { sectionId: 's2', order: 2 }), task('a', { sectionId: 's1', order: 1 }),
        task('orphan', { sectionId: 'missing', order: 3 }), task('done', { status: 'done', order: 4 })],
    visibleTasks: [task('ref', { status: 'reference', order: 5 })], sections: [section('s1', 0), section('empty', 1), section('s2', 2)],
    allSections: [section('s1', 0), section('empty', 1), section('s2', 2)],
    statusFilter: 'all' as const, criteria: {}, searchQuery: '', sortBy: 'default' as const,
    projectOrder: true, reorderMode: true, groupCompletedTasksLast: true, completedCollapsed: false,
    t: (key: string) => key, ...overrides,
});

describe('shared Project reorder model', () => {
    it('matches the RN helper contract, including empty sections and the Completed split', () => {
        const args = input();
        const model = buildProjectTaskListModel(args);
        const reorderItems = model.items.filter((item) => item.type === 'section'
            ? item.synthetic !== 'completed' : item.task.status !== 'done');
        const expected = flattenProjectReorderGroups(buildProjectTaskReorderGroups(reorderItems, { includeEmptySections: true }));
        const actual = buildProjectTaskReorderModel(args);
        expect(actual.items).toEqual(expected);
        expect(actual.groups.map((group) => [group.id, group.sectionId, group.tasks.map((row) => row.id)]))
            .toEqual([['s1', 's1', ['a']], ['empty', 'empty', []], ['s2', 's2', ['b']], ['no-section', null, ['orphan']]]);
        expect(actual.items.map((item) => item.type === 'header' ? item.group.id : item.task.id))
            .toEqual(['s1', 'a', 'empty', 's2', 'b', 'no-section', 'orphan']);
    });

    it('keeps sequential finished work inline and archived sections read-only in the caller', () => {
        const sequential = buildProjectTaskReorderModel(input({ project: { ...project, isSequential: true }, groupCompletedTasksLast: false }));
        expect(sequential.items.some((item) => item.type === 'task' && item.task.id === 'done')).toBe(true);
        const archived = buildProjectTaskReorderModel(input({ project: { ...project, status: 'archived' },
            sections: [], allSections: [section('s1', 0)], groupCompletedTasksLast: false }));
        expect(archived.items.some((item) => item.type === 'task' && item.task.id === 'done')).toBe(true);
    });

    it('keeps no-header tasks unsectioned and resolves a cross-section drop', () => {
        const plain = buildProjectTaskReorderModel(input({ tasks: [task('plain')], sections: [], allSections: [],
            groupCompletedTasksLast: false }));
        expect(plain.items).toEqual([{ type: 'task', key: 'task:plain', task: task('plain') }]);
        const items = buildProjectTaskReorderModel(input()).items;
        expect(resolveProjectReorderDropPlan(items, 'b')).toEqual({ sectionId: 's2', orderedIds: ['b'] });
    });

    it('distinguishes a real no-section from the synthetic unsectioned target', () => {
        const real = section('no-section', 0);
        const args = input({ sections: [real], allSections: [real],
            tasks: [task('real', { sectionId: real.id }), task('loose')] });
        const model = buildProjectTaskReorderModel(args);
        expect(model.groups.map((group) => [group.id, group.sectionId])).toEqual([
            ['no-section', 'no-section'], ['no-section:1', null],
        ]);
        expect(planProjectTaskOrderMove(model.items, 'loose', { type: 'section', id: 'no-section' })?.drop.sectionId)
            .toBe('no-section');
        expect(planProjectTaskOrderMove(model.items, 'real', { type: 'section', id: 'no-section:1' })?.drop.sectionId)
            .toBeNull();
    });

    it('keeps typed flat keys distinct when a task ID resembles a header key', () => {
        const real = section('s1', 0);
        const model = buildProjectTaskReorderModel(input({ sections: [real], allSections: [real],
            tasks: [task('header-s1', { sectionId: real.id })] }));
        expect(new Set(model.items.map((item) => item.key)).size).toBe(model.items.length);
    });
});
