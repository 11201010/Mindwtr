import { afterEach, describe, expect, it } from 'vitest';
import { createSomedaySectionMoveMethods, type NativeSomedaySectionMoveEnvelope,
    type NativeSomedaySectionMoveUndoEnvelope } from './native-host-contract-someday-section-move';
import { revisionOf } from './native-request-receipts';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Project, Task } from './types';

const stamp = '2026-09-01T12:00:00.000Z';
const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const task = (extra: Partial<Task> = {}): Task => ({ id: 'task', title: 'Idea', status: 'someday',
    tags: [], contexts: [], rev: 3, revBy: 'prior', createdAt: stamp, updatedAt: stamp,
    viewSectionIds: { someday: 'ideas', future: 'retain' }, description: 'unchanged', ...extra });
const section = (id: string, title: string, order: number) => ({ id, title, order });
const raw = [section('ideas', 'Ideas', 0), { future: { empty: '' } },
    section('none', 'Imported None', 1), section('no-section', 'Imported No section', 2)];
const initial = (tasks: Task[] = [task()]): AppData => ({ tasks, projects: [], sections: [], areas: [], people: [],
    settings: { deviceId: 'device', gtd: { viewSections: { someday: raw } } } });
type Methods = ReturnType<typeof createSomedaySectionMoveMethods>;
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

async function open(data: AppData = initial(), fails?: () => boolean, losesAck?: () => boolean) {
    resetForTests();
    let stored = structuredClone(data);
    let saves = 0;
    const adapter = { getData: async () => stored, saveData: async (next: AppData) => {
        if (fails?.()) throw new Error('disk unavailable');
        stored = structuredClone(next); saves++;
    } };
    setStorageAdapter(adapter);
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0,
        lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = (): Methods => createSomedaySectionMoveMethods({ readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); if (losesAck?.()) throw new Error('ack lost');
                return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        }, revision: () => 'revision', t: () => (key) => key });
    const reopen = async () => {
        resetForTests(); setStorageAdapter(adapter);
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0,
            lastDataChangeAt: 0 } as never);
        await useTaskStore.getState().fetchData({ throwOnError: true });
        return methods();
    };
    return { methods: methods(), reopen, stored: () => stored, saves: () => saves };
}
const moveRequest = (sectionId: string | null, requestId = crypto.randomUUID()) => ({ requestId, taskId: 'task',
    taskRevision: revisionOf(useTaskStore.getState()._allTasks.find((row) => row.id === 'task')!), sectionId });
const preparedMove = (methods: Methods, sectionId: string | null, requestId = crypto.randomUUID()): NativeSomedaySectionMoveEnvelope => {
    const request = moveRequest(sectionId, requestId);
    const prepared = value(methods.prepareSomedaySectionMove(request));
    if (prepared.kind !== 'prepared') throw new Error('Expected prepared move');
    return { request, prepared: prepared.prepared };
};
const preparedUndo = (methods: Methods, move: NativeSomedaySectionMoveEnvelope,
    requestId = crypto.randomUUID()): NativeSomedaySectionMoveUndoEnvelope => {
    const request = { requestId, moveRequestId: move.request.requestId };
    const prepared = value(methods.prepareSomedaySectionMoveUndo({ request, move }));
    if (prepared.kind !== 'prepared') throw new Error('Expected prepared Undo');
    return { request, prepared: prepared.prepared };
};
afterEach(async () => { await flushPendingSave().catch(() => undefined); resetForTests(); });

