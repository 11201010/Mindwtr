import { describe, expect, it } from 'vitest';
import type { AppData } from './types';
import { isEntityTombstoneExpired, purgeExpiredTombstones } from './sync-tombstones';

const nowIso = '2026-04-08T00:00:00.000Z';

describe('isEntityTombstoneExpired', () => {
    const cutoffMs = Date.parse('2026-01-01T00:00:00.000Z');

    it('matches cleanup cutoff and malformed timestamp semantics for every entity kind', () => {
        expect(isEntityTombstoneExpired('task', { deletedAt: '2026-01-01T00:00:00.000Z' }, cutoffMs)).toBe(true);
        expect(isEntityTombstoneExpired('project', { deletedAt: '2025-01-01T00:00:00.000Z' }, cutoffMs)).toBe(true);
        expect(isEntityTombstoneExpired('section', { deletedAt: '2026-01-01T00:00:00.000Z' }, cutoffMs)).toBe(true);
        expect(isEntityTombstoneExpired('area', { deletedAt: '2026-01-01T00:00:00.000Z' }, cutoffMs)).toBe(true);
        expect(isEntityTombstoneExpired('person', { deletedAt: '2026-01-01T00:00:00.000Z' }, cutoffMs)).toBe(true);
        expect(isEntityTombstoneExpired('task', { purgedAt: '2025-01-01T00:00:00.000Z' }, cutoffMs)).toBe(false);
        expect(isEntityTombstoneExpired('task', { deletedAt: 'not-a-date' }, cutoffMs)).toBe(false);
    });

    it('prefers valid task and project purgedAt but falls back to deletedAt when it is invalid', () => {
        const oldDeleted = '2025-01-01T00:00:00.000Z';
        const recentPurge = '2026-02-01T00:00:00.000Z';
        expect(isEntityTombstoneExpired('task', { deletedAt: oldDeleted, purgedAt: recentPurge }, cutoffMs)).toBe(false);
        expect(isEntityTombstoneExpired('project', { deletedAt: oldDeleted, purgedAt: recentPurge }, cutoffMs)).toBe(false);
        expect(isEntityTombstoneExpired('task', { deletedAt: oldDeleted, purgedAt: 'not-a-date' }, cutoffMs)).toBe(true);
        expect(isEntityTombstoneExpired('project', { deletedAt: oldDeleted, purgedAt: '' }, cutoffMs)).toBe(true);
    });
});

