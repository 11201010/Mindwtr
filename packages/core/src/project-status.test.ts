import { describe, expect, it } from 'vitest';

import {
    isProjectCancelled,
    normalizeProjectLifecycleFields,
    normalizeProjectUpdate,
} from './project-status';
import type { Project } from './types';

const project = (overrides: Partial<Project> = {}): Project => ({
    id: 'project-1',
    title: 'Project',
    status: 'active',
    color: '#123456',
    order: 0,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
});

describe('project cancellation normalization', () => {
    it('archives on a timestamp-only patch and clears cancellation on reactivation', () => {
        const cancelledAt = '2026-09-07T14:00:00.000Z';
        expect(normalizeProjectUpdate(project(), { cancelledAt })).toEqual({
            status: 'archived',
            cancelledAt,
            isFocused: false,
        });
        expect(normalizeProjectUpdate(project({ status: 'archived', cancelledAt }), { status: 'active' }))
            .toEqual({ status: 'active', cancelledAt: undefined });
    });

    it('normalizes load shape idempotently and preserves ordinary archives', () => {
        const cancelled = project({ status: 'archived', cancelledAt: '2026-09-07T14:00:00.000Z' });
        const once = normalizeProjectLifecycleFields(cancelled);
        expect(isProjectCancelled(once)).toBe(true);
        expect(normalizeProjectLifecycleFields(once)).toBe(once);

        const ordinaryArchive = normalizeProjectLifecycleFields(project({ status: 'archived' }));
        expect(isProjectCancelled(ordinaryArchive)).toBe(false);
        expect(ordinaryArchive.status).toBe('archived');
    });

    it('clears focus for ordinary archives and cancellations without restoring it on activation', () => {
        const cancelledAt = '2026-09-07T14:00:00.000Z';
        expect(normalizeProjectUpdate(project({ isFocused: true }), { status: 'archived' })).toEqual({
            status: 'archived',
            isFocused: false,
        });
        expect(normalizeProjectLifecycleFields(project({
            status: 'archived',
            cancelledAt,
            isFocused: true,
        }))).toMatchObject({ status: 'archived', cancelledAt, isFocused: false });
        expect(normalizeProjectUpdate(
            project({ status: 'archived', cancelledAt, isFocused: false }),
            { status: 'active' },
        )).toEqual({ status: 'active', cancelledAt: undefined });
    });

    it('preserves focused waiting and someday projects on load and unrelated patches', () => {
        for (const status of ['waiting', 'someday'] as const) {
            const focused = project({ status, isFocused: true });
            expect(normalizeProjectLifecycleFields(focused)).toBe(focused);
            expect(normalizeProjectUpdate(focused, { title: 'Renamed' })).toEqual({
                title: 'Renamed',
                cancelledAt: undefined,
            });
        }
    });

    it('clears focus when a project explicitly enters an archived, waiting, or someday status', () => {
        for (const status of ['archived', 'waiting', 'someday'] as const) {
            expect(normalizeProjectUpdate(project({ isFocused: true }), { status })).toMatchObject({
                status,
                isFocused: false,
            });
        }
    });
});