describe('prepared native Someday section move and Undo', () => {
    it('pages shared choices and treats imported none/no-section as named IDs distinct from null', async () => {
        const { methods } = await open();
        const first = value(methods.getSomedaySectionMoveOptions({ taskId: 'task', limit: 2 }));
        expect(first).toMatchObject({ revision: 'revision', taskId: 'task',
            taskRevision: revisionOf(task()), choices: { total: 4, items: [
                { sectionId: null, selected: false }, { sectionId: 'ideas', selected: true },
            ] } });
        expect(first.choices.items[0].toast).toContain('No section');
        const second = value(methods.getSomedaySectionMoveOptions({ taskId: 'task', offset: 2, limit: 2, revision: first.revision }));
        expect(second.choices.items.map((row) => row.sectionId)).toEqual(['none', 'no-section']);
        expect(methods.getSomedaySectionMoveOptions({ taskId: 'task', offset: 2 })).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(methods.getSomedaySectionMoveOptions({ taskId: 'task', revision: 'old' })).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });

    it('moves only the section map, retaining future scopes and all other stored rows', async () => {
        const host = await open();
        const before = structuredClone(useTaskStore.getState()._allTasks[0]);
        const others = structuredClone(host.stored());
        const beforeSettings = structuredClone(useTaskStore.getState().settings);
        const envelope = preparedMove(host.methods, 'none');
        expect(envelope.prepared.changes).toEqual({ viewSectionIds: { future: 'retain', someday: 'none' } });
        expect(value(host.methods.validatePreparedSomedaySectionMove(envelope))).toEqual({ id: 'task', changed: true, sectionId: 'none' });
        expect(value(await host.methods.commitPreparedSomedaySectionMove(envelope))).toEqual({ id: 'task', changed: true, sectionId: 'none' });
        const after = useTaskStore.getState()._allTasks[0];
        expect(after.viewSectionIds).toEqual({ future: 'retain', someday: 'none' });
        expect(after.rev).toBe(4);
        for (const field of Object.keys(before).filter((key) => !['viewSectionIds', 'rev', 'revBy', 'updatedAt'].includes(key)))
            expect(after[field as keyof Task]).toEqual(before[field as keyof Task]);
        expect(host.stored().settings).toEqual(beforeSettings);
        expect(host.stored().projects).toEqual(others.projects);
        expect(host.stored().areas).toEqual(others.areas);
        expect(host.stored().tasks.filter((row) => row.id !== 'task')).toEqual(others.tasks.filter((row) => row.id !== 'task'));
        expect(value(host.methods.probeSomedaySectionMoveOutcome(envelope))).toEqual(envelope.prepared.result);
    });

    it('clears to explicit empty map, returns noop for same assignment, and refuses malformed input', async () => {
        const host = await open(initial([task({ viewSectionIds: { someday: 'ideas' } })]));
        const request = moveRequest('ideas');
        expect(value(host.methods.prepareSomedaySectionMove(request))).toEqual({ kind: 'noop',
            result: { id: 'task', changed: false, sectionId: 'ideas' } });
        const envelope = preparedMove(host.methods, null);
        expect(envelope.prepared.changes).toEqual({ viewSectionIds: {} });
        expect(value(await host.methods.commitPreparedSomedaySectionMove(envelope))).toMatchObject({ changed: true, sectionId: null });
        expect(useTaskStore.getState()._allTasks[0].viewSectionIds).toEqual({});
        for (const invalid of [
            { ...request, requestId: id('A') }, { ...request, taskId: 'bad\0id' },
            { ...request, sectionId: 'bad\ud800id' }, { ...request, taskRevision: 'x'.repeat(201) },
            { ...request, extra: true },
        ]) expect(host.methods.prepareSomedaySectionMove(invalid)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('retries SAVE_FAILED exactly and recognizes an applied move after host recreation', async () => {
        let failing = false;
        const host = await open(initial(), () => failing);
        const envelope = preparedMove(host.methods, 'no-section');
        failing = true;
        expect(await host.methods.commitPreparedSomedaySectionMove(envelope)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(useTaskStore.getState()._allTasks[0].viewSectionIds?.someday).toBe('no-section');
        failing = false;
        expect(value(await host.methods.commitPreparedSomedaySectionMove(envelope))).toEqual(envelope.prepared.result);
        const saves = host.saves();
        const cold = await host.reopen();
        expect(value(cold.probeSomedaySectionMoveOutcome(envelope))).toEqual(envelope.prepared.result);
        expect(value(await cold.commitPreparedSomedaySectionMove(envelope))).toEqual(envelope.prepared.result);
        expect(host.saves()).toBe(saves);
    });

    it('refuses first apply after task revision, destination witness, or area scope changes', async () => {
        const host = await open();
        const envelope = preparedMove(host.methods, 'none');
        useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'task'
            ? { ...row, title: 'newer', rev: 4 } : row) }));
        expect(await host.methods.commitPreparedSomedaySectionMove(envelope)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'task' ? task() : row) }));
        useTaskStore.setState((state) => ({ settings: { ...state.settings, gtd: { ...state.settings.gtd,
            viewSections: { someday: [section('ideas', 'Ideas', 0), section('none', 'Renamed', 1)] } } } }));
        expect(await host.methods.commitPreparedSomedaySectionMove(envelope)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            filters: { areaFilter: '__none__' } as typeof state.settings.filters } }));
        expect(await host.methods.commitPreparedSomedaySectionMove(envelope)).toMatchObject({ ok: false });
        expect(useTaskStore.getState()._allTasks[0].viewSectionIds?.someday).toBe('ideas');
    });

    it('prepares Undo from fresh independent edits and restores a deleted original section assignment', async () => {
        const host = await open();
        const move = preparedMove(host.methods, 'none');
        expect(value(await host.methods.commitPreparedSomedaySectionMove(move))).toMatchObject({ changed: true });
        const changed = useTaskStore.getState()._allTasks[0];
        useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'task'
            ? { ...row, title: 'independent', rev: (row.rev ?? 0) + 1,
                viewSectionIds: { ...row.viewSectionIds, future: 'new' } } : row),
            settings: { ...state.settings, gtd: { ...state.settings.gtd, viewSections: { someday: [section('none', 'Imported None', 1)] } } } }));
        const undo = preparedUndo(host.methods, move);
        expect(undo.prepared.before.title).toBe('independent');
        expect(undo.prepared.changes.viewSectionIds).toEqual({ future: 'new', someday: 'ideas' });
        expect(value(await host.methods.commitPreparedSomedaySectionMoveUndo(undo))).toEqual({ id: 'task', changed: true, sectionId: 'ideas' });
        const after = useTaskStore.getState()._allTasks[0];
        expect(after.title).toBe('independent');
        expect(after.viewSectionIds).toEqual({ future: 'new', someday: 'ideas' });
        expect(after.rev).toBe((changed.rev ?? 0) + 2);
    });

    it('skips Undo when moved again, filed away, deleted, or read-only archived project', async () => {
        const host = await open();
        const move = preparedMove(host.methods, 'none');
        value(await host.methods.commitPreparedSomedaySectionMove(move));
        const undoRequest = { requestId: crypto.randomUUID(), moveRequestId: move.request.requestId };
        for (const patch of [{ viewSectionIds: { someday: 'no-section' } }, { status: 'next' as const },
            { deletedAt: stamp }]) {
            const original = useTaskStore.getState()._allTasks[0];
            useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'task' ? { ...row, ...patch } : row) }));
            expect(value(host.methods.prepareSomedaySectionMoveUndo({ request: undoRequest, move }))).toMatchObject({ kind: 'noop', result: { changed: false } });
            useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'task' ? original : row) }));
        }
        const archived: Project = { id: 'project', title: 'Archived', status: 'archived', order: 0,
            color: '#123456', tagIds: [], createdAt: stamp, updatedAt: stamp };
        useTaskStore.setState((state) => ({ _allProjects: [...state._allProjects, archived],
            _allTasks: state._allTasks.map((row) => row.id === 'task' ? { ...row, projectId: 'project' } : row) }));
        const saves = host.saves();
        expect(host.methods.prepareSomedaySectionMoveUndo({ request: undoRequest, move }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.saves()).toBe(saves);
    });

    it('rejects malformed cold move and Undo envelopes before writes', async () => {
        const host = await open();
        const move = preparedMove(host.methods, 'none');
        for (const forged of [
            { ...move, extra: true },
            { ...move, prepared: { ...move.prepared, changes: { title: 'forged' } } },
            { ...move, prepared: { ...move.prepared, changes: { viewSectionIds: { someday: 'no-section' } } } },
            { ...move, prepared: { ...move.prepared, before: { ...move.prepared.before, rev: 99 } } },
            { ...move, prepared: { ...move.prepared, result: { ...move.prepared.result, sectionId: 'no-section' } } },
            { ...move, prepared: { ...move.prepared, before: { ...move.prepared.before, isFocusedToday: 'false' } } },
            { ...move, prepared: { ...move.prepared, before: { ...move.prepared.before, tags: {} } } },
            { ...move, prepared: { ...move.prepared, before: { ...move.prepared.before, checklist: [{ id: 'c', title: 'c', isCompleted: 1 }] } } },
        ]) {
            expect(host.methods.validatePreparedSomedaySectionMove(forged)).toMatchObject({ ok: false });
            expect(await host.methods.commitPreparedSomedaySectionMove(forged as NativeSomedaySectionMoveEnvelope)).toMatchObject({ ok: false });
        }
        expect(useTaskStore.getState()._allTasks[0].viewSectionIds?.someday).toBe('ideas');
        value(await host.methods.commitPreparedSomedaySectionMove(move));
        const undo = preparedUndo(host.methods, move);
        for (const forged of [
            { ...undo, extra: true },
            { ...undo, prepared: { ...undo.prepared, changes: { title: 'forged' } } },
            { ...undo, prepared: { ...undo.prepared, move: { ...move, request: { ...move.request, taskId: 'other' } } } },
        ]) expect(host.methods.validatePreparedSomedaySectionMoveUndo(forged)).toMatchObject({ ok: false });
        expect(host.methods.prepareSomedaySectionMoveUndo({ request: { requestId: crypto.randomUUID(),
            moveRequestId: move.request.requestId }, move, extra: true } as never)).toMatchObject({ ok: false });
    });

    it('cold first-applies a move and refuses replay after a same-revision independent edit', async () => {
        const host = await open();
        const move = preparedMove(host.methods, 'none');
        const cold = await host.reopen();
        expect(value(await cold.commitPreparedSomedaySectionMove(move))).toEqual(move.prepared.result);
        const saves = host.saves();
        useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'task'
            ? { ...row, title: 'Changed without stamp' } : row) }));
        expect(cold.probeSomedaySectionMoveOutcome(move)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await cold.commitPreparedSomedaySectionMove(move)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.saves()).toBe(saves);
    });

    it('cold first-applies Undo after moving to No section, preserving other scope keys', async () => {
        const host = await open();
        const move = preparedMove(host.methods, null);
        expect(value(await host.methods.commitPreparedSomedaySectionMove(move))).toEqual(move.prepared.result);
        const undo = preparedUndo(host.methods, move);
        const cold = await host.reopen();
        expect(value(await cold.commitPreparedSomedaySectionMoveUndo(undo))).toEqual(undo.prepared.result);
        expect(useTaskStore.getState()._allTasks[0].viewSectionIds)
            .toEqual({ someday: 'ideas', future: 'retain' });
        const saves = host.saves();
        expect(value(await cold.commitPreparedSomedaySectionMoveUndo(undo))).toEqual(undo.prepared.result);
        expect(host.saves()).toBe(saves);
    });

    it('recovers an Undo whose save failed, then refuses a stale terminal target', async () => {
        let failing = false;
        const host = await open(initial(), () => failing);
        const move = preparedMove(host.methods, 'none');
        value(await host.methods.commitPreparedSomedaySectionMove(move));
        const undo = preparedUndo(host.methods, move);
        failing = true;
        expect(await host.methods.commitPreparedSomedaySectionMoveUndo(undo))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        failing = false;
        expect(value(await host.methods.commitPreparedSomedaySectionMoveUndo(undo))).toEqual(undo.prepared.result);
        const cold = await host.reopen();
        useTaskStore.setState((state) => ({ _allTasks: state._allTasks.map((row) => row.id === 'task'
            ? { ...row, title: 'Later', rev: (row.rev ?? 0) + 1 } : row) }));
        expect(await cold.commitPreparedSomedaySectionMoveUndo(undo))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('recognizes a saved move after lost acknowledgement and destination rename', async () => {
        let lose = false;
        const host = await open(initial(), undefined, () => lose);
        const move = preparedMove(host.methods, 'none');
        lose = true;
        expect(await host.methods.commitPreparedSomedaySectionMove(move))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        lose = false;
        const cold = await host.reopen();
        useTaskStore.setState((state) => ({ settings: { ...state.settings, gtd: { ...state.settings.gtd,
            viewSections: { someday: [section('ideas', 'Ideas', 0), section('none', 'Renamed', 1)] } } } }));
        const saves = host.saves();
        expect(value(await cold.commitPreparedSomedaySectionMove(move))).toEqual(move.prepared.result);
        expect(host.saves()).toBe(saves);
    });

    it('moves and undoes a legacy task without revision metadata or attachment timestamps', async () => {
        const legacy = task({ rev: undefined, revBy: undefined, attachments: [{ id: 'attachment', kind: 'file',
            title: 'File', uri: 'local', createdAt: '', updatedAt: '' }] });
        const host = await open(initial([legacy]));
        const move = preparedMove(host.methods, 'none');
        expect(value(await host.methods.commitPreparedSomedaySectionMove(move))).toEqual(move.prepared.result);
        expect(useTaskStore.getState()._allTasks[0].rev).toBe(1);
        const undo = preparedUndo(host.methods, move);
        expect(value(await host.methods.commitPreparedSomedaySectionMoveUndo(undo))).toEqual(undo.prepared.result);
        expect(useTaskStore.getState()._allTasks[0].attachments).toEqual(legacy.attachments);
    });
});
