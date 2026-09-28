import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAreaRenameMethods, type NativeAreaRenameRequest } from './native-host-contract-area-rename';
import { MAX_SYNC_REVISION } from './sync-revision';
import { mergeAppData } from './sync';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Area, Project, Task } from './types';

const NOW = '2026-09-28T15:00:00.000Z';
const REQUEST_ID = '00000000-0000-4000-8000-000000000591';
const area = (id: string, name: string, order: number, overrides: Partial<Area> = {}): Area => ({
    id, name, order, color: '#3b82f6', rev: 3, revBy: 'old-device',
    createdAt: NOW, updatedAt: NOW, ...overrides,
});
const project = (id: string, areaId: string, areaTitle: string, overrides: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#3b82f6', order: 0, tagIds: ['#keep'],
    areaId, areaTitle, rev: 5, revBy: 'old-device', createdAt: NOW, updatedAt: NOW, ...overrides,
});
const task = (id: string, areaId: string, overrides: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: ['#keep'], contexts: ['@home'], areaId,
    rev: 7, revBy: 'old-device', createdAt: NOW, updatedAt: NOW, ...overrides,
});

async function open(initial: Partial<AppData>, fail?: () => boolean) {
    await flushPendingSave();
    resetForTests();
    let data: AppData = { tasks: [], projects: [], sections: [], areas: [], people: [],
        settings: { deviceId: 'area-device' }, ...initial };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next);
        saves += 1;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = createAreaRenameMethods({
        readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        },
    });
    const request = (areaId: string, name: string,
        overrides: Partial<NativeAreaRenameRequest> = {}): NativeAreaRenameRequest => {
        const current = useTaskStore.getState()._allAreas.find((row) => row.id === areaId)!;
        return { requestId: REQUEST_ID, areaId, name,
            expected: { id: current.id, name: current.name, color: current.color ?? null,
                order: current.order, rev: current.rev ?? null, revBy: current.revBy ?? null,
                updatedAt: current.updatedAt }, ...overrides };
    };
    return { methods, request, data: () => data, saves: () => saves };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared native Area rename', () => {
    it('returns blank and exact-spelling no-ops without initializing a device or saving', async () => {
        const { methods, request, saves } = await open({ areas: [area('source', 'Work', 0)], settings: {} });
        useTaskStore.setState({ settings: {} });
        expect(methods.prepareAreaRename(request('source', '   '))).toEqual({ ok: true, value: {
            kind: 'noop', result: { id: 'source', areaId: 'source', name: 'Work' },
        } });
        expect(methods.prepareAreaRename(request('source', ' Work '))).toEqual({ ok: true, value: {
            kind: 'noop', result: { id: 'source', areaId: 'source', name: 'Work' },
        } });
        expect(useTaskStore.getState().settings.deviceId).toBeUndefined();
        expect(saves()).toBe(0);
    });

    it('freezes and atomically persists the RN merge effect with all witnesses and raw fields', async () => {
        const source = area('source', 'Work', 0, { icon: 'briefcase' });
        const destination = area('destination', 'Home', 1, { color: '#22c55e', icon: 'house' });
        const duplicate = area('duplicate', ' home ', 2, { color: '#ef4444' });
        const tombstone = area('old', 'HOME', 3, { deletedAt: NOW });
        const sourceLive = project('source-live', source.id, source.name, { supportNotes: 'keep' });
        const sourceDeleted = project('source-deleted', source.id, source.name, { deletedAt: NOW });
        const destinationStale = project('destination-stale', destination.id, 'old', { attachments: [] });
        const destinationExact = project('destination-exact', destination.id, 'HOME');
        const direct = task('direct', source.id, { description: 'keep', checklist: [{ id: 'c', title: 'keep', isCompleted: false }] });
        const deleted = task('deleted', source.id, { deletedAt: NOW });
        const dual = task('dual', source.id, { projectId: sourceLive.id });
        const unrelatedTask = task('other-task', duplicate.id);
        const { methods, request, data } = await open({ areas: [source, destination, duplicate, tombstone],
            projects: [sourceLive, sourceDeleted, destinationStale, destinationExact],
            tasks: [direct, deleted, dual, unrelatedTask] });
        // A mixed-version store can still contain duplicate live names even though
        // a fresh load currently normalizes them; rename resolves the first raw row.
        useTaskStore.setState({ _allAreas: [source, destination, duplicate, tombstone],
            _allTasks: [direct, deleted, dual, unrelatedTask] });
        const input = request(source.id, ' HOME ');
        const preparation = methods.prepareAreaRename(input);
        if (!preparation.ok || preparation.value.kind !== 'prepared') throw new Error(JSON.stringify(preparation));
        const prepared = preparation.value.prepared;

        expect(prepared.result).toEqual({ id: source.id, areaId: destination.id, name: 'HOME' });
        expect(prepared.scope.areas.map((row) => row.id)).toEqual([source.id, destination.id, duplicate.id]);
        expect(prepared.scope.projects.map((row) => row.id)).toEqual([
            sourceLive.id, sourceDeleted.id, destinationStale.id, destinationExact.id,
        ]);
        expect(prepared.scope.tasks.map((row) => row.id)).toEqual([direct.id, deleted.id, dual.id]);
        expect(prepared.effect.areas.map((pair) => pair.before.id)).toEqual([source.id, destination.id]);
        expect(prepared.effect.projects.map((pair) => pair.before.id)).toEqual([
            sourceLive.id, sourceDeleted.id, destinationStale.id,
        ]);
        expect(prepared.effect.tasks.map((pair) => pair.before.id)).toEqual([direct.id, deleted.id, dual.id]);
        expect(methods.validatePreparedAreaRename({ request: input, prepared }))
            .toEqual({ ok: true, value: prepared.result });
        expect(await methods.commitPreparedAreaRename({ request: input, prepared }))
            .toEqual({ ok: true, value: prepared.result });

        expect(data().areas.find((row) => row.id === source.id)?.deletedAt).toBe(prepared.updateAt);
        expect(data().areas.find((row) => row.id === destination.id)).toMatchObject({
            name: 'HOME', color: destination.color, icon: destination.icon, order: destination.order,
        });
        expect(data().projects.find((row) => row.id === sourceDeleted.id)?.deletedAt).toBe(NOW);
        expect(data().projects.find((row) => row.id === destinationExact.id)).toEqual(destinationExact);
        expect(data().tasks.find((row) => row.id === dual.id)?.areaId).toBeUndefined();
        expect(data().tasks.find((row) => row.id === unrelatedTask.id)).toEqual(unrelatedTask);
        const aligned = mergeAppData(data(), data(), { nowIso: prepared.updateAt });
        expect(mergeAppData(aligned, data(), { nowIso: prepared.updateAt })).toEqual(aligned);
    });

    it('keeps composed and decomposed Unicode distinct and renames case-only spelling', async () => {
        const source = area('source', 'Cafe', 0);
        const decomposed = area('decomposed', 'Cafe\u0301', 1);
        const { methods, request } = await open({ areas: [source, decomposed],
            projects: [project('linked', source.id, source.name)] });
        const composed = request(source.id, '\ufeffCaf\u00e9\ufeff');
        const plan = methods.prepareAreaRename(composed);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        expect(plan.value.prepared.request.name).toBe('\ufeffCaf\u00e9\ufeff');
        expect(plan.value.prepared.result.name).toBe('Caf\u00e9');
        expect(plan.value.prepared.result.areaId).toBe(source.id);
        expect(plan.value.prepared.effect.projects[0].after.areaTitle).toBe('Caf\u00e9');

        const fresh = await open({ areas: [area('source', 'Work', 0)] });
        const caseOnly = fresh.request('source', 'work');
        const casePlan = fresh.methods.prepareAreaRename(caseOnly);
        if (!casePlan.ok || casePlan.value.kind !== 'prepared') throw new Error(JSON.stringify(casePlan));
        expect(casePlan.value.prepared.result).toEqual({ id: 'source', areaId: 'source', name: 'work' });

        const deletedMatch = await open({ areas: [area('source', 'Work', 0),
            area('deleted', 'Home', 1, { deletedAt: NOW })] });
        const tombstoneOnly = deletedMatch.methods.prepareAreaRename(deletedMatch.request('source', 'Home'));
        if (!tombstoneOnly.ok || tombstoneOnly.value.kind !== 'prepared') throw new Error(JSON.stringify(tombstoneOnly));
        expect(tombstoneOnly.value.prepared.result.areaId).toBe('source');
    });

    it('refuses changed inventory or linked membership, but accepts the full receipt before mutable guards', async () => {
        const source = area('source', 'Work', 0);
        const destination = area('destination', 'Home', 1);
        const linked = project('linked', source.id, source.name);
        const { methods, request, saves } = await open({ areas: [source, destination], projects: [linked] });
        const input = request(source.id, destination.name);
        const plan = methods.prepareAreaRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        const envelope = { request: input, prepared: plan.value.prepared };
        useTaskStore.setState({ _allProjects: [...useTaskStore.getState()._allProjects,
            project('new-link', source.id, source.name)] });
        expect(await methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [linked], _allTasks: [task('new-task', source.id)] });
        expect(await methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allTasks: [], _allProjects: [{ ...linked, title: 'changed', rev: 6 }] });
        expect(await methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [linked] });
        useTaskStore.setState({ _allProjects: [linked], _allAreas: [source,
            area('new-first', 'Home', -1), destination] });
        expect(await methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allAreas: [source, destination] });
        expect(await methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: true });
        const saved = saves();
        useTaskStore.setState({ _allAreas: [...useTaskStore.getState()._allAreas,
            area('later', 'Later', 9)], _allProjects: [...useTaskStore.getState()._allProjects,
            project('later-project', 'later', 'Later')] });
        expect(await methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: true });
        expect(saves()).toBe(saved);
        const partial = useTaskStore.getState()._allProjects.map((row) => row.id === linked.id
            ? { ...row, title: 'later edit', rev: (row.rev ?? 0) + 1 } : row);
        useTaskStore.setState({ _allProjects: partial });
        expect(await methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });

    it('retries one failed durable effect and recognizes the cold receipt', async () => {
        let failed = true;
        const source = area('source', 'Work', 0);
        const first = await open({ areas: [source], projects: [project('linked', source.id, source.name)],
            settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request(source.id, 'Office');
        const plan = first.methods.prepareAreaRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        expect(plan.value.prepared.deviceIdBefore).toBeNull();
        expect(plan.value.prepared.deviceIdToInitialize).toMatch(/^[0-9a-f]{8}-/);
        const envelope = { request: input, prepared: plan.value.prepared };
        expect(await first.methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.data().areas[0].name).toBe('Work');
        failed = false;
        expect(await first.methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: true });
        expect(first.data().areas[0].name).toBe('Office');
        const saved = structuredClone(first.data());
        const second = await open(saved);
        await flushPendingSave();
        const before = second.saves();
        expect(second.methods.validatePreparedAreaRename(envelope)).toMatchObject({ ok: true });
        expect(await second.methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: true });
        expect(second.saves()).toBe(before);
        useTaskStore.setState({ settings: { ...useTaskStore.getState().settings, deviceId: 'different' } });
        expect(await second.methods.commitPreparedAreaRename(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });

    it('rejects stale, forged, capped, oversized, and unknown outcome requests without writing', async () => {
        const source = area('source', 'Work', 0);
        const { methods, request } = await open({ areas: [source],
            projects: [project('linked', source.id, source.name)] });
        const input = request(source.id, 'Office');
        expect(methods.prepareAreaRename({ ...input, expected: { ...input.expected, id: 'other' } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareAreaRename({ ...input, expected: { ...input.expected, rev: 2 } }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const plan = methods.prepareAreaRename(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        const forged = structuredClone(plan.value.prepared);
        forged.effect.areas[0].after.name = 'forged';
        expect(methods.validatePreparedAreaRename({ request: input, prepared: forged }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const missing = structuredClone(plan.value.prepared);
        missing.effect.areas = [];
        expect(methods.validatePreparedAreaRename({ request: input, prepared: missing }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const extra = structuredClone(plan.value.prepared);
        extra.effect.areas.push(structuredClone(extra.effect.areas[0]));
        expect(methods.validatePreparedAreaRename({ request: input, prepared: extra }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const wrongResult = structuredClone(plan.value.prepared);
        wrongResult.result.name = 'wrong';
        expect(methods.validatePreparedAreaRename({ request: input, prepared: wrongResult }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.probeAreaRenameOutcome(input)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(methods.prepareAreaRename(request(source.id, 'x'.repeat(10_001))))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        const capped = await open({ areas: [area('capped', 'Capped', 0, { rev: MAX_SYNC_REVISION })] });
        expect(capped.methods.prepareAreaRename(capped.request('capped', 'Renamed')))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        const oversized = await open({ areas: [area('large', 'Large', 0)] });
        useTaskStore.setState({ _allProjects: Array.from({ length: 8 }, (_, index) =>
            project(`large-${index}`, 'large', 'Large', { title: 'x'.repeat(100_000) })) });
        expect(oversized.methods.prepareAreaRename(oversized.request('large', 'Larger')))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        const deletedSource = await open({ areas: [area('deleted-source', 'Gone', 0, { deletedAt: NOW })] });
        expect(deletedSource.methods.prepareAreaRename(deletedSource.request('deleted-source', 'Back')))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });
});
