import { afterEach, describe, expect, it } from 'vitest';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import type { NativeProjectCreateRequest } from './native-host-contract-project-create';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { purgeExpiredTombstones } from './sync-tombstones';
import type { AppData, Area, Project } from './types';

const requestId = '00000000-0000-4000-8000-000000000341';
const request = (overrides: Partial<NativeProjectCreateRequest> = {}): NativeProjectCreateRequest => ({
    requestId, title: 'Garden', areaId: null, ...overrides,
});
const now = '2026-09-28T15:00:00.000Z';
const area = (id: string, name: string, color = '#3875d7'): Area => ({
    id, name, color, order: 0, createdAt: now, updatedAt: now,
});
const unwrap = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

async function open(options: { projects?: Project[]; areas?: Area[]; settings?: AppData['settings'];
    saveData?: (data: AppData) => Promise<void> } = {}) {
    await flushPendingSave();
    resetForTests();
    let data: AppData = { tasks: [], projects: options.projects ?? [], sections: [], areas: options.areas ?? [],
        people: [], settings: options.settings ?? { deviceId: 'project-device' } };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        await options.saveData?.(next);
        data = JSON.parse(JSON.stringify(next)) as AppData;
        saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    const host = createNativeHostContract();
    expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
    expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
    return { host, saved: () => data, saves: () => saves };
}

afterEach(async () => {
    await flushPendingSave();
    resetForTests();
});

