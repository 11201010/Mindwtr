import { describe, expect, it } from 'vitest';
import { countActiveBoardFilters, resolveBoardColumnReorder, resolveBoardDropColumnIndex, resolveBoardDropColumnIndexFromY, toggleCriteriaDuePreset, toggleCriteriaToken } from './board-view.utils';

describe('toggleCriteriaToken', () => {
    it('adds a context token under contexts', () => {
        expect(toggleCriteriaToken({}, '@work')).toEqual({ contexts: ['@work'] });
    });

    it('routes a tag token under tags', () => {
        expect(toggleCriteriaToken({}, '#urgent')).toEqual({ tags: ['#urgent'] });
    });

    it('removes a context token that is already selected', () => {
        expect(toggleCriteriaToken({ contexts: ['@work'] }, '@work')).toEqual({});
    });

    it('keeps other selected tokens when toggling one off', () => {
        expect(toggleCriteriaToken({ contexts: ['@work', '@home'] }, '@work')).toEqual({ contexts: ['@home'] });
    });
});

describe('toggleCriteriaDuePreset', () => {
    it('sets the due-date preset when none is active', () => {
        expect(toggleCriteriaDuePreset({}, 'overdue')).toEqual({ dueDateRange: { preset: 'overdue' } });
    });

    it('clears the due-date range when the same preset is toggled off', () => {
        expect(toggleCriteriaDuePreset({ dueDateRange: { preset: 'overdue' } }, 'overdue')).toEqual({});
    });

    it('replaces a different active preset', () => {
        expect(toggleCriteriaDuePreset({ dueDateRange: { preset: 'today' } }, 'overdue')).toEqual({ dueDateRange: { preset: 'overdue' } });
    });
});

describe('countActiveBoardFilters', () => {
    it('counts contexts, tags, project filters, and the due-date range', () => {
        expect(countActiveBoardFilters({
            contexts: ['@a', '@b'],
            tags: ['#x'],
            projects: ['p1', 'p2'],
            dueDateRange: { preset: 'today' },
        })).toBe(6);
    });

    it('counts excluded and advanced criteria through the shared core counter', () => {
        expect(countActiveBoardFilters({
            excludedContexts: ['@blocked'],
            excludedTags: ['#later'],
            priority: ['high'],
            hasDescription: true,
        })).toBe(4);
    });

    it('is zero for empty criteria', () => {
        expect(countActiveBoardFilters({})).toBe(0);
    });
});

describe('resolveBoardDropColumnIndex', () => {
    it('keeps current column when drag is below trigger distance', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 20,
            currentColumnIndex: 2,
            columnCount: 5,
        })).toBe(2);
    });

    it('moves one column when crossing trigger distance', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 32,
            currentColumnIndex: 1,
            columnCount: 5,
        })).toBe(2);
    });

    it('moves multiple columns for larger drags', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 190,
            currentColumnIndex: 1,
            columnCount: 5,
        })).toBe(4);
        expect(resolveBoardDropColumnIndex({
            translationX: -190,
            currentColumnIndex: 3,
            columnCount: 5,
        })).toBe(0);
    });

    it('clamps output to valid column bounds', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: -100,
            currentColumnIndex: 0,
            columnCount: 5,
        })).toBe(0);
        expect(resolveBoardDropColumnIndex({
            translationX: 1000,
            currentColumnIndex: 4,
            columnCount: 5,
        })).toBe(4);
    });

    it('returns current index when column count is invalid', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 120,
            currentColumnIndex: 2,
            columnCount: 0,
        })).toBe(2);
    });
});

describe('resolveBoardDropColumnIndexFromY', () => {
    const bounds = [
        { index: 0, top: 0, bottom: 100 },
        { index: 1, top: 120, bottom: 220 },
        { index: 2, top: 240, bottom: 340 },
    ];

    it('matches the column containing drag center', () => {
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 150,
            currentColumnIndex: 0,
            columnBounds: bounds,
        })).toBe(1);
    });

    it('returns nearest column when drag center lands in a gap', () => {
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 111,
            currentColumnIndex: 2,
            columnBounds: bounds,
        })).toBe(1);
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 231,
            currentColumnIndex: 0,
            columnBounds: bounds,
        })).toBe(2);
    });

    it('returns current column when drag center or bounds are invalid', () => {
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: Number.NaN,
            currentColumnIndex: 2,
            columnBounds: bounds,
        })).toBe(2);
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 180,
            currentColumnIndex: 1,
            columnBounds: [],
        })).toBe(1);
    });
});

describe('resolveBoardColumnReorder', () => {
    const columnTasks = [
        { id: 'task-q', top: 0, height: 60 },
        { id: 'task-w', top: 68, height: 60 },
        { id: 'task-e', top: 136, height: 60 },
        { id: 'task-r', top: 204, height: 60 },
    ];

    it('moves a task to the top when its drag center lands above the first card', () => {
        expect(resolveBoardColumnReorder({
            taskId: 'task-e',
            dragCenterY: 10,
            columnTasks,
        })).toEqual(['task-e', 'task-q', 'task-w', 'task-r']);
    });

    it('moves a task downward past later cards', () => {
        expect(resolveBoardColumnReorder({
            taskId: 'task-q',
            dragCenterY: 240,
            columnTasks,
        })).toEqual(['task-w', 'task-e', 'task-r', 'task-q']);
    });

    it('moves a task into the middle of the column', () => {
        expect(resolveBoardColumnReorder({
            taskId: 'task-r',
            dragCenterY: 80,
            columnTasks,
        })).toEqual(['task-q', 'task-r', 'task-w', 'task-e']);
    });

    it('returns null when the position does not change', () => {
        expect(resolveBoardColumnReorder({
            taskId: 'task-w',
            dragCenterY: 98,
            columnTasks,
        })).toBeNull();
    });

    it('returns null for unknown tasks or invalid coordinates', () => {
        expect(resolveBoardColumnReorder({
            taskId: 'missing',
            dragCenterY: 100,
            columnTasks,
        })).toBeNull();
        expect(resolveBoardColumnReorder({
            taskId: 'task-q',
            dragCenterY: Number.NaN,
            columnTasks,
        })).toBeNull();
    });
});
