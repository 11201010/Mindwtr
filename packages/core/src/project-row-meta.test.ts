import { describe, expect, it } from 'vitest';
import { isFocusedProjectMissingNextAction } from './project-row-meta';
import { computeTaskDerivedState } from './store-helpers';
import type { Project, Task, TaskStatus } from './types';

const project: Project = { id: 'p', title: 'Project', status: 'active', isFocused: true, color: '#888888', createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z' };
const task = (status: TaskStatus, deletedAt?: string): Task => ({ id: 't', title: 'Task', projectId: 'p', status, tags: [], contexts: [], createdAt: project.createdAt, updatedAt: project.updatedAt, deletedAt });
const summary = (tasks: Task[]) => computeTaskDerivedState(tasks).projectTaskSummaryById.get('p');

describe('focused project next-action warning (#1307)', () => {
    it('warns for an empty focused active project', () => {
        expect(isFocusedProjectMissingNextAction(project, summary([]))).toBe(true);
    });
    it.each(['next', 'waiting'] as const)('recognizes a retained %s action', (status) => {
        expect(isFocusedProjectMissingNextAction(project, summary([task(status)]))).toBe(false);
    });
    it.each(['inbox', 'someday', 'done', 'archived', 'reference'] as const)('does not treat %s as a next or waiting action', (status) => {
        expect(isFocusedProjectMissingNextAction(project, summary([task(status)]))).toBe(true);
    });
    it('ignores deleted waiting actions', () => {
        expect(isFocusedProjectMissingNextAction(project, summary([task('waiting', project.updatedAt)]))).toBe(true);
    });
    it('keeps inactive and unfocused projects quiet', () => {
        for (const status of ['waiting', 'someday', 'archived'] as const) {
            expect(isFocusedProjectMissingNextAction({ ...project, status }, undefined)).toBe(false);
        }
        expect(isFocusedProjectMissingNextAction({ ...project, isFocused: false }, undefined)).toBe(false);
    });
});