describe('prepared native project create', () => {
    it('shows all area choices and prepares one canonical project without writing', async () => {
        const { host, saves } = await open({ areas: [area('area-one', 'One')] });
        const before = saves();
        expect(unwrap(host.getProjectCreateOptions()).areas).toContainEqual({ id: 'area-one', label: 'One', color: '#3875d7' });
        const prepared = unwrap(host.prepareProjectCreate(request({ title: '  Garden  ', areaId: 'area-one' })));
        expect(prepared).toMatchObject({ kind: 'prepared', prepared: { project: { id: requestId,
            title: 'Garden', areaId: 'area-one', areaTitle: 'One', color: '#3875d7', rev: 1 } } });
        expect(saves()).toBe(before);
    });

    it('matches the RN factory when the highest existing order is fractional below zero', async () => {
        const existing: Project = { id: 'negative-order', title: 'Earlier', color: '#94a3b8', order: -0.5,
            status: 'active', tagIds: [], createdAt: now, updatedAt: now };
        const { host } = await open({ projects: [existing] });
        const planned = unwrap(host.prepareProjectCreate(request()));
        expect(planned.kind).toBe('prepared');
        if (planned.kind !== 'prepared') return;
        const rnCreated = await useTaskStore.getState().addProject('Factory comparison', '#94a3b8');
        expect(rnCreated?.order).toBe(0.5);
        expect(planned.prepared.orderMax).toBe(-0.5);
        expect(planned.prepared.project.order).toBe(rnCreated?.order);
    });

    it('returns an existing same-title area project without a journal or write and exposes all areas', async () => {
        const many = Array.from({ length: 130 }, (_, index) => area(`a-${index}`, `Area ${index}`));
        const existing: Project = { id: 'existing-project', title: 'Garden', color: '#94a3b8', order: 0,
            areaId: 'a-110', status: 'active', tagIds: [], createdAt: now, updatedAt: now };
        const { host, saves } = await open({ areas: many, projects: [existing] });
        const before = saves();
        expect(unwrap(host.getProjectCreateOptions())).toMatchObject({
            areaFilterValue: '__all__', defaultAreaId: null,
        });
        expect(unwrap(host.getProjectCreateOptions()).areas).toHaveLength(130);
        expect(unwrap(host.prepareProjectCreate(request({ title: '  GARDEN  ', areaId: 'a-110' }))))
            .toEqual({ kind: 'existing', result: { id: existing.id, created: false } });
        expect(saves()).toBe(before);
        expect(useTaskStore.getState()._allProjects).toHaveLength(1);
        unwrap(await host.setAreaFilter({ included: ['a-110'], excluded: [] }));
        expect(unwrap(host.getProjectCreateOptions())).toMatchObject({
            areaFilterValue: 'a-110', defaultAreaId: 'a-110',
        });
        unwrap(await host.setAreaFilter({ included: ['__none__'], excluded: [] }));
        expect(unwrap(host.getProjectCreateOptions())).toMatchObject({
            areaFilterValue: '__none__', defaultAreaId: null,
        });
    });

    it('probes only the current selectable duplicate with the frozen request ID without saving', async () => {
        const own: Project = { id: requestId, title: '  gArDeN  ', color: '#123456', order: 3,
            status: 'active', tagIds: [], createdAt: now, updatedAt: now, rev: 7 };
        const { host, saves } = await open({ projects: [own] });
        const before = saves();
        expect(unwrap(host.projectCreateRetryOutcome(request()))).toEqual({ id: requestId, created: false });
        expect(host.projectCreateRetryOutcome(request({ requestId: 'not-a-uuid' })))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(before);
        expect(useTaskStore.getState()._allProjects).toEqual([own]);
    });

    it('makes every changed, removed, or displaced target a no-write retry conflict', async () => {
        const own: Project = { id: requestId, title: 'Garden', color: '#94a3b8', order: 0,
            status: 'active', tagIds: [], createdAt: now, updatedAt: now };
        const cases: Array<{ name: string; projects: Project[] }> = [
            { name: 'missing', projects: [] },
            { name: 'deleted', projects: [{ ...own, deletedAt: now }] },
            { name: 'purged', projects: [{ ...own, deletedAt: now, purgedAt: now }] },
            { name: 'renamed', projects: [{ ...own, title: 'Other' }] },
            { name: 'moved', projects: [{ ...own, areaId: 'a' }] },
            { name: 'archived', projects: [{ ...own, status: 'archived' }] },
            { name: 'different duplicate', projects: [{ ...own, title: 'Other' }, { ...own, id: 'other', title: ' GARDEN ' }] },
        ];
        for (const scenario of cases) {
            const { host, saves } = await open({ projects: scenario.projects, areas: [area('a', 'Other area')] });
            const before = saves();
            const rows = structuredClone(useTaskStore.getState()._allProjects);
            expect(host.projectCreateRetryOutcome(request()), scenario.name)
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(saves(), scenario.name).toBe(before);
            expect(useTaskStore.getState()._allProjects, scenario.name).toEqual(rows);
        }
    });

    it('cannot recreate a deleted project after its retained tombstone expires', async () => {
        const { host, saved, saves } = await open();
        const planned = unwrap(host.prepareProjectCreate(request()));
        expect(planned.kind).toBe('prepared');
        if (planned.kind !== 'prepared') return;
        expect(unwrap(await host.commitPreparedProjectCreate({ request: request(), prepared: planned.prepared })))
            .toEqual({ id: requestId, created: true });
        expect((await useTaskStore.getState().deleteProject(requestId)).success).toBe(true);
        expect((await useTaskStore.getState().purgeProject(requestId)).success).toBe(true);
        await flushPendingSave();
        const cleaned = purgeExpiredTombstones(saved(), new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString());
        expect(cleaned.removedProjectTombstones).toBe(1);
        useTaskStore.setState({ _allProjects: cleaned.data.projects,
            _projectsById: new Map(cleaned.data.projects.map((project) => [project.id, project])) });
        expect(unwrap(host.prepareProjectCreate(request())).kind).toBe('prepared');
        const before = saves();
        expect(host.projectCreateRetryOutcome(request()))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(before);
        expect(useTaskStore.getState()._allProjects).toHaveLength(0);
    });

    it('publishes one area-colored, sequential project and acknowledges exact receipt after guard-only changes', async () => {
        const selected = area('a', 'Home', '#26439a');
        const { host, saved, saves } = await open({ areas: [selected],
            settings: { deviceId: 'project-device', gtd: { defaultProjectFlowMode: 'sequential' } } });
        const input = request({ areaId: 'a' });
        const prepared = unwrap(host.prepareProjectCreate(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(prepared.prepared.project).toMatchObject({ id: requestId, areaId: 'a', areaTitle: 'Home',
            color: '#26439a', isSequential: true, order: 0, rev: 1 });
        expect(unwrap(host.validatePreparedProjectCreate({ request: input, prepared: prepared.prepared })))
            .toEqual({ id: requestId, created: true });
        const before = saves();
        expect(unwrap(await host.commitPreparedProjectCreate({ request: input, prepared: prepared.prepared })))
            .toEqual({ id: requestId, created: true });
        expect(saves()).toBeGreaterThan(before);
        expect(saved().projects).toHaveLength(1);
        expect(saved().projects[0]).toEqual(prepared.prepared.project);
        const count = saves();
        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            gtd: { ...state.settings.gtd, defaultProjectFlowMode: 'parallel' } },
            _allAreas: [{ ...selected, name: 'Renamed', color: '#333333' }] }));
        expect(unwrap(await host.commitPreparedProjectCreate({ request: input, prepared: prepared.prepared })))
            .toEqual({ id: requestId, created: true });
        expect(saves()).toBe(count);
        expect(useTaskStore.getState()._allProjects).toHaveLength(1);
    });

    it('refuses replay after an area rename rewrites the created project row', async () => {
        const selected = area('a', 'Home', '#26439a');
        const { host, saved, saves } = await open({ areas: [selected] });
        const input = request({ areaId: 'a' });
        const planned = unwrap(host.prepareProjectCreate(input));
        expect(planned.kind).toBe('prepared');
        if (planned.kind !== 'prepared') return;
        expect(unwrap(await host.commitPreparedProjectCreate({ request: input, prepared: planned.prepared })))
            .toEqual({ id: requestId, created: true });
        expect((await useTaskStore.getState().updateArea('a', { name: 'Renamed', color: '#333333' })).success).toBe(true);
        await flushPendingSave();
        const renamed = structuredClone(saved().projects[0]);
        expect(renamed).toMatchObject({ id: requestId, areaTitle: 'Renamed', color: '#333333', rev: 2 });
        const before = saves();
        expect(await host.commitPreparedProjectCreate({ request: input, prepared: planned.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(before);
        expect(saved().projects).toEqual([renamed]);
    });

    it('retries an owed save with the same UUID and survives a cold contract without a second row', async () => {
        let failSave = false;
        const selected = area('a', 'Home');
        const { host, saved } = await open({ areas: [selected], saveData: async () => {
            if (failSave) throw new Error('disk unavailable');
        } });
        const input = request({ areaId: 'a' });
        const prepared = unwrap(host.prepareProjectCreate(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        failSave = true;
        expect(await host.commitPreparedProjectCreate({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(useTaskStore.getState()._allProjects).toHaveLength(1);
        expect(saved().projects).toHaveLength(0);
        failSave = false;
        expect(unwrap(await host.commitPreparedProjectCreate({ request: input, prepared: prepared.prepared })))
            .toEqual({ id: requestId, created: true });
        expect(saved().projects).toHaveLength(1);
        const reloaded = await open({ projects: saved().projects, areas: [selected] });
        const before = reloaded.saves();
        expect(unwrap(await reloaded.host.commitPreparedProjectCreate({ request: input, prepared: prepared.prepared })))
            .toEqual({ id: requestId, created: true });
        expect(reloaded.saves()).toBe(before);
        expect(reloaded.saved().projects).toHaveLength(1);
    });

    it('refuses changed guards, occupied IDs, and later edited target rows without overwrite', async () => {
        const selected = area('a', 'Home');
        const { host, saves } = await open({ areas: [selected] });
        const input = request({ areaId: 'a' });
        const prepared = unwrap(host.prepareProjectCreate(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        const before = saves();
        useTaskStore.setState((state) => ({ _allAreas: [{ ...selected, name: 'Renamed' }] }));
        expect(await host.commitPreparedProjectCreate({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(before);
        useTaskStore.setState((state) => ({ _allAreas: [selected],
            _allProjects: [{ ...prepared.prepared.project, title: 'Other' }] }));
        expect(await host.commitPreparedProjectCreate({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(before);
    });

    it('refuses a changed order, default flow, or concurrent same-title project before first publication', async () => {
        const selected = area('a', 'Home');
        for (const change of ['order', 'flow', 'duplicate'] as const) {
            const { host, saves } = await open({ areas: [selected] });
            const input = request({ areaId: 'a' });
            const planned = unwrap(host.prepareProjectCreate(input));
            expect(planned.kind).toBe('prepared');
            if (planned.kind !== 'prepared') continue;
            if (change === 'flow') {
                useTaskStore.setState((state) => ({ settings: { ...state.settings,
                    gtd: { ...state.settings.gtd, defaultProjectFlowMode: 'sequential' } } }));
            } else {
                const competing: Project = { ...planned.prepared.project,
                    id: `competing-${change}`, title: change === 'duplicate' ? 'GARDEN' : 'Another',
                    order: change === 'order' ? 1 : -1 };
                useTaskStore.setState({ _allProjects: [competing] });
            }
            const before = saves();
            expect(await host.commitPreparedProjectCreate({ request: input, prepared: planned.prepared }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(saves()).toBe(before);
            expect(useTaskStore.getState()._allProjects.some((project) => project.id === requestId)).toBe(false);
        }
    });

    it('rejects forged request, project, area, order, stamp, and result before store access', async () => {
        const { host, saves } = await open({ areas: [area('a', 'Home')] });
        const input = request({ areaId: 'a' });
        const prepared = unwrap(host.prepareProjectCreate(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        const variants = [
            (value: typeof prepared.prepared) => { value.project.color = '#000000'; },
            (value: typeof prepared.prepared) => { value.project.areaTitle = 'Other'; },
            (value: typeof prepared.prepared) => { value.project.order = 99; },
            (value: typeof prepared.prepared) => { value.project.updatedAt = now; },
            (value: typeof prepared.prepared) => { value.selectedArea!.name = 'Other'; },
            (value: typeof prepared.prepared) => { value.orderMax = 7; },
            (value: typeof prepared.prepared) => { value.result.id = 'wrong'; },
        ];
        const before = saves();
        for (const mutate of variants) {
            const forged = structuredClone(prepared.prepared);
            mutate(forged);
            expect(host.validatePreparedProjectCreate({ request: input, prepared: forged }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(await host.commitPreparedProjectCreate({ request: input, prepared: forged }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(host.validatePreparedProjectCreate({ request: { ...input, requestId: '00000000-0000-4000-8000-000000000342' },
            prepared: prepared.prepared })).toMatchObject({ ok: false });
        expect(host.prepareProjectCreate(request({ title: '漢'.repeat(700_000) }))).toMatchObject({ ok: false });
        expect(saves()).toBe(before);
    });
});
