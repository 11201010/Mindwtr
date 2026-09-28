import { describe, expect, it } from 'vitest';
import { countLiveProjectsByArea } from './area-project-usage';
import type { Project } from './types';

const project = (id: string, areaId: string | undefined, status: Project['status'], deletedAt?: string): Project => ({
    id, areaId, title: id, status, color: '#3b82f6', order: 0, tagIds: [],
    createdAt: '2026-09-28T15:00:00.000Z', updatedAt: '2026-09-28T15:00:00.000Z', deletedAt,
});

describe('Area Project usage', () => {
    it('counts live archived and deferred Projects, ignoring tombstones and unassigned rows', () => {
        expect([...countLiveProjectsByArea([
            project('active', 'work', 'active'), project('archived', 'work', 'archived'),
            project('deferred', 'home', 'someday'), project('waiting', 'home', 'waiting'),
            project('deleted', 'work', 'active', '2026-09-28T15:00:00.000Z'),
            project('unassigned', undefined, 'active'),
        ])]).toEqual([['work', 2], ['home', 2]]);
    });
});
