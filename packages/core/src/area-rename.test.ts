import { describe, expect, it } from 'vitest';
import { planAreaRename } from './area-rename';
import type { Area, Project, Task } from './types';

const CREATED = '2026-09-28T12:00:00.000Z';
const UPDATED = '2026-09-28T13:00:00.000Z';
const area = (id: string, name: string, order: number, extra: Partial<Area> = {}): Area => ({
    id, name, order, createdAt: CREATED, updatedAt: CREATED, rev: 1, revBy: 'old-device', ...extra,
});
const project = (id: string, areaId: string, areaTitle: string, extra: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#111111', order: 0, tagIds: [], areaId, areaTitle,
    createdAt: CREATED, updatedAt: CREATED, rev: 1, revBy: 'old-device', ...extra,
});
const task = (id: string, areaId: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: [], contexts: [], areaId,
    createdAt: CREATED, updatedAt: CREATED, rev: 1, revBy: 'old-device', ...extra,
});

describe('Area rename planner', () => {
    it('matches the first live destination and preserves rich linked rows while applying RN merge rules', () => {
        const source = area('source', 'Work', 3, { color: '#336699', icon: 'briefcase' });
        const destination = area('destination', 'Home', 1, { color: '#22c55e', icon: 'house' });
        const duplicate = area('duplicate', ' home ', 2, { color: '#ef4444' });
        const tombstone = area('deleted-match', 'HOME', 0, { deletedAt: CREATED });
        const sourceLive = project('source-live', source.id, source.name, { supportNotes: 'keep', tagIds: ['#x'] });
        const sourceDeleted = project('source-deleted', source.id, source.name, { deletedAt: CREATED });
        const destinationMismatch = project('destination-mismatch', destination.id, 'old', { attachments: [] });
        const destinationMatch = project('destination-match', destination.id, 'HOME');
        const unrelated = project('unrelated', duplicate.id, duplicate.name);
        const direct = task('direct', source.id, { description: 'keep' });
        const deleted = task('deleted', source.id, { deletedAt: CREATED });
        const dual = task('dual', source.id, { projectId: sourceLive.id });
        const unrelatedTask = task('unrelated-task', duplicate.id);

        const planned = planAreaRename({
            areas: [source, tombstone, destination, duplicate],
            projects: [sourceLive, sourceDeleted, destinationMismatch, destinationMatch, unrelated],
            tasks: [direct, deleted, dual, unrelatedTask],
        }, source.id, { name: ' HOME ' }, 'new-device', UPDATED);

        expect(planned?.result).toEqual({ id: source.id, areaId: destination.id, name: 'HOME' });
        expect(planned?.areas.find((row) => row.id === source.id)).toEqual({
            ...source, deletedAt: UPDATED, updatedAt: UPDATED, rev: 2, revBy: 'new-device',
        });
        expect(planned?.areas.find((row) => row.id === destination.id)).toEqual({
            ...destination, name: 'HOME', updatedAt: UPDATED, rev: 2, revBy: 'new-device',
        });
        expect(planned?.areas.find((row) => row.id === duplicate.id)).toEqual(duplicate);
        expect(planned?.projects.find((row) => row.id === sourceLive.id)).toEqual({
            ...sourceLive, areaId: destination.id, areaTitle: 'HOME', color: destination.color,
            updatedAt: UPDATED, rev: 2, revBy: 'new-device',
        });
        expect(planned?.projects.find((row) => row.id === sourceDeleted.id)?.deletedAt).toBe(CREATED);
        expect(planned?.projects.find((row) => row.id === destinationMismatch.id)).toEqual({
            ...destinationMismatch, areaTitle: 'HOME', updatedAt: UPDATED, rev: 2, revBy: 'new-device',
        });
        expect(planned?.projects.find((row) => row.id === destinationMatch.id)).toBe(destinationMatch);
        expect(planned?.projects.find((row) => row.id === unrelated.id)).toBe(unrelated);
        expect(planned?.tasks.find((row) => row.id === direct.id)).toEqual({
            ...direct, areaId: destination.id, updatedAt: UPDATED, rev: 2, revBy: 'new-device',
        });
        expect(planned?.tasks.find((row) => row.id === deleted.id)?.deletedAt).toBe(CREATED);
        expect(planned?.tasks.find((row) => row.id === dual.id)).toEqual({
            ...dual, areaId: undefined, updatedAt: UPDATED, rev: 2, revBy: 'new-device',
        });
        expect(planned?.tasks.find((row) => row.id === unrelatedTask.id)).toBe(unrelatedTask);
    });

    it('keeps composed and decomposed Unicode distinct and preserves mixed name plus color behavior', () => {
        const source = area('source', 'Cafe', 0, { color: '#111111' });
        const decomposed = area('decomposed', 'Cafe\u0301', 1, { color: '#222222' });
        const linked = project('linked', source.id, source.name, { color: '#111111' });
        const planned = planAreaRename({ areas: [source, decomposed], projects: [linked], tasks: [] }, source.id,
            { name: 'Caf\u00e9', color: '#abcdef' }, 'new-device', UPDATED);

        expect(planned?.result).toEqual({ id: source.id, areaId: source.id, name: 'Caf\u00e9' });
        expect(planned?.areas.find((row) => row.id === source.id)).toMatchObject({
            name: 'Caf\u00e9', color: '#abcdef', rev: 2,
        });
        expect(planned?.projects[0]).toMatchObject({ areaTitle: 'Caf\u00e9', color: '#abcdef', rev: 2 });
        expect(planAreaRename({ areas: [source], projects: [], tasks: [] }, source.id,
            { name: '   ' }, 'new-device', UPDATED)).toBeNull();
    });
});
