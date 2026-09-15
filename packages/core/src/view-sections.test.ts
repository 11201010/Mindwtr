import { describe, expect, it } from 'vitest';
import type { Task, ViewSectionDefinition } from './types';
import {
    buildTaskViewSectionUpdates,
    buildTaskViewSectionUndoUpdates,
    groupTasksByViewSection,
    resolveTaskViewSection,
    setTaskViewSectionId,
    sortViewSectionDefinitions,
} from './view-sections';

const task = (id: string, sectionId?: string): Task => ({
    id,
    title: id,
    status: 'someday',
    tags: [],
    contexts: [],
    viewSectionIds: sectionId ? { someday: sectionId } : undefined,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
});

describe('view sections', () => {
    it('moves a mixed selection without changing containers, status, dates, or other scopes', () => {
        const original = {
            ...task('one', 'books'),
            status: 'next' as const,
            projectId: 'someday-project',
            sectionId: 'project-section',
            dueDate: '2026-10-10',
            viewSectionIds: { someday: 'books', waiting: 'people', futureScope: 'retained' },
        };
        const unchanged = task('already-there', 'career');
        const deleted = { ...task('deleted'), deletedAt: '2026-09-15T10:00:00Z' };
        const before = structuredClone(original);
        const updates = buildTaskViewSectionUpdates([original, original, unchanged, deleted, task('two')], 'someday', 'career');
        expect(updates).toEqual([
            { id: 'one', updates: { viewSectionIds: { someday: 'career', waiting: 'people', futureScope: 'retained' } } },
            { id: 'two', updates: { viewSectionIds: { someday: 'career' } } },
        ]);
        expect({ ...original, ...updates[0].updates }).toEqual({
            ...before, viewSectionIds: { someday: 'career', waiting: 'people', futureScope: 'retained' },
        });
        expect(original).toEqual(before);
        expect(buildTaskViewSectionUpdates([unchanged], 'someday', 'career')).toEqual([]);
    });

    it('clears with an explicit empty map and preserves other view assignments', () => {
        expect(buildTaskViewSectionUpdates([task('one', 'books')], 'someday')).toEqual([
            { id: 'one', updates: { viewSectionIds: {} } },
        ]);
        expect(buildTaskViewSectionUpdates([
            { ...task('two', 'books'), viewSectionIds: { someday: 'books', waiting: 'people' } },
            task('unassigned'),
        ], 'someday')).toEqual([{ id: 'two', updates: { viewSectionIds: { waiting: 'people' } } }]);
    });

    it('undoes only its own remaining assignments using the latest maps', () => {
        const latest = [
            { ...task('one', 'career'), title: 'Edited later', viewSectionIds: { someday: 'career', waiting: 'new-people' } },
            task('moved-again', 'travel'),
            { ...task('deleted', 'career'), deletedAt: '2026-09-15T10:00:00Z' },
            task('not-in-action', 'career'),
            task('two', 'career'),
        ];
        const previous = [
            { id: 'one', sectionId: 'books' }, { id: 'moved-again' }, { id: 'deleted' },
            { id: 'missing', sectionId: 'books' }, { id: 'two' },
        ];
        const before = structuredClone(latest);
        expect(buildTaskViewSectionUndoUpdates(latest, 'someday', previous, 'career')).toEqual([
            { id: 'one', updates: { viewSectionIds: { someday: 'books', waiting: 'new-people' } } },
            { id: 'two', updates: { viewSectionIds: {} } },
        ]);
        expect(latest).toEqual(before);
    });

    it('undoes a clear without overwriting a subsequent reassignment', () => {
        expect(buildTaskViewSectionUndoUpdates(
            [task('one'), task('one'), task('two', 'travel')], 'someday',
            [{ id: 'one', sectionId: 'books' }, { id: 'two', sectionId: 'books' }],
        )).toEqual([{ id: 'one', updates: { viewSectionIds: { someday: 'books' } } }]);
    });

    it('sorts headings, resolves known ids, and renders orphan ids under No section without repairing them', () => {
        const definitions: ViewSectionDefinition[] = [
            { id: 'career', title: 'Career ideas', order: 2 },
            { id: 'books', title: 'Books to read', order: 1 },
        ];
        const known = task('known', 'books');
        const orphan = task('orphan', 'missing-heading');
        const before = JSON.stringify(orphan);

        expect(sortViewSectionDefinitions(definitions).map((definition) => definition.id)).toEqual(['books', 'career']);
        expect(resolveTaskViewSection(known, 'someday', definitions)?.id).toBe('books');
        expect(resolveTaskViewSection(orphan, 'someday', definitions)).toBeUndefined();
        expect(groupTasksByViewSection([known, orphan], 'someday', definitions, 'No section')).toEqual([
            expect.objectContaining({ id: 'view-section:someday:books', tasks: [known] }),
            expect.objectContaining({ id: 'view-section:someday:none', tasks: [orphan], muted: true }),
        ]);
        expect(JSON.stringify(orphan)).toBe(before);
        expect(setTaskViewSectionId({ waiting: 'future-value' }, 'someday', 'books')).toEqual({
            someday: 'books',
            waiting: 'future-value',
        });
        expect(setTaskViewSectionId({ someday: 'books' }, 'someday', undefined)).toEqual({});
    });
});