describe('purgeExpiredTombstones', () => {
    it('purges expired task tombstones even when purgedAt is missing', () => {
        const data: AppData = {
            tasks: [
                {
                    id: 'task-old',
                    title: 'Old task tombstone',
                    status: 'inbox',
                    tags: [],
                    contexts: [],
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2025-01-01T00:00:00.000Z',
                    deletedAt: '2025-01-01T00:00:00.000Z',
                },
                {
                    id: 'task-recent',
                    title: 'Recent task tombstone',
                    status: 'inbox',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-03-20T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                    deletedAt: '2026-03-20T00:00:00.000Z',
                },
            ],
            projects: [],
            sections: [],
            areas: [],
            settings: {},
        };

        const result = purgeExpiredTombstones(data, nowIso);

        expect(result.removedTaskTombstones).toBe(1);
        expect(result.data.tasks.map((task) => task.id)).toEqual(['task-recent']);
    });

    it('purges expired project, section, and area tombstones', () => {
        const data: AppData = {
            tasks: [],
            projects: [
                {
                    id: 'project-old',
                    title: 'Old project tombstone',
                    status: 'active',
                    color: '#94a3b8',
                    order: 0,
                    tagIds: [],
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2025-01-01T00:00:00.000Z',
                    deletedAt: '2025-01-01T00:00:00.000Z',
                },
                {
                    id: 'project-recent',
                    title: 'Recent project tombstone',
                    status: 'active',
                    color: '#94a3b8',
                    order: 1,
                    tagIds: [],
                    createdAt: '2026-03-20T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                    deletedAt: '2026-03-20T00:00:00.000Z',
                },
            ],
            sections: [
                {
                    id: 'section-old',
                    projectId: 'project-old',
                    title: 'Old section tombstone',
                    order: 0,
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2025-01-01T00:00:00.000Z',
                    deletedAt: '2025-01-01T00:00:00.000Z',
                },
                {
                    id: 'section-recent',
                    projectId: 'project-recent',
                    title: 'Recent section tombstone',
                    order: 1,
                    createdAt: '2026-03-20T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                    deletedAt: '2026-03-20T00:00:00.000Z',
                },
            ],
            areas: [
                {
                    id: 'area-old',
                    name: 'Old area tombstone',
                    order: 0,
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2025-01-01T00:00:00.000Z',
                    deletedAt: '2025-01-01T00:00:00.000Z',
                },
                {
                    id: 'area-recent',
                    name: 'Recent area tombstone',
                    order: 1,
                    createdAt: '2026-03-20T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                    deletedAt: '2026-03-20T00:00:00.000Z',
                },
            ],
            settings: {},
        };

        const result = purgeExpiredTombstones(data, nowIso);

        expect(result.removedProjectTombstones).toBe(1);
        expect(result.removedSectionTombstones).toBe(1);
        expect(result.removedAreaTombstones).toBe(1);
        expect(result.data.projects.map((project) => project.id)).toEqual(['project-recent']);
        expect(result.data.sections.map((section) => section.id)).toEqual(['section-recent']);
        expect(result.data.areas.map((area) => area.id)).toEqual(['area-recent']);
    });

    it('uses project purgedAt as the project tombstone retention timestamp', () => {
        const data: AppData = {
            tasks: [],
            projects: [
                {
                    id: 'project-purged-old',
                    title: 'Old purged project tombstone',
                    status: 'active',
                    color: '#6B7280',
                    order: 0,
                    tagIds: [],
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                    deletedAt: '2026-03-20T00:00:00.000Z',
                    purgedAt: '2025-01-01T00:00:00.000Z',
                },
                {
                    id: 'project-purged-recent',
                    title: 'Recent purged project tombstone',
                    status: 'active',
                    color: '#6B7280',
                    order: 1,
                    tagIds: [],
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                    deletedAt: '2025-01-01T00:00:00.000Z',
                    purgedAt: '2026-06-20T00:00:00.000Z',
                },
            ],
            sections: [],
            areas: [],
            settings: {},
        };

        const result = purgeExpiredTombstones(data, '2026-06-29T00:00:00.000Z');

        expect(result.removedProjectTombstones).toBe(1);
        expect(result.data.projects.map((project) => project.id)).toEqual(['project-purged-recent']);
    });

    it('purges expired person tombstones while keeping recent and active people', () => {
        const data: AppData = {
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            people: [
                {
                    id: 'person-old',
                    name: 'Old person tombstone',
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2025-01-01T00:00:00.000Z',
                    deletedAt: '2025-01-01T00:00:00.000Z',
                },
                {
                    id: 'person-recent',
                    name: 'Recent person tombstone',
                    createdAt: '2026-03-20T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                    deletedAt: '2026-03-20T00:00:00.000Z',
                },
                {
                    id: 'person-active',
                    name: 'Active person',
                    createdAt: '2026-03-20T00:00:00.000Z',
                    updatedAt: '2026-03-20T00:00:00.000Z',
                },
            ],
            settings: {},
        };

        const result = purgeExpiredTombstones(data, nowIso);

        expect(result.removedPersonTombstones).toBe(1);
        expect(result.data.people?.map((person) => person.id)).toEqual(['person-recent', 'person-active']);
    });

    it('prunes expired pending remote attachment deletes while keeping recent failures', () => {
        const data: AppData = {
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            settings: {
                attachments: {
                    pendingRemoteDeletes: [
                        {
                            cloudKey: 'attachments/private/expired.jpg',
                            lastErrorAt: '2025-01-01T00:00:00.000Z',
                        },
                        {
                            cloudKey: 'attachments/private/recent.jpg',
                            lastErrorAt: '2026-04-01T00:00:00.000Z',
                        },
                    ],
                },
            },
        };

        const result = purgeExpiredTombstones(data, nowIso);

        expect(result.removedPendingRemoteDeletes).toBe(1);
        expect(result.data.settings.attachments?.pendingRemoteDeletes).toEqual([
            {
                cloudKey: 'attachments/private/recent.jpg',
                lastErrorAt: '2026-04-01T00:00:00.000Z',
            },
        ]);
    });

    it('purges expired saved filter tombstones from settings', () => {
        const data: AppData = {
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            settings: {
                savedFilters: [
                    {
                        id: 'filter-old',
                        name: 'Old filter tombstone',
                        view: 'focus',
                        criteria: { tags: ['#old'] },
                        createdAt: '2025-01-01T00:00:00.000Z',
                        updatedAt: '2025-01-01T00:00:00.000Z',
                        deletedAt: '2025-01-01T00:00:00.000Z',
                    },
                    {
                        id: 'filter-recent',
                        name: 'Recent filter tombstone',
                        view: 'focus',
                        criteria: { tags: ['#recent'] },
                        createdAt: '2026-03-20T00:00:00.000Z',
                        updatedAt: '2026-03-20T00:00:00.000Z',
                        deletedAt: '2026-03-20T00:00:00.000Z',
                    },
                    {
                        id: 'filter-active',
                        name: 'Active filter',
                        view: 'focus',
                        criteria: { tags: ['#active'] },
                        createdAt: '2026-03-20T00:00:00.000Z',
                        updatedAt: '2026-03-20T00:00:00.000Z',
                    },
                ],
            },
        };

        const result = purgeExpiredTombstones(data, nowIso);

        expect(result.removedSavedFilterTombstones).toBe(1);
        expect(result.data.settings.savedFilters?.map((filter) => filter.id)).toEqual(['filter-recent', 'filter-active']);
    });
});
