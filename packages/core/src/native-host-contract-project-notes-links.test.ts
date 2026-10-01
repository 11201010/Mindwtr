import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { Project, Task } from './types';

const at = '2026-10-01T12:00:00.000Z';
const notes = '# [[task:live|Heading task]]\n\n'
    + 'See [[project:target|Project]], [Web](https://example.org/private), [[task:gone|Gone]], '
    + 'and [[project:deleted|Deleted project]].\n\n'
    + '- [[task:archived|Archived task]]\n- [[project:archived-project|Archived project]]\n\n'
    + '1. [[project:source|Self]]\n\n- [ ] [[task:live|Check]]';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: [], contexts: [], createdAt: at, updatedAt: at, ...extra,
});
const project = (id: string, extra: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#123456', order: 0, tagIds: [], createdAt: at, updatedAt: at, ...extra,
});
const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
};

describe('Project Notes reference target', () => {
    let host: ReturnType<typeof createNativeHostContract>;
    let writes: ReturnType<typeof vi.fn>;
    let revision: string;
    const input = (blockIndex: number, inlineIndex: number, itemIndex?: number) => ({
        projectId: 'source', revision, blockIndex, ...(itemIndex === undefined ? {} : { itemIndex }), inlineIndex,
    });
    const read = (request: ReturnType<typeof input>) => host.getProjectNotesReferenceTarget(request);

    beforeEach(async () => {
        resetForTests();
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 });
        const projects = [project('source', { supportNotes: notes }), project('target'),
            project('archived-project', { status: 'archived' }),
            project('archived-source', { status: 'archived', supportNotes: '[[project:target|Target]]' }),
            project('deleted', { deletedAt: at })];
        const tasks = [task('live'), task('archived', { status: 'archived' }), task('gone', { deletedAt: at })];
        writes = vi.fn().mockResolvedValue(undefined);
        setStorageAdapter({ getData: async () => ({ tasks, projects, sections: [], areas: [], people: [], settings: {} }),
            saveData: writes });
        host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        revision = value(host.getProjectNotes({ projectId: 'source', offset: 0, limit: 1 })).revision;
        writes.mockClear();
    });

    afterEach(async () => { await flushPendingSave(); resetForTests(); });

    it('resolves heading, paragraph and all list kinds by global block and inline indices across pages', () => {
        expect(value(host.getProjectNotes({ projectId: 'source', offset: 4, limit: 1, revision })).blocks[0].type)
            .toBe('bulletList');
        expect(read(input(0, 0))).toEqual({ ok: true, value: { kind: 'task', id: 'live' } });
        expect(read(input(2, 1))).toEqual({ ok: true, value: { kind: 'project', id: 'target' } });
        expect(read(input(4, 0, 0))).toEqual({ ok: true, value: { kind: 'task', id: 'archived' } });
        expect(read(input(4, 0, 1))).toEqual({ ok: true, value: { kind: 'project', id: 'archived-project' } });
        expect(read(input(6, 0, 0))).toEqual({ ok: true, value: { kind: 'project', id: 'source' } });
        expect(read(input(8, 0, 0))).toEqual({ ok: true, value: { kind: 'task', id: 'live' } });
        const archived = value(host.getProjectNotes({ projectId: 'archived-source', offset: 0, limit: 1 }));
        expect(host.getProjectNotesReferenceTarget({ projectId: 'archived-source', revision: archived.revision,
            blockIndex: 0, inlineIndex: 0 })).toEqual({ ok: true, value: { kind: 'project', id: 'target' } });
        expect(writes).not.toHaveBeenCalled();
    });

    it('rejects external, deleted, plain text, wrong shape and forged positions without leaking Notes', () => {
        const malformed: unknown[] = [null, {}, { ...input(0, 0), id: 'target' },
            { ...input(0, 0), target: { kind: 'task', id: 'live' } },
            { ...input(0, 0), projectId: '' }, { ...input(0, 0), projectId: 'x'.repeat(501) },
            { ...input(0, 0), revision: '' }, { ...input(0, 0), revision: 'x'.repeat(501) },
            { ...input(0, 0), blockIndex: -1 }, { ...input(0, 0), blockIndex: 0.1 },
            { ...input(0, 0), blockIndex: Number.MAX_SAFE_INTEGER + 1 },
            { ...input(0, 0), inlineIndex: -1 }, { ...input(0, 0), inlineIndex: 0.5 },
            { ...input(4, 0), itemIndex: -1 }, { ...input(4, 0), itemIndex: 0.5 },
            { ...input(4, 0), itemIndex: null },
        ];
        for (const candidate of malformed) {
            expect(host.getProjectNotesReferenceTarget(candidate as never))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        for (const request of [input(2, 3), input(2, 5), input(2, 7), input(2, 0), input(0, 0, 0),
            input(4, 0), input(4, 0, 3), input(4, 1, 0), input(99, 0), input(1, 0)]) {
            const result = read(request);
            expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(JSON.stringify(result)).not.toMatch(/Heading task|example\.org|Gone|Deleted project/);
        }
        expect(writes).not.toHaveBeenCalled();
    });

    it('renders purged-only targets as deleted and refuses navigation without writes', () => {
        useTaskStore.setState((state) => ({
            _allTasks: state._allTasks.map((row) => row.id === 'live' ? { ...row, purgedAt: at } : row),
            _allProjects: state._allProjects.map((row) => row.id === 'target' ? { ...row, purgedAt: at } : row),
        }));
        const page = value(host.getProjectNotes({ projectId: 'source', offset: 0, limit: 3 }));
        revision = page.revision;
        expect(page.blocks[0]).toMatchObject({ inline: [{ type: 'deletedReference', entityType: 'task' }] });
        expect(page.blocks[2]).toMatchObject({ inline: expect.arrayContaining([
            { type: 'deletedReference', text: 'Project', entityType: 'project' },
        ]) });
        for (const request of [input(0, 0), input(2, 1)]) {
            expect(read(request)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(writes).not.toHaveBeenCalled();
    });

    it('refuses stale task, project and source changes, deleted sources, and unsaved reads', () => {
        expect(createNativeHostContract().getProjectNotesReferenceTarget(input(0, 0)))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        const stale = () => expect(read(input(0, 0))).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'live'
            ? { ...row, title: 'Changed task' } : row) }));
        stale();
        revision = value(host.getProjectNotes({ projectId: 'source', offset: 0, limit: 1 })).revision;
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, title: 'Changed project' } : row) }));
        stale();
        revision = value(host.getProjectNotes({ projectId: 'source', offset: 0, limit: 1 })).revision;
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'source'
            ? { ...row, supportNotes: 'Changed [[task:live|reference]]' } : row) }));
        stale();
        revision = value(host.getProjectNotes({ projectId: 'source', offset: 0, limit: 1 })).revision;
        expect(host.getProjectNotesReferenceTarget({ ...input(0, 0), projectId: 'missing' }))
            .toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'source'
            ? { ...row, deletedAt: at } : row) }));
        expect(read(input(0, 0))).toMatchObject({ ok: false });
        useTaskStore.setState({ persistenceFailure: { message: 'private disk failure', failedAt: at, retrying: false } });
        expect(read(input(0, 0))).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(writes).not.toHaveBeenCalled();
    });
});
